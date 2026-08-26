//! Skins that are downloaded rather than shipped.
//!
//! Four skins are built in - they are a few dozen CSS declarations each and
//! cost nothing to carry. Anything larger is a download, for the same reason
//! the apps are: Sakura's login plate alone is 414 kB, fifteen times the
//! bundled one, and a build should not carry it for the people who never turn
//! it on.
//!
//! The safety story is *not* the one in `apps.rs`. An app is a program the OS
//! runs in its own process, and nothing about it is read by the webview. A skin
//! is the opposite: its stylesheet and its pictures are handed to the page. So
//! two rules hold here that do not apply there.
//!
//! - **Nothing is fetched by the page.** The webview's CSP is `default-src
//!   'self'`, and it stays that way. Rust reads the installed files and returns
//!   them over IPC - the stylesheet as text, the pictures as `data:` URLs,
//!   which `img-src` already permits. No new origin, no widened policy.
//! - **A skin is data, not code.** Only `.css` and a short list of picture
//!   extensions are read out of an installed skin. Anything else in the archive
//!   is ignored rather than served, so a payload cannot smuggle a script in
//!   beside the stylesheet.
//!
//! The catalogue ships with Shiro, as the apps' does: entries arrive by pull
//! request, not by serving a file.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;
use sha2::{Digest, Sha256};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(300);

/// A skin is a stylesheet and a few pictures. Anything approaching this is not
/// one, and the check happens before the hash rather than after it.
const MAX_SKIN: u64 = 24 * 1024 * 1024;

/// What may be read back out of an installed skin, and nothing else. The point
/// is not the file size, it is that a stylesheet and a picture cannot execute.
const PICTURES: &[&str] = &["png", "jpg", "jpeg", "webp", "avif", "gif", "svg"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueSkin {
    pub id: &'static str,
    pub name: &'static str,
    /// The one line the picker shows under the name.
    pub note: &'static str,
    /// None when there is nothing published yet - see `unavailable`.
    pub download: Option<&'static str>,
    /// SHA-256 of the archive, lowercase hex. Absent only when `download` is.
    pub sha256: Option<&'static str>,
    pub version: Option<&'static str>,
    /// Set when the skin cannot be installed at all, and says why in a sentence
    /// somebody can act on. A row that is merely broken is the failure to avoid.
    pub unavailable: Option<&'static str>,
}

pub const CATALOGUE: &[CatalogueSkin] = &[CatalogueSkin {
    id: "sakura",
    name: "Sakura",
    note: "White and pink, with petals.",
    // Its own tag rather than `dev`: the release workflow sweeps every asset on
    // `dev` that is not in the set it just built, which would delete this and
    // leave the compiled-in URL pointing at a 404.
    download: Some(
        "https://github.com/FIGHTORDER/shiro/releases/download/skin-sakura-1.0.0/shiro-skin-sakura-1.0.0.zip",
    ),
    sha256: Some("1a43a155fbfd88dc2d1f1668cfeae02836b027232aedcaa8d69832aed4855423"),
    version: Some("1.0.0"),
    unavailable: None,
}];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinStatus {
    pub id: String,
    pub installed: bool,
    pub version: Option<String>,
}

/// A skin, read off disk and in a shape the page can use directly.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSkin {
    /// The stylesheet, as text. The caller puts it in a `<style>`; `style-src`
    /// already allows inline, so this needs no new policy.
    pub css: String,
    /// Pictures by file name, as `data:` URLs, which `img-src` already allows.
    pub assets: BTreeMap<String, String>,
}

fn entry(id: &str) -> Result<&'static CatalogueSkin, String> {
    CATALOGUE
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("no skin called {id}"))
}

/// Where skins live. Beside the apps, under Shiro's own data directory, for the
/// same reason: it is somewhere Shiro may write on every install shape.
fn skins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    let dir = base.join("skins");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not make {}: {e}", dir.display()))?;
    Ok(dir)
}

/// One skin's directory. The id is checked rather than trusted: it reaches this
/// from the page, and a `..` in it would be a path traversal into the app data
/// directory.
fn skin_dir(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("{id} is not a skin id"));
    }
    Ok(skins_dir(app)?.join(id))
}

fn sha256_of(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

/// Only the host the catalogue's own entries live on.
fn host_allowed(url: &str) -> bool {
    url.starts_with("https://github.com/") || url.starts_with("https://objects.githubusercontent.com/")
}

#[tauri::command]
pub fn zks_skin_catalogue() -> Vec<CatalogueSkin> {
    CATALOGUE.to_vec()
}

#[tauri::command]
pub fn zks_skin_status(app: tauri::AppHandle) -> Vec<SkinStatus> {
    CATALOGUE
        .iter()
        .map(|s| {
            let dir = skin_dir(&app, s.id).ok();
            let installed = dir.as_ref().is_some_and(|d| d.join("skin.css").is_file());
            let version = dir
                .as_ref()
                .and_then(|d| std::fs::read_to_string(d.join("installed-version")).ok())
                .map(|v| v.trim().to_string());
            SkinStatus { id: s.id.to_string(), installed, version }
        })
        .collect()
}

/// Read an installed skin for the page.
///
/// Everything is read here rather than fetched there. The stylesheet comes back
/// as text and the pictures as `data:` URLs, so the webview never reaches
/// outside its own origin and the CSP is untouched.
#[tauri::command]
pub fn zks_skin_load(app: tauri::AppHandle, id: String) -> Result<LoadedSkin, String> {
    read_skin(&skin_dir(&app, &id)?)
}

/// The reading half, without a handle, so what comes back out of a skin
/// directory can be tested directly - that is the part with a security answer
/// in it.
fn read_skin(dir: &Path) -> Result<LoadedSkin, String> {
    let css_path = dir.join("skin.css");
    let css = std::fs::read_to_string(&css_path)
        .map_err(|e| format!("could not read {}: {e}", css_path.display()))?;

    let mut assets = BTreeMap::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("could not read the skin: {e}"))?;
    for item in entries.flatten() {
        let path = item.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        let ext = ext.to_ascii_lowercase();
        // Anything that is not a picture stays on disk. A skin is data.
        if !PICTURES.contains(&ext.as_str()) {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let bytes = std::fs::read(&path).map_err(|e| format!("could not read {name}: {e}"))?;
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "avif" => "image/avif",
            "gif" => "image/gif",
            "svg" => "image/svg+xml",
            _ => continue,
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        assets.insert(name.to_string(), format!("data:{mime};base64,{b64}"));
    }

    Ok(LoadedSkin { css, assets })
}

#[tauri::command]
pub fn zks_skin_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = skin_dir(&app, &id)?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("could not remove the skin: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn zks_skin_install(app: tauri::AppHandle, id: String) -> Result<(), String> {
    // Off the main thread, as the app installer is: this downloads an archive,
    // hashes it and unpacks it, and the window should keep answering.
    tauri::async_runtime::spawn_blocking(move || install_blocking(&app, &id))
        .await
        .map_err(|e| format!("the install did not finish: {e}"))?
}

fn install_blocking(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let s = entry(id)?;
    if let Some(why) = s.unavailable {
        return Err(why.to_string());
    }
    let (url, want) = match (s.download, s.sha256) {
        (Some(u), Some(h)) => (u, h),
        _ => return Err(format!("{} has nothing to install", s.name)),
    };
    if !host_allowed(url) {
        return Err(format!("refusing to fetch {url}"));
    }

    let mut res = reqwest::blocking::Client::builder()
        .user_agent(concat!("Shiro/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))?
        .get(url)
        .send()
        .map_err(|e| format!("could not reach {url}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("{url} answered {}", res.status()));
    }

    /* Read to a bound rather than to the end, and check the declared length
    first. The hash is what decides whether these bytes get to style somebody's
    app, and it cannot be checked until the download it guards has finished. */
    if let Some(total) = res.content_length() {
        if total > MAX_SKIN {
            return Err(format!("{url} claims {total} bytes, which is not a skin"));
        }
    }
    let mut bytes: Vec<u8> = Vec::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n =
            std::io::Read::read(&mut res, &mut buf).map_err(|e| format!("download failed: {e}"))?;
        if n == 0 {
            break;
        }
        if bytes.len() as u64 + n as u64 > MAX_SKIN {
            return Err(format!("{url} is larger than a skin should be"));
        }
        bytes.extend_from_slice(&buf[..n]);
    }

    let got = sha256_of(&bytes);
    if !got.eq_ignore_ascii_case(want) {
        return Err(format!(
            "{} did not match its published hash and was discarded - expected {want}, got {got}",
            s.name
        ));
    }

    let dir = skin_dir(app, s.id)?;
    let staging = dir.with_extension("unpacking");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("could not stage the skin: {e}"))?;
    unpack(&bytes, &staging)?;

    if !staging.join("skin.css").is_file() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("{} contains no skin.css", s.name));
    }

    // Swapped in rather than written over, so a failure leaves the old skin.
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::rename(&staging, &dir).map_err(|e| format!("could not place the skin: {e}"))?;
    if let Some(v) = s.version {
        let _ = std::fs::write(dir.join("installed-version"), v);
    }
    Ok(())
}

/// Unpack the archive, flat.
///
/// Entries are taken by file name only. A skin has no directories in it, and
/// honouring a path from an archive is how an archive writes outside the
/// directory it was given.
fn unpack(bytes: &[u8], into: &Path) -> Result<(), String> {
    let reader = std::io::Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("not a zip: {e}"))?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| format!("unreadable entry: {e}"))?;
        if f.is_dir() {
            continue;
        }
        // Owned before the write: `name()` borrows the entry, and copying out
        // of it needs the entry mutably.
        let Some(name) = Path::new(f.name())
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_owned)
        else {
            continue;
        };
        let out = into.join(&name);
        let mut w =
            std::fs::File::create(&out).map_err(|e| format!("could not write {name}: {e}"))?;
        std::io::copy(&mut f, &mut w).map_err(|e| format!("could not write {name}: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entry_that_can_be_installed_has_a_hash() {
        for s in CATALOGUE {
            if s.download.is_some() {
                assert!(s.sha256.is_some(), "{} has a download and no hash", s.id);
                assert!(
                    s.unavailable.is_none(),
                    "{} is both installable and unavailable",
                    s.id
                );
            } else {
                assert!(
                    s.unavailable.is_some(),
                    "{} has nothing to install and does not say why",
                    s.id
                );
            }
        }
    }

    #[test]
    fn ids_are_safe_to_put_in_a_path() {
        for s in CATALOGUE {
            assert!(
                !s.id.is_empty() && s.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
                "{} would not survive skin_dir",
                s.id
            );
        }
    }

    #[test]
    fn only_our_own_host_is_fetchable() {
        assert!(host_allowed("https://github.com/FIGHTORDER/shiro/releases/download/dev/x.zip"));
        assert!(!host_allowed("http://github.com/x.zip"), "plain http must not pass");
        assert!(!host_allowed("https://example.com/x.zip"));
        assert!(!host_allowed("https://github.com.evil.test/x.zip"));
    }

    /// A skin directory with something nasty in it, to prove what comes back.
    fn staged(files: &[(&str, &[u8])]) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "shiro-skin-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&base).unwrap();
        for (name, bytes) in files {
            std::fs::write(base.join(name), bytes).unwrap();
        }
        base
    }

    #[test]
    fn a_skin_hands_over_its_stylesheet_and_its_pictures() {
        let dir = staged(&[
            ("skin.css", b"[data-skin=\"x\"]{--text-hi:#000}"),
            // a real one-pixel PNG
            ("login.png", &[
                0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
                0x49, 0x48, 0x44, 0x52,
            ]),
        ]);
        let out = read_skin(&dir).unwrap();
        assert!(out.css.contains("--text-hi"));
        assert!(out.assets["login.png"].starts_with("data:image/png;base64,"));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The one that matters. A skin is data, so an archive that smuggles a
    /// script in beside the stylesheet must not get it handed to the page.
    #[test]
    fn nothing_executable_is_ever_returned() {
        let dir = staged(&[
            ("skin.css", b"[data-skin=\"x\"]{}"),
            ("evil.js", b"fetch('https://example.test')"),
            ("evil.html", b"<script>alert(1)</script>"),
            ("evil.wasm", b"\0asm"),
            ("notes.txt", b"harmless but still not a picture"),
        ]);
        let out = read_skin(&dir).unwrap();
        assert!(out.assets.is_empty(), "returned {:?}", out.assets.keys().collect::<Vec<_>>());
        assert!(!out.css.contains("script"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_directory_without_a_stylesheet_is_not_a_skin() {
        let dir = staged(&[("login.png", b"not really")]);
        assert!(read_skin(&dir).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_picture_list_that_cannot_execute() {
        for ext in PICTURES {
            assert!(
                !matches!(*ext, "js" | "mjs" | "html" | "htm" | "wasm"),
                "{ext} is not a picture"
            );
        }
    }
}
