//! The app launcher: a small, curated set of tools Shiro can install and run.
//!
//! Not a plugin host and not a marketplace. Nothing here runs inside Shiro's
//! webview, so none of the sandboxing problems of a plugin apply. What applies
//! instead is that we are downloading executables and running them, which
//! deserves more care than a plugin would, not less:
//!
//! - **The catalogue ships with Shiro.** It is the constant below, not a URL.
//!   Nobody can add an entry by serving a file; adding one is a pull request.
//!   That is also why the source repository is not printed in the launcher: the
//!   entry cannot have come from anywhere else, so naming it told the user
//!   nothing they could act on.
//! - **Downloads are verified against a hash pinned in that catalogue**, and
//!   land in Shiro's own app directory rather than anywhere the user browses to.
//! - **Nothing is ever launched that the user did not just ask to launch.** No
//!   run-after-install, no autostart.
//!
//! Everything in the catalogue is a separate program. Splaunch and Sprofiler
//! started as screens in here and were taken out: a scenario editor has nothing
//! to do with a lobby, and a lobby should not have to carry one.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// How an app is delivered.
///
/// Only one variant today, and it is kept rather than removed because "what
/// kind of thing is this" is the question the launcher will have to answer
/// again the moment something arrives that is not a Windows executable.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppKind {
    /// A program we download and start.
    Executable,
}

/// One entry in the catalogue.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueApp {
    pub id: &'static str,
    pub name: &'static str,
    pub summary: &'static str,
    pub description: &'static str,
    pub kind: AppKind,
    /// None when there is nothing published yet - see `unavailable`.
    pub download: Option<&'static str>,
    /// SHA-256 of the download, lowercase hex. Absent only when `download` is.
    pub sha256: Option<&'static str>,
    pub version: Option<&'static str>,
    /// The file to run once installed, relative to the app's directory.
    pub run: Option<&'static str>,
    /// Set when the app cannot be installed at all, and says why in a sentence
    /// a person can act on. A row that is merely broken is the failure to avoid.
    pub unavailable: Option<&'static str>,
    /// Shipped inside Shiro and copied into place on first run, rather than
    /// downloaded. Still uninstallable, and still re-downloadable afterwards -
    /// bundling changes where the first copy comes from, not who is in charge
    /// of it.
    ///
    /// The path is inside Shiro's resource directory. It is `None` in a build
    /// that did not fetch the resource, and the app simply behaves like every
    /// other entry then.
    pub bundled: Option<&'static str>,
}

/// The catalogue: the tools Shiro can install and run.
///
/// All of them are separate programs with their own repositories. Splaunch and
/// Sprofiler began life as screens in here and were taken out - a scenario
/// editor has nothing to do with a lobby, and a lobby should not have to carry
/// one. What is left is a launcher, which is a smaller and more honest thing.
pub const CATALOGUE: &[CatalogueApp] = &[
    CatalogueApp {
        id: "sprofiler",
        name: "Sprofiler",
        summary: "Check whether Zero-K will run well on this machine",
        description: "Zero-K performance profiling tool",
        kind: AppKind::Executable,
        download: Some(
            "https://github.com/FIGHTORDER/Sprofiler/releases/download/dev/Sprofiler_1.0.0_x64.zip",
        ),
        sha256: Some("ba287bfd3796b09ebc394a16e4d3d91ff0c6087c436e56a85cf44f083a3490c6"),
        version: Some("1.0.0"),
        run: Some("Sprofiler.exe"),
        unavailable: None,
        // Small enough to travel with the lobby, and the first thing somebody
        // with a broken install needs - asking them to download a tool to find
        // out why downloads are slow is a poor first experience.
        bundled: Some("resources/sprofiler/Sprofiler.exe"),
    },
    /* All three of these hang on a `dev` tag, which is mutable: republishing
    one changes the bytes behind a URL that did not change. The hash is what
    makes that safe rather than silent - the launcher refuses to install a
    download that does not match, and tools/fetch-bundled-apps.mjs refuses to
    bundle one - but it does mean a republish needs a hash bump here before
    either path will accept the new file. Immutable per-version tags upstream
    would remove the coupling entirely. */
    CatalogueApp {
        id: "stournament",
        name: "Stournament",
        summary: "Run a Zero-K tournament, and picture its map pool",
        description: "Tournament control and map pool images for Zero-K",
        kind: AppKind::Executable,
        download: Some(
            "https://github.com/FIGHTORDER/stournament/releases/download/dev/Stournament_1.0.0_x64.zip",
        ),
        sha256: Some("88194fa90b9da52d27ce6002abb6cd1c4bb910728ada6e3345c3ddcb3716b08e"),
        version: Some("1.0.0"),
        run: Some("Stournament.exe"),
        /* Tourney control needs a permission most people do not have, and the
        app says so itself on first run. Not marked unavailable: the map pool
        generator half needs nothing at all, and dimming the row would hide a
        tool anyone can use behind a permission only a few have. */
        unavailable: None,
        // Not bundled. Sprofiler travels with Shiro because somebody whose
        // install is broken needs it before they can download anything; nothing
        // about running a tournament is urgent in that way.
        bundled: None,
    },
    CatalogueApp {
        id: "splaunch",
        name: "Splaunch",
        summary: "Build Zero-K scenarios and play them",
        description: "Scenario editor for the Spring and Recoil RTS engines",
        kind: AppKind::Executable,
        download: Some(
            "https://github.com/FIGHTORDER/Splaunch/releases/download/dev/Splaunch_1.0.0_x64.zip",
        ),
        sha256: Some("97e89015d6b82195202d9a332459472912c17548c966cf2efe385fd405fe11a8"),
        version: Some("1.0.0"),
        run: Some("Splaunch.exe"),
        unavailable: None,
        bundled: None,
    },
    CatalogueApp {
        id: "springen",
        name: "Springen",
        summary: "Node-graph map generator for Spring and Zero-K",
        description: "Node-based map generator tool for Zero-K",
        kind: AppKind::Executable,
        download: Some(
            "https://github.com/FIGHTORDER/Springen/releases/download/dev/Springen_1.0.0_x64.zip",
        ),
        // Verified by hand against the downloaded file, not copied from the
        // release notes: this value is what decides whether the bytes are
        // allowed to become a program, so it is worth checking rather than
        // trusting the thing it is meant to check.
        sha256: Some("b59308fc4e515e742444b942657d6dd19ad9fb88556dd94069da9efaf3f2f3c3"),
        version: Some("1.0.0"),
        run: Some("springen-app.exe"),
        unavailable: None,
        bundled: None,
    },
];

/// What the launcher shows for one app: the catalogue entry plus what is true
/// of it on this machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub id: String,
    pub installed: bool,
    /// The version on disk, when we recorded one.
    pub installed_version: Option<String>,
    pub path: Option<String>,
    /// Why this app cannot be used on this machine, if it cannot.
    ///
    /// `why_not` already blocked the install and the launch, but its answer
    /// stopped in Rust: the catalogue's own `unavailable` is a compile-time
    /// constant and is None for every entry, so on Linux every row drew an
    /// Install button for a Windows .exe and every press failed. The reason is
    /// worked out per machine, so it belongs on the status rather than the
    /// catalogue.
    pub unavailable: Option<String>,
}

/// Where installed apps live: Shiro's own data directory, never the Zero-K one.
///
/// `content.rs` and `install.rs` own the Zero-K data directory and a second
/// writer is how two tools end up disagreeing about what is installed.
pub fn apps_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    apps_dir_with(app, None)
}

/// Where apps live, honouring a folder the player chose.
///
/// The same shape as `install::detect_with`: an empty or absent override means
/// the default, so a cleared setting is not a path of its own. Apps already
/// sitting in the chosen folder are found there, which is the point - pointing
/// Shiro at a folder should show what is in it, not start it empty.
pub fn apps_dir_with(app: &tauri::AppHandle, root: Option<&str>) -> Result<PathBuf, String> {
    if let Some(root) = root.map(str::trim).filter(|r| !r.is_empty()) {
        return Ok(PathBuf::from(root));
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no data directory: {e}"))?;
    Ok(base.join("apps"))
}

fn app_dir_with(app: &tauri::AppHandle, id: &str, root: Option<&str>) -> Result<PathBuf, String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("not an app id: {id:?}"));
    }
    Ok(apps_dir_with(app, root)?.join(id))
}

fn entry(id: &str) -> Result<&'static CatalogueApp, String> {
    CATALOGUE
        .iter()
        .find(|a| a.id == id)
        .ok_or_else(|| format!("no such app: {id}"))
}

/// The catalogue, as shipped.
#[tauri::command]
pub fn zka_catalogue() -> Vec<CatalogueApp> {
    CATALOGUE.to_vec()
}

/// What is installed, on this machine, right now.
///
/// Read from disk every time rather than remembered: a person who deletes the
/// directory has uninstalled it, and a launcher that disagrees is worse than
/// one that is a little slower.
///
/// Seeds the bundled apps into the folder it is asked about, first. Startup
/// seeding runs before any window exists and so knows only the default folder,
/// while the chosen one lives in a frontend setting - so pointing Shiro at
/// another drive used to put the bundled Sprofiler somewhere the Apps screen
/// never looks, and offer a 9 MB download of a file already on disk. This is
/// the first moment Rust is told which folder the player means.
///
/// Off the main thread, as the installer is: seeding can copy that 9 MB.
#[tauri::command]
pub async fn zka_status(
    app: tauri::AppHandle,
    apps_root: Option<String>,
) -> Result<Vec<AppStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || status_blocking(&app, apps_root.as_deref()))
        .await
        .map_err(|e| format!("could not read the app folder: {e}"))?
}

fn status_blocking(app: &tauri::AppHandle, apps_root: Option<&str>) -> Result<Vec<AppStatus>, String> {
    /* Best effort: a folder that cannot be seeded is still a folder worth
    reporting the truth about, and the row falls back to offering the
    download it would have offered anyway. */
    if let Err(e) = seed_bundled_with(app, apps_root) {
        eprintln!("could not place the bundled apps: {e}");
    }
    let mut out = Vec::new();
    for a in CATALOGUE {
        let dir = app_dir_with(app, a.id, apps_root)?;
        let exe = a.run.map(|r| dir.join(r));
        let installed = exe.as_deref().map(Path::is_file).unwrap_or(false);
        let version = std::fs::read_to_string(dir.join("installed-version"))
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        out.push(AppStatus {
            id: a.id.into(),
            installed,
            installed_version: version,
            path: exe.filter(|_| installed).map(|p| p.display().to_string()),
            unavailable: why_not(a),
        });
    }
    Ok(out)
}

/// Why this entry cannot be used here, if it cannot.
///
/// The catalogue's own reason first, then the platform's: every app in it is a
/// Windows build, and on Linux the row offered to install a `.exe` that could
/// never run. Saying so is better than a download that ends in "not
/// executable", and better than hiding the row - somebody looking for
/// Sprofiler should find out why it is not here.
fn why_not(a: &CatalogueApp) -> Option<String> {
    if let Some(why) = a.unavailable {
        return Some(why.to_string());
    }
    if !cfg!(windows)
        && a.run
            .is_some_and(|r| r.to_ascii_lowercase().ends_with(".exe"))
    {
        return Some(format!("{} is a Windows program.", a.name));
    }
    None
}

/// Where we remember that somebody removed a bundled app on purpose.
///
/// A sibling of the app's directory rather than a file inside it, because
/// uninstalling deletes that directory - the note has to outlive the thing it
/// is about. Without it, every launch would helpfully reinstall the app the
/// user just removed, which is the kind of helpfulness nobody asks for twice.
///
/// A sibling of the *chosen* folder's directory, not the default one's. A
/// note filed somewhere other than beside the thing it describes says nothing
/// about it: an uninstall from a folder the player picked used to leave the
/// note in the default folder, where seeding read it and skipped an app that
/// was never removed there.
fn removal_marker_with(
    app: &tauri::AppHandle,
    id: &str,
    root: Option<&str>,
) -> Result<PathBuf, String> {
    Ok(apps_dir_with(app, root)?.join(format!("{id}.removed")))
}

/// Put bundled apps in the default folder, once, on startup.
pub fn seed_bundled(app: &tauri::AppHandle) -> Result<(), String> {
    seed_bundled_with(app, None)
}

/// Put bundled apps in place, once, for one apps folder.
///
/// Three things stop this: the app is already there, the user removed it, or
/// this build has no bundled copy to place. A version mismatch does *not* stop
/// it - a Shiro carrying a newer Sprofiler should hand it over rather than make
/// the user download what it already has.
///
/// Every folder is its own world: the copy and the removal note are siblings,
/// so a folder the player pointed Shiro at gets the bundled app the first time
/// it is looked at, and an app removed there stays removed there.
pub fn seed_bundled_with(app: &tauri::AppHandle, root: Option<&str>) -> Result<(), String> {
    for a in CATALOGUE {
        let (Some(rel), Some(run)) = (a.bundled, a.run) else {
            continue;
        };
        // A Windows binary placed on Linux is an app that appears installed and
        // fails when pressed.
        if why_not(a).is_some() {
            continue;
        }
        if removal_marker_with(app, a.id, root)?.exists() {
            continue;
        }

        let dir = app_dir_with(app, a.id, root)?;
        let exe = dir.join(run);
        let installed_version = std::fs::read_to_string(dir.join("installed-version"))
            .ok()
            .map(|s| s.trim().to_string());
        if exe.is_file() && installed_version.as_deref() == a.version {
            continue;
        }

        // Absent in a local build that skipped the fetch, which is not an error
        // - it just means this copy of Shiro carries no Sprofiler.
        let Ok(src) = app
            .path()
            .resolve(rel, tauri::path::BaseDirectory::Resource)
        else {
            continue;
        };
        if !src.is_file() {
            continue;
        }

        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        std::fs::copy(&src, &exe).map_err(|e| format!("could not place {}: {e}", exe.display()))?;
        if let Some(v) = a.version {
            let _ = std::fs::write(dir.join("installed-version"), v);
        }
    }
    Ok(())
}

/// The variable an app is told the Zero-K directory in.
///
/// Shiro installs Zero-K itself now, into a directory it owns rather than the
/// one an installer would have used, so "wherever Zero-K normally goes" is no
/// longer an answer a separate program can reach on its own. Sprofiler read
/// that as "no Zero-K installed" for anybody whose copy came from here.
///
/// It could have been an argument. A variable is what an app can ignore
/// without being taught to parse anything, which matters when the same launch
/// path starts three programs that were written at different times and only
/// one of them cares.
pub const ROOT_ENV: &str = "SHIRO_ZK_ROOT";

/// The Zero-K directory to hand an app, if we are sure of one.
///
/// Detection failing is not a reason to refuse a launch. The app most likely to
/// be started by somebody whose install is broken is the one that explains why
/// installs break - so a launch with nothing to say goes ahead saying nothing,
/// and the app falls back to looking for itself.
fn handed_root(install_root: Option<&str>) -> Option<PathBuf> {
    crate::install::detect_with(install_root)
        .ok()
        .map(|i| i.root)
}

/// Start an installed app.
///
/// Only ever from a catalogue entry's own `run` path inside its own directory,
/// so this cannot be talked into starting something else.
/// Off the main thread, as the installer is: this stats the executable and
/// detects the Zero-K directory, both of which touch the disk.
#[tauri::command]
pub async fn zka_launch(
    app: tauri::AppHandle,
    id: String,
    install_root: Option<String>,
    apps_root: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        launch_blocking(&app, &id, install_root.as_deref(), apps_root.as_deref())
    })
    .await
    .map_err(|e| format!("the launch did not finish: {e}"))?
}

fn launch_blocking(
    app: &tauri::AppHandle,
    id: &str,
    install_root: Option<&str>,
    apps_root: Option<&str>,
) -> Result<(), String> {
    let a = entry(id)?;
    if let Some(why) = why_not(a) {
        return Err(why);
    }
    let run = a
        .run
        .ok_or_else(|| format!("{} is not something to run", a.name))?;
    let exe = app_dir_with(app, a.id, apps_root)?.join(run);
    if !exe.is_file() {
        return Err(format!("{} is not installed", a.name));
    }
    let mut command = Command::new(&exe);
    command.current_dir(exe.parent().unwrap_or(Path::new(".")));
    if let Some(root) = handed_root(install_root) {
        command.env(ROOT_ENV, root);
    }
    command
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", a.name))?;
    Ok(())
}

/// Only these hosts may be fetched from, whatever the catalogue says.
///
/// The catalogue is compiled in, so this is belt and braces - but it is the
/// belt that stops a bad edit becoming a download from anywhere.
fn host_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host).to_ascii_lowercase();
    host == "github.com" || host.ends_with(".github.com") || host == "objects.githubusercontent.com"
}

fn sha256_of(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Unpack a zip into `dir`, refusing any entry that would land outside it.
///
/// A zip is a list of paths somebody else chose, and `../../` in one of them is
/// the oldest trick there is.
fn unpack(bytes: &[u8], dir: &Path) -> Result<(), String> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("not a zip: {e}"))?;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("unreadable entry: {e}"))?;
        let Some(rel) = file.enclosed_name() else {
            return Err(format!(
                "refusing an unsafe path in the archive: {}",
                file.name()
            ));
        };
        let target = dir.join(rel);
        if !target.starts_with(dir) {
            return Err(format!(
                "refusing an entry outside the app directory: {}",
                file.name()
            ));
        }
        if file.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| format!("{}: {e}", target.display()))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        let mut out =
            std::fs::File::create(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        std::io::copy(&mut file, &mut out).map_err(|e| format!("{}: {e}", target.display()))?;
    }
    Ok(())
}

/// How long an app download may take to start, and to finish.
///
/// The total is generous because the catalogue's apps are small but somebody's
/// line may not be; what it exists for is the connection that accepts and then
/// says nothing, which without a deadline holds the install open for ever.
const APP_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const APP_TOTAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// The largest an app may be. Not a security boundary - the hash is - but a
/// confused or hostile server should not be able to fill the disk before the
/// hash gets a chance to reject what arrived. The catalogue's apps are 3-15 MB.
const MAX_APP: u64 = 256 * 1024 * 1024;

/// Where an install is assembled before it replaces the one in use.
///
/// A sibling of the app's own directory rather than a child, so that clearing
/// the old one cannot take it with it, and so the final step is a rename
/// within one directory rather than a copy across two.
fn staging_dir(dir: &Path) -> PathBuf {
    let mut name = dir.file_name().unwrap_or_default().to_os_string();
    name.push(".installing");
    dir.with_file_name(name)
}

/// Download an app, check it against the hash in the catalogue, and unpack it.
///
/// The hash is the point. The download is over HTTPS from a host we allow, but
/// it is the hash that decides whether the bytes get to become a program on
/// somebody's machine - so a mismatch deletes what it fetched and says so.
#[tauri::command]
pub async fn zka_install(
    app: tauri::AppHandle,
    id: String,
    apps_root: Option<String>,
) -> Result<(), String> {
    /* Off the main thread. A synchronous command runs on it, and this one
    downloads a whole release, hashes it and unpacks it - so the window
    stopped answering for as long as that took, with no way to cancel a
    server that had gone quiet mid-body. */
    tauri::async_runtime::spawn_blocking(move || {
        install_blocking(&app, &id, apps_root.as_deref())
    })
        .await
        .map_err(|e| format!("the install did not finish: {e}"))?
}

fn install_blocking(
    app: &tauri::AppHandle,
    id: &str,
    apps_root: Option<&str>,
) -> Result<(), String> {
    let a = entry(id)?;
    if let Some(why) = why_not(a) {
        return Err(why);
    }
    let (url, want) = match (a.download, a.sha256) {
        (Some(u), Some(h)) => (u, h),
        _ => return Err(format!("{} has nothing to install", a.name)),
    };
    if !host_allowed(url) {
        return Err(format!("refusing to fetch {url}"));
    }

    let mut res = reqwest::blocking::Client::builder()
        .user_agent(concat!("Shiro/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(APP_CONNECT_TIMEOUT)
        .timeout(APP_TOTAL_TIMEOUT)
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))?
        .get(url)
        .send()
        .map_err(|e| format!("could not reach {url}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("{url} answered {}", res.status()));
    }

    /* Read to a bound rather than to the end. `bytes()` believes whatever the
    other end sends, and the other end is only trusted after the hash - which
    cannot be checked until the download it is meant to guard has already
    finished. The declared length is checked first, because a server honest
    about being wrong should not be downloaded from at all. */
    if let Some(total) = res.content_length() {
        if total > MAX_APP {
            return Err(format!("{url} claims {total} bytes, which is not an app"));
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
        if bytes.len() as u64 + n as u64 > MAX_APP {
            return Err(format!("{url} is larger than an app should be"));
        }
        bytes.extend_from_slice(&buf[..n]);
    }

    let got = sha256_of(&bytes);
    if !got.eq_ignore_ascii_case(want) {
        return Err(format!(
            "{} did not match its published hash and was discarded - expected {want}, got {got}",
            a.name
        ));
    }

    let dir = app_dir_with(app, a.id, apps_root)?;

    /* Unpacked beside the install and swapped in, rather than over it.
    Clearing first and unpacking after means a failure between the two
    leaves no app at all - and worse, it can half-succeed: a locked
    executable survives `remove_dir_all` while everything around it is
    deleted, leaving the old program in place with none of the files that
    say what it is. That state reads as a healthy install to everything
    downstream, and there is no way out of it from inside the app. */
    let staged = staging_dir(&dir);
    if staged.is_dir() {
        std::fs::remove_dir_all(&staged)
            .map_err(|e| format!("could not clear {}: {e}", staged.display()))?;
    }
    std::fs::create_dir_all(&staged)
        .map_err(|e| format!("could not create {}: {e}", staged.display()))?;

    let outcome = (|| {
        unpack(&bytes, &staged)?;
        /* Written into the staging copy so it arrives with everything else.
        A version this cannot record is an install nothing can tell apart
        from any other, so it is a failure rather than a best effort. */
        if let Some(v) = a.version {
            std::fs::write(staged.join("installed-version"), v)
                .map_err(|e| format!("could not record the version of {}: {e}", a.name))?;
        }
        Ok::<(), String>(())
    })();
    if let Err(e) = outcome {
        let _ = std::fs::remove_dir_all(&staged);
        return Err(e);
    }

    if dir.is_dir() {
        if let Err(e) = std::fs::remove_dir_all(&dir) {
            let _ = std::fs::remove_dir_all(&staged);
            /* Named as the likely cause rather than asserted as one:
            Windows refuses to replace the image of a running program and
            that is nearly always what this is, but a read-only file looks
            identical from here, and guessing wrong sends somebody hunting
            for a process that was never running. */
            return Err(format!(
                "{} could not be replaced - if it is open, close it and install again: {e}",
                a.name
            ));
        }
    }
    std::fs::rename(&staged, &dir)
        .map_err(|e| format!("could not put {} in place: {e}", a.name))?;
    // Asking for it back cancels the note that said not to put it there.
    if a.bundled.is_some() {
        let _ = std::fs::remove_file(removal_marker_with(app, a.id, apps_root)?);
    }
    Ok(())
}

/// Remove an installed app. Its own directory, and nothing above it.
/// Off the main thread, as the installer is: removing a directory tree is disk
/// work, and on Windows it can be slow enough to be seen.
#[tauri::command]
pub async fn zka_uninstall(
    app: tauri::AppHandle,
    id: String,
    apps_root: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        uninstall_blocking(&app, &id, apps_root.as_deref())
    })
    .await
    .map_err(|e| format!("the removal did not finish: {e}"))?
}

fn uninstall_blocking(
    app: &tauri::AppHandle,
    id: &str,
    apps_root: Option<&str>,
) -> Result<(), String> {
    let a = entry(id)?;
    let dir = app_dir_with(app, a.id, apps_root)?;

    /* The note goes down before the directory does. Written afterwards, a
    failed write - or a crash between the two - left the app removed with
    nothing saying so, and the next start put it straight back. */
    let marker = match a.bundled {
        Some(_) => {
            let path = removal_marker_with(app, a.id, apps_root)?;
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(&path, "removed by the user\n")
                .map_err(|e| format!("could not record the removal: {e}"))?;
            Some(path)
        }
        None => None,
    };

    let undo = |marker: &Option<PathBuf>| {
        if let Some(path) = marker {
            let _ = std::fs::remove_file(path);
        }
    };

    if dir.is_dir() {
        if let Err(e) = std::fs::remove_dir_all(&dir) {
            undo(&marker);
            return Err(format!("could not remove {}: {e}", dir.display()));
        }
    }
    // Windows has been known to report success while the directory is still
    // going away, and a launcher that says "removed" about something still
    // there is worse than one that admits it failed.
    if dir.exists() {
        undo(&marker);
        return Err(format!("{} could not be removed - is it running?", a.name));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bundled_app_is_still_downloadable() {
        /* Bundling is where the first copy comes from, not a replacement for
        the download. An entry that shipped inside Shiro with no way to fetch
        it again could be removed once and never recovered. */
        for a in CATALOGUE {
            if a.bundled.is_some() {
                assert!(
                    a.download.is_some(),
                    "{} is bundled with nothing to re-fetch",
                    a.id
                );
                assert!(a.sha256.is_some(), "{} is bundled with no hash", a.id);
                assert!(a.run.is_some(), "{} is bundled with nothing to run", a.id);
                assert!(a.version.is_some(), "{} is bundled with no version", a.id);
            }
        }
    }

    #[test]
    fn a_bundled_path_stays_inside_the_resource_directory() {
        // It is joined onto Shiro's resource directory at runtime, so a `..`
        // here would read from wherever the installer happens to sit.
        for a in CATALOGUE {
            let Some(rel) = a.bundled else { continue };
            assert!(
                !rel.contains(".."),
                "{} escapes the resource directory",
                a.id
            );
            assert!(!rel.starts_with('/'), "{} is an absolute path", a.id);
            assert!(
                rel.starts_with("resources/"),
                "{} is not under resources/",
                a.id
            );
        }
    }

    #[test]
    fn the_bundled_file_is_the_file_we_run() {
        /* The build fetches the pinned zip and copies out `run`; the seeding
        code writes it to `run`. If those two names ever disagree the app
        installs itself into a file nothing launches. */
        for a in CATALOGUE {
            let (Some(rel), Some(run)) = (a.bundled, a.run) else {
                continue;
            };
            assert!(rel.ends_with(run), "{} bundles {rel} but runs {run}", a.id);
        }
    }

    #[test]
    fn every_entry_is_installable_or_says_why_not() {
        for a in CATALOGUE {
            // An executable entry either has something to fetch and a hash to
            // check it against, or an explicit reason it cannot be installed.
            // Anything else is a row that fails when pressed.
            if a.unavailable.is_none() {
                assert!(a.download.is_some(), "{} has nothing to download", a.id);
                assert!(a.sha256.is_some(), "{} has no hash to verify", a.id);
                assert!(a.run.is_some(), "{} has nothing to run", a.id);
            }
        }
    }

    #[test]
    fn a_download_is_never_unverified() {
        // The hash is what stops a compromised host running code on the
        // machine, so the two travel together or not at all.
        for a in CATALOGUE {
            assert_eq!(
                a.download.is_some(),
                a.sha256.is_some(),
                "{} has one of download/sha256 without the other",
                a.id
            );
        }
    }

    #[test]
    fn ids_are_safe_as_directory_names() {
        for a in CATALOGUE {
            assert!(
                a.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
                "{} is not a safe directory name",
                a.id
            );
        }
    }

    #[test]
    fn only_github_is_fetchable() {
        assert!(host_allowed(
            "https://github.com/FIGHTORDER/Springen/releases/download/v1/x.zip"
        ));
        assert!(host_allowed("https://objects.githubusercontent.com/x"));
        assert!(!host_allowed("https://github.com.evil.example/x"));
        assert!(!host_allowed("https://example.com/x"));
        // Userinfo is the classic way to make a URL look like somewhere else.
        assert!(!host_allowed("https://github.com@evil.example/x"));
        // Plain HTTP is not a download we would trust even with a hash.
        assert!(!host_allowed("http://github.com/x"));
    }

    #[test]
    fn a_zip_cannot_write_outside_the_app_directory() {
        // The oldest trick there is, and the one that turns "install an app"
        // into "overwrite anything this process can reach".
        let dir = std::env::temp_dir().join("shiro-test-unpack");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            w.start_file("../escaped.txt", opts).unwrap();
            use std::io::Write;
            w.write_all(b"nope").unwrap();
            w.finish().unwrap();
        }

        let err = unpack(&buf, &dir).unwrap_err();
        assert!(err.contains("refusing"), "{err}");
        assert!(!dir.parent().unwrap().join("escaped.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_normal_zip_unpacks() {
        let dir = std::env::temp_dir().join("shiro-test-unpack-ok");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            w.start_file("bin/app.exe", opts).unwrap();
            use std::io::Write;
            w.write_all(b"MZ").unwrap();
            w.finish().unwrap();
        }

        unpack(&buf, &dir).unwrap();
        assert_eq!(std::fs::read(dir.join("bin/app.exe")).unwrap(), b"MZ");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_hash_is_of_the_bytes() {
        // A known vector, so a change of algorithm is a failing test rather
        // than every future download being rejected.
        assert_eq!(
            sha256_of(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_root_we_cannot_find_is_not_a_reason_to_refuse_a_launch() {
        // The app somebody with a broken install most wants to open is the one
        // that explains why installs break, so a failed detection has to cost
        // the hand-off and nothing else.
        assert_eq!(handed_root(Some("/definitely/not/zero-k")), None);
    }

    #[test]
    fn the_installation_we_play_from_is_the_one_handed_over() {
        // Including before an engine has landed in it: an app started while the
        // download runs should be told about the directory, not left to guess.
        let dir = std::env::temp_dir().join("shiro-test-handed-root");
        let _ = std::fs::remove_dir_all(&dir);
        crate::install::make_managed(&dir).unwrap();
        assert_eq!(
            handed_root(Some(&dir.display().to_string())),
            Some(dir.clone())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_two_entries_share_a_hash() {
        /* Four entries, four hashes, edited together whenever the apps are
        released together - and a hash copied onto the wrong one would not
        show up here at all. It would show up as an app that downloads and
        is then refused on somebody's machine, which is the furthest
        downstream this could possibly be found. */
        let mut seen = std::collections::HashMap::new();
        for a in CATALOGUE {
            let Some(h) = a.sha256 else { continue };
            if let Some(other) = seen.insert(h, a.id) {
                panic!("{other} and {} are pinned to the same hash", a.id);
            }
        }
    }

    #[test]
    fn the_version_shown_is_the_version_downloaded() {
        /* The download URLs carry the version in the filename and the row shows
        `version`, so bumping one and not the other ships a stale binary under
        a new number. Nothing else here would notice: the hash still matches
        the file, because it is the file that was not meant to be sent. */
        for a in CATALOGUE {
            let (Some(url), Some(version)) = (a.download, a.version) else {
                continue;
            };
            assert!(
                url.contains(&format!("_{version}_")),
                "{} shows {version} but downloads {url}",
                a.id
            );
        }
    }

    #[test]
    fn an_install_is_staged_beside_the_app_and_not_inside_it() {
        /* Inside would be cleared along with the old copy, which is the thing
        staging exists to survive; the rename at the end also has to stay
        within one directory to be the atomic-ish move it is relied on to
        be, rather than a copy across volumes. */
        let dir = std::path::Path::new("C:/apps/stournament");
        let staged = staging_dir(dir);
        assert_eq!(staged.parent(), dir.parent());
        assert_ne!(staged, dir);
        assert!(
            !staged.starts_with(dir),
            "staging is inside the directory it replaces"
        );
        assert_eq!(staged.file_name().unwrap(), "stournament.installing");
    }

    #[test]
    fn ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for a in CATALOGUE {
            assert!(seen.insert(a.id), "duplicate app id {}", a.id);
        }
    }
}
