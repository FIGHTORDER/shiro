//! Zero-K, installed by Shiro rather than found.
//!
//! Shiro has always needed somebody else to have installed the game. This is
//! the other mode: a directory Shiro owns, an engine fetched from Zero-K's own
//! server, and the game pulled in by the `pr-downloader` that arrives inside
//! that engine. Nothing here replaces detection - a Steam install is still used
//! when there is one, and the two modes sit side by side.
//!
//! The order matters and is the whole trick. The engine package contains
//! `pr-downloader`, so fetching one 45 MB zip turns an empty folder into
//! something that can fetch everything else. There is no bootstrap problem to
//! solve, and nothing here needs a cooperating third party: the engine comes
//! from `zero-k.info`, the game from `repos.springrts.com` over rapid, and both
//! are the same bytes the official client would install.
//!
//! What this deliberately does not do is decide *when*. Setting up an install
//! downloads gigabytes; it happens because somebody asked for it, in Settings,
//! and never because a battle wanted a map.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::engine;
use crate::loadscreen;
use crate::install;

/// Where the engine download reports itself.
const ENGINE_EVENT: &str = "zks://engine";

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EngineStatus {
    Started { version: String },
    Progress { received: u64, total: u64 },
    Done { version: String, path: String },
    Failed { reason: String },
}

/// The directory Shiro fills when it is managing the install itself.
///
/// Under the app's own data directory rather than beside the binary: the
/// binary's folder is not writable on a per-machine install, and a game that
/// cannot download is worse than one that is somewhere unexpected.
pub fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no data directory: {e}"))?;
    Ok(base.join("zk"))
}

/// Where Shiro would put a managed install, whether or not one is there yet.
#[tauri::command]
pub fn zks_managed_root(app: tauri::AppHandle) -> Result<String, String> {
    Ok(root(&app)?.display().to_string())
}

/// Is there one, and what is in it?
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedState {
    pub root: String,
    /// The directory exists and Shiro made it.
    pub prepared: bool,
    /// An engine of the version asked about is installed in it.
    pub engine_installed: bool,
    /// Archives the engine has scanned there - zero on a fresh one.
    pub archives: usize,
}

/// Async because counting archives reads the engine's caches, which run to
/// megabytes on a full install - not something to do on the main thread even
/// with the reading memoised.
#[tauri::command]
pub async fn zks_managed_state(
    app: tauri::AppHandle,
    engine_version: Option<String>,
) -> Result<ManagedState, String> {
    tauri::async_runtime::spawn_blocking(move || managed_state_blocking(app, engine_version))
        .await
        .map_err(|e| format!("reading the managed install did not finish: {e}"))?
}

fn managed_state_blocking(
    app: tauri::AppHandle,
    engine_version: Option<String>,
) -> Result<ManagedState, String> {
    let dir = root(&app)?;
    let version = engine_version.unwrap_or_default();
    Ok(ManagedState {
        prepared: install::is_managed(&dir),
        engine_installed: !version.is_empty() && engine::installed(&dir, &version),
        archives: crate::archives::installed(&dir).len(),
        root: dir.display().to_string(),
    })
}

/// Create the directory and mark it as Shiro's.
///
/// Separate from installing anything, so the folder exists - and is visible in
/// Settings - before several gigabytes start arriving into it.
#[tauri::command]
pub fn zks_managed_prepare(app: tauri::AppHandle) -> Result<String, String> {
    let dir = root(&app)?;
    install::make_managed(&dir)?;
    /* Placed with the install rather than on first launch, so it is there
       before anything can need it - and removable from Settings, since what the
       game looks like is the player's call, not the launcher's. */
    if let Err(e) = loadscreen::ensure_default(&dir) {
        eprintln!("could not place the loading screen: {e}");
    }
    Ok(dir.display().to_string())
}

/// Fetch and unpack the engine the server asked for.
///
/// Blocking, and deliberately not silent: it emits progress on `zks://engine`
/// so Settings can show a bar rather than appearing to hang for 45 MB.
#[tauri::command]
pub async fn zks_managed_install_engine(
    app: tauri::AppHandle,
    version: String,
) -> Result<String, String> {
    let dir = root(&app)?;
    install::make_managed(&dir)?;

    let handle = app.clone();
    let v = version.clone();
    let done = tauri::async_runtime::spawn_blocking(move || {
        let _ = handle.emit(ENGINE_EVENT, EngineStatus::Started { version: v.clone() });
        let progress_app = handle.clone();
        let out = engine::ensure(&dir, &v, &move |received, total| {
            let _ = progress_app.emit(ENGINE_EVENT, EngineStatus::Progress { received, total });
        });
        match &out {
            Ok(path) => {
                let _ = handle.emit(ENGINE_EVENT, EngineStatus::Done {
                    version: v.clone(),
                    path: path.display().to_string(),
                });
            }
            Err(reason) => {
                let _ = handle.emit(ENGINE_EVENT, EngineStatus::Failed { reason: reason.clone() });
            }
        }
        out
    })
    .await
    .map_err(|e| format!("the engine install did not finish: {e}"))??;

    Ok(done.display().to_string())
}

/// Is Shiro's loading screen in place, and could it be?
///
/// Only offered for an install Shiro owns. Somebody else's Zero-K directory is
/// theirs, and writing a file into it uninvited is not something a launcher
/// should do quietly.
#[tauri::command]
pub fn zks_loadscreen_state(app: tauri::AppHandle) -> Result<bool, String> {
    let dir = root(&app)?;
    Ok(install::is_managed(&dir) && loadscreen::installed(&dir))
}

/// Turn Shiro's loading screen on or off.
#[tauri::command]
pub fn zks_loadscreen_set(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let dir = root(&app)?;
    if !install::is_managed(&dir) {
        return Err("Shiro only writes into an installation it made.".into());
    }
    if enabled {
        loadscreen::install(&dir)?;
    } else {
        loadscreen::remove(&dir)?;
    }
    Ok(loadscreen::installed(&dir))
}

/// Put the loading screen in place for an install Shiro owns, unless it was
/// turned off. Called at startup, so an install made before the screen existed
/// gets it too rather than needing the switch found and pressed.
pub fn seed_loadscreen(app: &tauri::AppHandle) {
    let Ok(dir) = root(app) else { return };
    if !install::is_managed(&dir) {
        return;
    }
    if let Err(e) = loadscreen::ensure_default(&dir) {
        eprintln!("could not place the loading screen: {e}");
    }
}

/// Remove a managed install.
///
/// Only ever the directory Shiro made, and only when it says it is ours - the
/// marker is checked rather than assumed, because this deletes gigabytes and a
/// wrong path here would delete somebody's Steam library.
#[tauri::command]
pub fn zks_managed_remove(app: tauri::AppHandle) -> Result<(), String> {
    let dir = root(&app)?;
    if !dir.exists() {
        return Ok(());
    }
    if !install::is_managed(&dir) {
        return Err(format!(
            "{} is not a Shiro-managed install, so it will not be removed.",
            dir.display()
        ));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("could not remove {}: {e}", dir.display()))
}

#[cfg(test)]
mod tests {
    use crate::install;

    #[test]
    fn only_a_directory_we_marked_counts_as_ours() {
        // The guard on `zks_managed_remove`: this decides whether several
        // gigabytes get deleted, so it asks rather than assumes.
        let dir = std::env::temp_dir().join("shiro-managed-marker");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!install::is_managed(&dir));
        install::make_managed(&dir).unwrap();
        assert!(install::is_managed(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_marked_directory_is_usable_before_anything_is_in_it() {
        // The reason the marker exists: an empty folder is not recognisably a
        // Zero-K install, and it has to be handed to the installer anyway.
        let dir = std::env::temp_dir().join("shiro-managed-empty");
        let _ = std::fs::remove_dir_all(&dir);
        install::make_managed(&dir).unwrap();
        let found = install::detect_with(Some(&dir.display().to_string())).unwrap();
        assert_eq!(found.root, dir);
        assert_eq!(found.source, "Shiro");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
