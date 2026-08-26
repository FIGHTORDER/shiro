//! Fetching an add-on from a GitHub repository.
//!
//! Widget packs in this community live in repositories, not on a release page
//! with a published checksum. New-Hel-K has no releases and no tags at all -
//! its "latest build" is whatever is on `main`. So the resolve order is
//! releases, then tags, then the default branch's head commit.
//!
//! **What "verified" means here, precisely.** There is no publisher signature
//! to check, because nobody publishes one. What we do instead is resolve a
//! *commit sha* and then fetch that exact sha: the sha is Git's own hash of the
//! tree, so the archive that comes back is the one we asked for or it is not
//! that commit. That is trust-on-fetch from GitHub over TLS, and it pins a
//! build so an install is reproducible and an update is visible - it is not the
//! same guarantee as `apps.rs` gets from a catalogue hash, and it should not be
//! described as if it were.

use std::io::Read;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

const API: &str = "https://api.github.com";
const UA: &str = "shiro-lobby";

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const TOTAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// Widget packs are source, so this is generous but not unbounded.
const MAX_ARCHIVE: u64 = 64 * 1024 * 1024;

/// Which repository an add-on comes from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Repo {
    pub owner: String,
    pub name: String,
}

impl Repo {
    pub fn slug(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

/// The build that would be installed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Build {
    /// What it is called - a release tag, a tag, or a branch name.
    pub label: String,
    /// The commit this resolves to. This is the identity of the build.
    pub sha: String,
    /// "release", "tag" or "branch", so the screen can say how it was found.
    pub kind: String,
    /// When it was published or committed, as the API reports it.
    pub date: Option<String>,
}

impl Build {
    /// The first seven characters, which is how Git itself shows a commit.
    pub fn short(&self) -> String {
        self.sha.chars().take(7).collect()
    }
}

/// Accepts `owner/repo`, a github.com URL, with or without a `.git` suffix.
///
/// Anything else is refused rather than guessed at: this string decides which
/// host is contacted, so a loose parse is a way of reaching somewhere else.
pub fn parse_repo(input: &str) -> Result<Repo, String> {
    let s = input.trim().trim_end_matches('/');
    let s = s
        .strip_prefix("https://github.com/")
        .or_else(|| s.strip_prefix("http://github.com/"))
        .or_else(|| s.strip_prefix("github.com/"))
        .unwrap_or(s);
    let s = s.strip_suffix(".git").unwrap_or(s);

    let mut parts = s.split('/');
    let owner = parts.next().unwrap_or("").trim();
    let name = parts.next().unwrap_or("").trim();
    if parts.next().is_some() || owner.is_empty() || name.is_empty() {
        return Err(format!("{input} is not a GitHub repository"));
    }
    let ok = |s: &str| {
        s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    };
    if !ok(owner) || !ok(name) || owner.starts_with('.') || name.starts_with('.') {
        return Err(format!("{input} is not a GitHub repository"));
    }
    Ok(Repo {
        owner: owner.to_string(),
        name: name.to_string(),
    })
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .user_agent(UA)
        .build()
        .map_err(|e| format!("could not start a web client: {e}"))
}

fn get_json(c: &reqwest::blocking::Client, url: &str) -> Result<Option<serde_json::Value>, String> {
    let res = c
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| format!("could not reach GitHub: {e}"))?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if res.status() == reqwest::StatusCode::FORBIDDEN {
        // The unauthenticated API allows 60 requests an hour per address, and
        // saying so is more use than "forbidden".
        return Err("GitHub is rate limiting this machine; try again later".to_string());
    }
    if !res.status().is_success() {
        return Err(format!("GitHub answered {}", res.status()));
    }
    res.json::<serde_json::Value>()
        .map(Some)
        .map_err(|e| format!("GitHub sent something unreadable: {e}"))
}

fn text(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().map(str::to_string)
}

/// The latest build: a release if there is one, else the newest tag, else the
/// head of the default branch.
pub fn resolve(repo: &Repo) -> Result<Build, String> {
    let c = client()?;
    let base = format!("{API}/repos/{}/{}", repo.owner, repo.name);

    if let Some(rel) = get_json(&c, &format!("{base}/releases/latest"))? {
        if let Some(tag) = text(&rel, "tag_name") {
            // A tag names a commit only indirectly, so ask what it points at.
            if let Some(obj) = get_json(&c, &format!("{base}/commits/{tag}"))? {
                if let Some(sha) = text(&obj, "sha") {
                    return Ok(Build {
                        label: tag,
                        sha,
                        kind: "release".to_string(),
                        date: text(&rel, "published_at"),
                    });
                }
            }
        }
    }

    if let Some(tags) = get_json(&c, &format!("{base}/tags?per_page=1"))? {
        if let Some(first) = tags.as_array().and_then(|a| a.first()) {
            if let (Some(name), Some(sha)) = (
                text(first, "name"),
                first.get("commit").and_then(|c| text(c, "sha")),
            ) {
                return Ok(Build {
                    label: name,
                    sha,
                    kind: "tag".to_string(),
                    date: None,
                });
            }
        }
    }

    let meta = get_json(&c, &base)?.ok_or_else(|| format!("no such repository: {}", repo.slug()))?;
    let branch = text(&meta, "default_branch").unwrap_or_else(|| "main".to_string());
    let head = get_json(&c, &format!("{base}/commits/{branch}"))?
        .ok_or_else(|| format!("{} has no commits", repo.slug()))?;
    let sha = text(&head, "sha").ok_or_else(|| "GitHub sent a commit with no sha".to_string())?;
    let date = head
        .get("commit")
        .and_then(|c| c.get("committer"))
        .and_then(|c| text(c, "date"));
    Ok(Build {
        label: branch,
        sha,
        kind: "branch".to_string(),
        date,
    })
}

/// The repository at one exact commit, as a zip.
pub fn download(repo: &Repo, sha: &str) -> Result<Vec<u8>, String> {
    if sha.is_empty() || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("{sha} is not a commit"));
    }
    let url = format!("{API}/repos/{}/{}/zipball/{sha}", repo.owner, repo.name);
    let c = client()?;
    let res = c
        .get(&url)
        .send()
        .map_err(|e| format!("could not reach GitHub: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("GitHub answered {} for the archive", res.status()));
    }
    // Refuse on the declared length where there is one, and again while reading
    // where there is not: a missing Content-Length must not mean no limit.
    if let Some(len) = res.content_length() {
        if len > MAX_ARCHIVE {
            return Err(format!("the archive is {len} bytes, which is too large"));
        }
    }
    let mut out = Vec::new();
    let mut reader = res.take(MAX_ARCHIVE + 1);
    reader
        .read_to_end(&mut out)
        .map_err(|e| format!("the download did not finish: {e}"))?;
    if out.len() as u64 > MAX_ARCHIVE {
        return Err("the archive is too large".to_string());
    }
    Ok(out)
}

/// GitHub wraps a zipball in one directory named for the owner, repo and sha.
/// Strip it, so paths come out relative to the repository root.
fn strip_top_level(name: &str) -> Option<&str> {
    let rest = name.split_once('/')?.1;
    if rest.is_empty() {
        None
    } else {
        Some(rest)
    }
}

/// Whether a path from an archive is safe to join onto a directory.
///
/// Rejects absolute paths, drive letters, and any `..` component, so an entry
/// cannot write outside the directory it is being unpacked into.
fn safe_relative(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    if p.is_absolute() || name.contains(':') {
        return None;
    }
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Unpack a zipball into a directory, keeping the tree.
///
/// The structure is kept rather than flattened the way `skins.rs` does it,
/// because for a widget pack the path is what decides whether a file may be
/// installed at all - `LuaUI/Widgets` and `LuaUI/Config` mean very different
/// things.
pub fn unpack_tree(bytes: &[u8], into: &Path) -> Result<usize, String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("not a zip: {e}"))?;
    let mut written = 0;
    for i in 0..zip.len() {
        let mut f = zip
            .by_index(i)
            .map_err(|e| format!("unreadable entry: {e}"))?;
        if f.is_dir() {
            continue;
        }
        let Some(rel) = strip_top_level(f.name()).and_then(safe_relative) else {
            continue;
        };
        let out = into.join(&rel);
        if let Some(dir) = out.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        }
        let mut w = std::fs::File::create(&out)
            .map_err(|e| format!("could not write {}: {e}", out.display()))?;
        std::io::copy(&mut f, &mut w)
            .map_err(|e| format!("could not write {}: {e}", out.display()))?;
        written += 1;
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_forms_people_actually_paste_are_understood() {
        for input in [
            "Helwor/New-Hel-K",
            "https://github.com/Helwor/New-Hel-K",
            "https://github.com/Helwor/New-Hel-K/",
            "github.com/Helwor/New-Hel-K.git",
            "  Helwor/New-Hel-K  ",
        ] {
            let r = parse_repo(input).unwrap_or_else(|e| panic!("{input}: {e}"));
            assert_eq!(r.slug(), "Helwor/New-Hel-K");
        }
    }

    /// This string decides which host is contacted, so anything that is not
    /// plainly a GitHub repository has to be refused rather than guessed at.
    #[test]
    fn anything_else_is_refused() {
        for input in [
            "",
            "New-Hel-K",
            "https://evil.test/Helwor/New-Hel-K",
            "Helwor/New-Hel-K/extra",
            "../../etc",
            "Helwor/../evil",
            "https://github.com/Helwor",
        ] {
            assert!(parse_repo(input).is_err(), "{input} was accepted");
        }
    }

    #[test]
    fn a_zipballs_wrapper_directory_comes_off() {
        assert_eq!(
            strip_top_level("Helwor-New-Hel-K-8a5e270/Widgets/x.lua"),
            Some("Widgets/x.lua")
        );
        assert_eq!(strip_top_level("Helwor-New-Hel-K-8a5e270/"), None);
        assert_eq!(strip_top_level("no-slash"), None);
    }

    /// An archive entry is attacker-controlled text, and joining it onto a
    /// directory is where that becomes a write outside the directory.
    #[test]
    fn an_entry_cannot_escape_the_directory() {
        for bad in [
            "../evil.lua",
            "a/../../evil.lua",
            "/etc/evil.lua",
            "C:/evil.lua",
            "",
        ] {
            assert!(safe_relative(bad).is_none(), "{bad} was allowed");
        }
        assert_eq!(
            safe_relative("LuaUI/Widgets/x.lua"),
            Some(PathBuf::from("LuaUI").join("Widgets").join("x.lua"))
        );
    }

    #[test]
    fn a_build_is_shown_the_way_git_shows_it() {
        let b = Build {
            label: "main".into(),
            sha: "30cd8ced00e2e036e1757b08ef881e2c070c42b6".into(),
            kind: "branch".into(),
            date: None,
        };
        assert_eq!(b.short(), "30cd8ce");
    }
}
