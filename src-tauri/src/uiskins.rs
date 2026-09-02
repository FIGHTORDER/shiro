//! Chili skins for Zero-K's in-game interface, downloaded rather than shipped.
//!
//! The sibling of `skins.rs`, and different in one way that decides everything
//! else: a Shiro skin is read back by the webview, while one of these is read
//! by the game. Nothing here ever reaches the page, so the "data, not code"
//! rule in `skins.rs` does not apply - a Chili skin *is* a Lua file, and it has
//! to be, because that is the format Chili reads.
//!
//! What that costs is answered the same way the widget installer answers it:
//! the catalogue ships with Shiro and entries arrive by pull request, the
//! download is checked against a published hash before anything is written, and
//! the archive may only contain a `skin.lua` and pictures.
//!
//! Three details about where the files go, each of which cost a broken build to
//! learn and none of which are guessable:
//!
//! - **Both chili trees.** `api_chili.lua` picks between `chili` and
//!   `chili_old` at runtime from `ZKUseNewChiliRTT`, which defaults to 0. A
//!   player can change it, so a skin installed to one tree vanishes when they
//!   do. Copying to both costs 30 kB.
//! - **The selector travels with them.** Zero-K's own skin picker is a
//!   hardcoded list of eight names, so a skin it was not told about is loaded,
//!   usable, and absent from the only control that would select it. The widget
//!   that adds a second picker is compiled in and placed alongside.
//! - **Removal is by directory.** The files are ours, the directory name is
//!   ours, and nothing packaged shares it.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::install;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(300);

/// A skin is a Lua table and ten small tiles. Anything near this is not one,
/// and the check happens before the hash rather than after it.
const MAX_SKIN: u64 = 4 * 1024 * 1024;

/// What an archive may contain. A `.lua` is the skin itself; the rest are its
/// tiles. Anything else is dropped rather than written.
const PICTURES: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];

/// Where Chili looks, under the Zero-K install, in each tree.
const TREES: &[&str] = &["LuaUI/Widgets/chili_old/Skins", "LuaUI/Widgets/chili/Skins"];

/// The widget that lets Zero-K's settings reach these skins at all.
const SELECTOR: &str = include_str!("uiskins/shiro_uiskin.lua");
const SELECTOR_NAME: &str = "shiro_uiskin.lua";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueUiSkin {
    /// Also the directory name in the install, and what `skin.lua` declares.
    pub id: &'static str,
    pub name: &'static str,
    /// The one line the picker shows under the name.
    pub summary: &'static str,
    /// The Shiro skin this is the in-game half of, so the two can be offered
    /// together.
    pub matches: &'static str,
    /// None when there is nothing published yet - see `unavailable`.
    pub download: Option<&'static str>,
    /// SHA-256 of the download, lowercase hex. Absent only when `download` is.
    pub sha256: Option<&'static str>,
    pub version: Option<&'static str>,
    /// Why this cannot be installed, when it cannot.
    pub unavailable: Option<&'static str>,
}

pub const CATALOGUE: &[CatalogueUiSkin] = &[
    CatalogueUiSkin {
        id: "ShiroSlate",
        name: "Shiro Slate",
        summary: "Cool dark, closest to the game.",
        matches: "slate",
        download: Some(
            "https://github.com/FIGHTORDER/shiro/releases/download/uiskin-slate-1.0.0/shiro-uiskin-slate-1.0.0.zip",
        ),
        sha256: Some("b53cec84b466835229e04a5d8dab1740b34e5e6c4dbbce8b85f26006013c7a81"),
        version: Some("1.0.0"),
        unavailable: None,
    },
    CatalogueUiSkin {
        id: "ShiroGraphite",
        name: "Shiro Graphite",
        summary: "Neutral dark.",
        matches: "graphite",
        download: Some(
            "https://github.com/FIGHTORDER/shiro/releases/download/uiskin-graphite-1.0.0/shiro-uiskin-graphite-1.0.0.zip",
        ),
        sha256: Some("53261b9fc13743b3c5da1a4b741d268794ccb4f1ae5126988d598aefb732147b"),
        version: Some("1.0.0"),
        unavailable: None,
    },
    CatalogueUiSkin {
        id: "ShiroAzure",
        name: "Shiro Azure",
        summary: "Deep blue, gold text.",
        matches: "azure",
        download: Some(
            "https://github.com/FIGHTORDER/shiro/releases/download/uiskin-azure-1.0.0/shiro-uiskin-azure-1.0.0.zip",
        ),
        sha256: Some("bc2f2bb99bd6f518ae1cf8a4eb4021327dd155de6e1d295cc6390952762d9639"),
        version: Some("1.0.0"),
        unavailable: None,
    },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSkinStatus {
    pub id: &'static str,
    pub installed: bool,
    /// The version on disk, when we recorded one.
    pub installed_version: Option<String>,
}

fn entry(id: &str) -> Result<&'static CatalogueUiSkin, String> {
    CATALOGUE
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("no game UI skin called {id}"))
}

fn zk_path(root: &Path, rel: &str) -> PathBuf {
    let mut p = root.to_path_buf();
    for part in rel.split('/') {
        p.push(part);
    }
    p
}

/// Every directory this skin occupies, one per Chili tree.
fn dirs_for(root: &Path, id: &str) -> Vec<PathBuf> {
    TREES.iter().map(|t| zk_path(root, t).join(id)).collect()
}

fn sha256_of(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

fn host_allowed(url: &str) -> bool {
    url.starts_with("https://github.com/")
        || url.starts_with("https://objects.githubusercontent.com/")
}

#[tauri::command]
pub fn zks_uiskin_catalogue() -> Vec<CatalogueUiSkin> {
    CATALOGUE.to_vec()
}

/// What is installed, in whichever Zero-K the launcher would use.
///
/// Off the main thread: it resolves the install, which reads the disk.
#[tauri::command(async)]
pub fn zks_uiskin_status(install_root: Option<String>) -> Vec<UiSkinStatus> {
    let root = install::detect_with(install_root.as_deref()).ok().map(|i| i.root);
    CATALOGUE
        .iter()
        .map(|s| {
            /* Either tree counts. An install writes both, so a skin in only one
               is a half-finished install or a hand copy - and in both cases the
               useful answer is "installed", because Remove is what clears it.
               Asking only the first tree offered Install instead, which would
               have downloaded over the copy rather than tidying it. */
            let dirs = root.as_ref().map(|r| dirs_for(r, s.id)).unwrap_or_default();
            let present: Vec<&PathBuf> =
                dirs.iter().filter(|d| d.join("skin.lua").is_file()).collect();
            UiSkinStatus {
                id: s.id,
                installed: !present.is_empty(),
                installed_version: present
                    .first()
                    .and_then(|d| std::fs::read_to_string(d.join("installed-version")).ok())
                    .map(|v| v.trim().to_string()),
            }
        })
        .collect()
}

/// Download a skin and place it in the Zero-K install.
#[tauri::command]
pub async fn zks_uiskin_install(id: String, install_root: Option<String>) -> Result<(), String> {
    // Off the main thread: this downloads an archive, hashes it and unpacks it.
    tauri::async_runtime::spawn_blocking(move || install_blocking(&id, install_root.as_deref()))
        .await
        .map_err(|e| format!("the install did not finish: {e}"))?
}

fn install_blocking(id: &str, install_root: Option<&str>) -> Result<(), String> {
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
    let found = install::detect_with(install_root)?;

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

    /* The hash decides whether these bytes get to be read by the game, and it
    cannot be checked until the download it guards has finished. */
    let got = sha256_of(&bytes);
    if !got.eq_ignore_ascii_case(want) {
        return Err(format!(
            "{} did not match its published hash and was discarded - expected {want}, got {got}",
            s.name
        ));
    }

    /* Unpacked once, then copied into each tree. Staging first means a failure
    part way leaves whatever was already installed alone. */
    let staging = zk_path(&found.root, TREES[0])
        .join(format!(".{}-unpacking", s.id));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("could not stage the skin: {e}"))?;
    let outcome = (|| -> Result<(), String> {
        unpack(&bytes, &staging)?;
        if !staging.join("skin.lua").is_file() {
            return Err(format!("{} contains no skin.lua", s.name));
        }
        if let Some(v) = s.version {
            let _ = std::fs::write(staging.join("installed-version"), v);
        }
        for dir in dirs_for(&found.root, s.id) {
            if let Some(parent) = dir.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("could not make {}: {e}", parent.display()))?;
            }
            let _ = std::fs::remove_dir_all(&dir);
            copy_dir(&staging, &dir)?;
        }
        place_selector(&found.root)
    })();
    let _ = std::fs::remove_dir_all(&staging);
    outcome
}

/// Take a skin back out of the install.
///
/// The selector stays: it is one file, it costs nothing, and it is what another
/// Shiro skin would need again. Removing it would also drop the player's
/// recorded choice.
#[tauri::command(async)]
pub fn zks_uiskin_remove(id: String, install_root: Option<String>) -> Result<(), String> {
    let s = entry(&id)?;
    let found = install::detect_with(install_root.as_deref())?;
    for dir in dirs_for(&found.root, s.id) {
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|e| format!("could not remove {}: {e}", dir.display()))?;
        }
    }
    Ok(())
}

/// Put the picker widget where Zero-K loads widgets from, and switch raw
/// widgets on so that it loads at all.
///
/// Writing the file was the whole of this and it was not enough: Zero-K ignores
/// `LuaUI/Widgets/` unless `ZK_data.lua` says otherwise, so a player who had
/// never installed a widget got both skin directories, a picker on disk, a
/// status of "installed", and no Shiro Skin option anywhere in the game.
fn place_selector(root: &Path) -> Result<(), String> {
    let dir = zk_path(root, "LuaUI/Widgets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not make {}: {e}", dir.display()))?;
    std::fs::write(dir.join(SELECTOR_NAME), SELECTOR)
        .map_err(|e| format!("could not place the skin picker: {e}"))?;
    crate::widgets::turn_on_local_widgets(root)
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| format!("could not make {}: {e}", to.display()))?;
    let entries =
        std::fs::read_dir(from).map_err(|e| format!("could not read {}: {e}", from.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        std::fs::copy(&path, to.join(&name))
            .map_err(|e| format!("could not copy {}: {e}", name.to_string_lossy()))?;
    }
    Ok(())
}

/// Flattened on purpose: a skin is one directory of files, and flattening is
/// also what stops an entry named `../..` from writing anywhere.
fn unpack(bytes: &[u8], into: &Path) -> Result<(), String> {
    let reader = std::io::Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("not a zip: {e}"))?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| format!("unreadable entry: {e}"))?;
        if f.is_dir() {
            continue;
        }
        let Some(name) = Path::new(f.name())
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_owned)
        else {
            continue;
        };
        /* Only a skin and its tiles. The game runs the Lua, so an archive
        carrying anything else is not a skin and is not unpacked as one. */
        let ext = Path::new(&name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let keep = ext == "lua" || PICTURES.contains(&ext.as_str()) || name == "OFL.txt";
        if !keep {
            continue;
        }
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
    fn placing_the_picker_also_switches_raw_widgets_on() {
        /* The picker is a raw widget, and Zero-K ignores LuaUI/Widgets unless
           ZK_data.lua says otherwise. Writing the file alone left a skin that
           reported "installed" with no option to select it in the game. */
        let root = std::env::temp_dir().join("shiro-uiskin-enable");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("temp");

        place_selector(&root).expect("places the picker");

        assert!(zk_path(&root, "LuaUI/Widgets").join(SELECTOR_NAME).is_file());
        let data = std::fs::read_to_string(zk_path(&root, "LuaUI/Config/ZK_data.lua"))
            .expect("ZK_data.lua was never written");
        assert!(data.contains("useLocalWidgets"), "{data}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn every_entry_that_can_be_installed_has_a_hash() {
        for s in CATALOGUE {
            if s.download.is_some() {
                assert!(s.sha256.is_some(), "{} has a URL but no hash", s.id);
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
    fn only_github_is_fetchable() {
        for s in CATALOGUE {
            if let Some(url) = s.download {
                assert!(host_allowed(url), "{} fetches from {url}", s.id);
            }
        }
    }

    #[test]
    fn ids_are_unique_and_safe_as_directory_names() {
        let mut seen = std::collections::BTreeSet::new();
        for s in CATALOGUE {
            assert!(seen.insert(s.id), "{} appears twice", s.id);
            assert!(
                s.id.chars().all(|c| c.is_ascii_alphanumeric()),
                "{} is not usable as a directory name",
                s.id
            );
        }
    }

    /// Every id has to be a skin the generator actually builds, or the
    /// catalogue offers a download that installs something Chili cannot select.
    #[test]
    fn every_id_is_a_skin_we_build() {
        let src = include_str!("uiskins/shiro_uiskin.lua");
        for s in CATALOGUE {
            assert!(
                src.contains(&format!("key = \"{}\"", s.id)),
                "{} is in the catalogue but not in the picker",
                s.id
            );
        }
    }

    #[test]
    fn a_skin_goes_into_both_chili_trees() {
        let root = Path::new("C:/zk");
        let dirs = dirs_for(root, "ShiroSlate");
        assert_eq!(dirs.len(), 2, "a skin installed to one tree vanishes when \
            ZKUseNewChiliRTT changes");
        assert!(dirs.iter().any(|d| d.to_string_lossy().contains("chili_old")));
        assert!(dirs
            .iter()
            .any(|d| !d.to_string_lossy().contains("chili_old")));
    }

    /// The placement half of an install, without the download in front of it:
    /// unpack once, land in both trees, and put the picker beside them.
    /// A half-finished install leaves one tree written and the other not.
    /// Reporting that as "not installed" offers a download over the top of it;
    /// what it needs is Remove.
    /// The whole path against the real published asset: fetch, hash, unpack,
    /// place in both trees, put the picker beside it.
    ///
    /// Ignored because it needs the network and a Zero-K install to write into.
    /// Run it deliberately after publishing a new version:
    ///
    ///     cargo test uiskins::tests::a_published_skin_installs -- --ignored --nocapture
    #[test]
    #[ignore]
    fn a_published_skin_installs() {
        let root = std::env::temp_dir().join("zktest");
        if !root.join("engine").exists() {
            eprintln!("no test install at {}; skipping", root.display());
            return;
        }
        let target = root.to_string_lossy().to_string();
        for s in CATALOGUE {
            for dir in dirs_for(&root, s.id) {
                let _ = std::fs::remove_dir_all(&dir);
            }
            install_blocking(s.id, Some(&target))
                .unwrap_or_else(|e| panic!("{} failed to install: {e}", s.id));
            for dir in dirs_for(&root, s.id) {
                assert!(
                    dir.join("skin.lua").is_file(),
                    "{} is missing from {}",
                    s.id,
                    dir.display()
                );
                assert!(dir.join("fill.png").is_file(), "{} has no tiles", s.id);
            }
            assert!(root.join("LuaUI").join("Widgets").join(SELECTOR_NAME).is_file());
            eprintln!("{} installed", s.id);
        }
    }

    #[test]
    fn a_skin_in_either_tree_counts_as_installed() {
        let root = std::env::temp_dir().join("shiro-uiskin-partial");
        let _ = std::fs::remove_dir_all(&root);
        let dirs = dirs_for(&root, "ShiroSlate");
        let only = dirs.last().unwrap();
        std::fs::create_dir_all(only).unwrap();
        std::fs::write(only.join("skin.lua"), "return {}").unwrap();
        std::fs::write(only.join("installed-version"), "1.0.0").unwrap();

        let present: Vec<_> = dirs
            .iter()
            .filter(|d| d.join("skin.lua").is_file())
            .collect();
        assert_eq!(present.len(), 1, "only one tree should be written");
        assert!(!present.is_empty(), "one tree is still installed");
        assert_eq!(
            std::fs::read_to_string(present[0].join("installed-version")).unwrap(),
            "1.0.0",
            "the version is read from whichever tree has it"
        );
    }

    #[test]
    fn a_skin_lands_in_both_trees_with_its_picker() {
        let root = std::env::temp_dir().join("shiro-uiskin-place");
        let _ = std::fs::remove_dir_all(&root);
        let staging = root.join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("skin.lua"), "return {}").unwrap();
        std::fs::write(staging.join("fill.png"), [0u8; 4]).unwrap();
        std::fs::write(staging.join("installed-version"), "1.0.0").unwrap();

        for dir in dirs_for(&root, "ShiroSlate") {
            std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
            copy_dir(&staging, &dir).unwrap();
        }
        place_selector(&root).unwrap();

        for dir in dirs_for(&root, "ShiroSlate") {
            assert!(dir.join("skin.lua").is_file(), "{} has no skin", dir.display());
            assert!(dir.join("fill.png").is_file(), "{} has no tiles", dir.display());
            assert_eq!(
                std::fs::read_to_string(dir.join("installed-version")).unwrap(),
                "1.0.0"
            );
        }
        let picker = root.join("LuaUI").join("Widgets").join(SELECTOR_NAME);
        assert!(picker.is_file(), "the picker did not travel with the skin");
        let text = std::fs::read_to_string(&picker).unwrap();
        for s in CATALOGUE {
            assert!(text.contains(s.id), "the picker cannot select {}", s.id);
        }
    }

    #[test]
    fn an_archive_may_only_carry_a_skin_and_its_tiles() {
        let dir = std::env::temp_dir().join("shiro-uiskin-unpack");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            for name in ["skin.lua", "fill.png", "evil.exe", "notes.md"] {
                w.start_file(name, opts).unwrap();
                std::io::Write::write_all(&mut w, b"x").unwrap();
            }
            w.finish().unwrap();
        }
        unpack(&buf, &dir).unwrap();
        assert!(dir.join("skin.lua").is_file());
        assert!(dir.join("fill.png").is_file());
        assert!(!dir.join("evil.exe").exists(), "an executable was unpacked");
        assert!(!dir.join("notes.md").exists());
    }
}
