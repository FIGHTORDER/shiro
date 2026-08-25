//! Getting an engine, so a data directory can become a playable one.
//!
//! Zero-K's engine is a custom Recoil build. It is not on springfiles - asking
//! for `2025.06.21` there returns an empty list - and Chobby never fetches one,
//! because Chobby runs *inside* the engine. It arrives either through Steam's
//! depot or through Zero-K's own launcher, which builds this URL:
//!
//! ```text
//! https://zero-k.info/engine/{platform}/{version}.zip
//! ```
//!
//! Read out of `EngineDownload.cs` in ZeroK-RTS/Zero-K-Infrastructure and
//! confirmed against the live server: all four platforms answer, the win64
//! package for 2025.06.21 is 44.8 MB, and range requests are honoured.
//!
//! The version is never guessed. The server names it in `Welcome.Engine` and
//! again in `ConnectSpring.Engine`, so the only engine ever fetched is the one
//! a game is about to need.
//!
//! **On verification.** The package carries `files.md5.gz`, a manifest of its
//! own contents. That is worth exactly what it sounds like: it catches a
//! truncated or corrupted download, and nothing else, because anyone able to
//! replace the zip can replace the manifest inside it. The security boundary is
//! HTTPS to zero-k.info. What guards against corruption here is the CRC-32 the
//! zip format keeps for every entry, which the extractor checks as it reads -
//! so a damaged download fails on the file that is damaged, rather than
//! producing an engine that crashes later for no visible reason.

use std::io::{Read, Seek};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// A black-holed connection must not leave the progress bar running forever.
///
/// reqwest's blocking client has no per-read timeout, so the bound is on the
/// whole request, body included. Thirty minutes for a 45 MB package is a floor
/// of about 25 KB/s - slower than any line that could finish at all, and still
/// an end to a connection that has silently stopped.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// An engine package is about 45 MB. This is not a security boundary - HTTPS to
/// zero-k.info is - but it stops a confused server from filling the disk.
const MAX_PACKAGE: u64 = 512 * 1024 * 1024;

/// One engine install at a time. Settings has a button and the first-run dialog
/// has another; both reach the same staging directory, and the loser of that
/// race deletes the tree the winner is extracting into.
static INSTALLING: AtomicBool = AtomicBool::new(false);

/// Releases the flag however `ensure` leaves - including on the `?` paths.
struct InstallGuard;

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

impl InstallGuard {
    fn acquire() -> Result<Self, String> {
        if INSTALLING.swap(true, Ordering::SeqCst) {
            return Err("an engine is already being installed".into());
        }
        Ok(InstallGuard)
    }
}

/// The platform directory Zero-K files engines under, and the one the download
/// URL uses. The same four names appear in both.
pub fn platform() -> &'static str {
    if cfg!(windows) {
        if cfg!(target_pointer_width = "64") { "win64" } else { "win32" }
    } else if cfg!(target_pointer_width = "64") {
        "linux64"
    } else {
        "linux32"
    }
}

fn engine_exe() -> &'static str {
    if cfg!(windows) { "spring.exe" } else { "spring" }
}

/// Where an engine of this version belongs, in this data directory.
pub fn engine_dir(root: &Path, version: &str) -> PathBuf {
    root.join("engine").join(platform()).join(version)
}

pub fn engine_url(version: &str) -> String {
    format!("https://zero-k.info/engine/{}/{}.zip", platform(), version)
}

/// Is a usable engine of this version already here?
///
/// "Usable" means both binaries: the engine to run the game and the downloader
/// to fetch it, since the whole point of installing one is that the other
/// arrives with it.
pub fn installed(root: &Path, version: &str) -> bool {
    let dir = engine_dir(root, version);
    dir.join(engine_exe()).is_file() && dir.join(downloader_exe()).is_file()
}

fn downloader_exe() -> &'static str {
    if cfg!(windows) { "pr-downloader.exe" } else { "pr-downloader" }
}

/// Refuse a version string that would escape the engine directory.
///
/// It arrives from the lobby server over a plaintext link, and it is used as a
/// path component. `..` or a separator in it would put an engine somewhere it
/// was never meant to go.
pub fn check_version(version: &str) -> Result<(), String> {
    if version.trim().is_empty() {
        return Err("no engine version given".into());
    }
    if version.contains("..")
        || version.contains('/')
        || version.contains('\\')
        || version.contains(':')
        || version.starts_with('.')
    {
        return Err(format!("{version:?} is not an engine version"));
    }
    Ok(())
}

/// Unpack an engine package into `dir`.
///
/// Entries are refused if they would land outside the target - a zip is a list
/// of paths somebody else wrote, and `../` in one of them is the oldest trick
/// there is. Reading each entry checks its CRC-32, so a corrupted download
/// fails here rather than at the first launch.
fn unpack<R: Read + Seek>(source: R, dir: &Path) -> Result<usize, String> {
    let mut archive = zip::ZipArchive::new(source)
        .map_err(|e| format!("the engine package is not a zip: {e}"))?;

    let mut written = 0;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("unreadable entry in the engine package: {e}"))?;
        let Some(rel) = file.enclosed_name() else {
            return Err(format!("refusing an unsafe path in the package: {}", file.name()));
        };
        let target = dir.join(&rel);
        if !target.starts_with(dir) {
            return Err(format!("refusing an entry outside the engine directory: {}", file.name()));
        }
        if file.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| format!("{}: {e}", target.display()))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        let mut out = std::fs::File::create(&target)
            .map_err(|e| format!("{}: {e}", target.display()))?;
        std::io::copy(&mut file, &mut out).map_err(|e| format!("{}: {e}", target.display()))?;
        written += 1;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = file.unix_mode().unwrap_or(0);
            // A zip written on Windows carries no unix modes at all, and
            // Zero-K's own launcher chmods the binaries after extracting -
            // which is a strong hint these packages are that kind. Without
            // this, a Linux self-install produces an engine that cannot be
            // run, and says so only at the first launch, long after "Done".
            let executable = mode & 0o111 != 0 || must_be_executable(rel.as_ref());
            let bits = if executable { (mode | 0o755) & 0o7777 } else { mode };
            if bits != 0 {
                let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(bits));
            }
        }
    }
    Ok(written)
}

/// Entries that have to be executable whatever the zip claims.
///
/// The two binaries, because nothing works without them, and extensionless
/// files under `AI/`, which are the AI wrappers' own launchers - a shared
/// object there has an extension and is loaded rather than run, so this cannot
/// touch one.
fn must_be_executable(rel: &Path) -> bool {
    let Some(name) = rel.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if name == "spring" || name == "spring.exe"
        || name == "pr-downloader" || name == "pr-downloader.exe"
    {
        return true;
    }
    let under_ai = rel.components().any(|c| c.as_os_str() == "AI");
    under_ai && rel.extension().is_none()
}

/// Where an interrupted install leaves its half-tree.
///
/// A dot-prefixed sibling carrying the whole version, so two versions never
/// share one and nothing scanning `engine/<platform>/` mistakes it for one.
fn staging_dir(dir: &Path, version: &str) -> Result<PathBuf, String> {
    let parent = dir
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", dir.display()))?;
    Ok(parent.join(format!(".partial-{version}")))
}

/// Download and install an engine, unless it is already here.
///
/// `on_progress` is called with (received, total); total is 0 when the server
/// sends no length. Extraction happens into a sibling directory and is moved
/// into place at the end, so an interrupted install never leaves a half-engine
/// that `installed()` would call usable. One at a time: two callers reaching
/// the same staging directory is a race that ends with one of them deleting
/// the other's work.
pub fn ensure(
    root: &Path,
    version: &str,
    on_progress: &dyn Fn(u64, u64),
) -> Result<PathBuf, String> {
    check_version(version)?;
    let dir = engine_dir(root, version);
    if installed(root, version) {
        return Ok(dir);
    }

    let _guard = InstallGuard::acquire()?;
    // Asked again while waiting for the flag? Somebody else may have finished it.
    if installed(root, version) {
        return Ok(dir);
    }

    let url = engine_url(version);
    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!("Shiro/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))?;
    let mut res = client
        .get(&url)
        .send()
        .map_err(|e| format!("could not reach {url}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!(
            "no engine {version} for {} - {url} answered {}",
            platform(),
            res.status()
        ));
    }

    // Staging is a sibling named for the version, not `with_extension` - that
    // replaces the last dot-segment, so 2025.06.21 and 2025.06.22 would both
    // stage as `2025.06.partial` and collide.
    let staging = staging_dir(&dir, version)?;
    let mut package = staging.clone();
    package.set_extension("zip");

    let total = res.content_length().unwrap_or(0);
    if total > MAX_PACKAGE {
        return Err(format!("{url} claims {total} bytes, which is not an engine"));
    }
    if let Some(parent) = package.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }

    // To disk rather than to a Vec: the length is the server's claim, and a
    // response with no length at all would otherwise be read without bound.
    let mut file = std::fs::File::create(&package)
        .map_err(|e| format!("could not write {}: {e}", package.display()))?;
    let mut received: u64 = 0;
    let mut buf = [0u8; 64 * 1024];
    let download = loop {
        let n = match res.read(&mut buf) {
            Ok(n) => n,
            Err(e) => break Err(format!("download failed: {e}")),
        };
        if n == 0 {
            break Ok(());
        }
        received += n as u64;
        if received > MAX_PACKAGE {
            break Err(format!("{url} is larger than an engine package should be"));
        }
        if let Err(e) = std::io::Write::write_all(&mut file, &buf[..n]) {
            break Err(format!("could not write {}: {e}", package.display()));
        }
        on_progress(received, total);
    };
    drop(file);
    if let Err(e) = download {
        let _ = std::fs::remove_file(&package);
        return Err(e);
    }

    // Into a staging directory first: `installed()` asks whether two binaries
    // are present, and a half-extracted engine can answer yes.
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("could not create {}: {e}", staging.display()))?;
    let unpacked = std::fs::File::open(&package)
        .map_err(|e| format!("could not read {}: {e}", package.display()))
        .and_then(|f| unpack(f, &staging));
    let _ = std::fs::remove_file(&package);
    let written = match unpacked {
        Ok(n) => n,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(e);
        }
    };

    for needed in [engine_exe(), downloader_exe()] {
        if !staging.join(needed).is_file() {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(format!("the engine package has no {needed}"));
        }
    }

    let _ = std::fs::remove_dir_all(&dir);
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::rename(&staging, &dir).map_err(|e| {
        format!("could not move the engine into {}: {e}", dir.display())
    })?;

    let _ = written;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shiro-engine-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_url_is_the_one_zero_ks_own_launcher_builds() {
        // From EngineDownload.cs: BaseSiteUrl + "/engine/" + platform + "/" +
        // version + ".zip". Confirmed against the live server.
        let url = engine_url("2025.06.21");
        assert!(url.starts_with("https://zero-k.info/engine/"));
        assert!(url.ends_with("/2025.06.21.zip"));
        assert!(url.contains(platform()));
    }

    #[test]
    fn the_platform_is_one_of_the_four_zero_k_files_engines_under() {
        assert!(matches!(platform(), "win64" | "win32" | "linux64" | "linux32"));
    }

    #[test]
    fn a_version_that_would_escape_the_engine_folder_is_refused() {
        // It comes off a plaintext lobby connection and is used as a path
        // component.
        for bad in ["../../evil", "..", "a/b", "a\\b", "C:evil", ".hidden", "  "] {
            assert!(check_version(bad).is_err(), "{bad:?} was allowed");
        }
        for good in ["2025.06.21", "104.0.1-567-gc484c10"] {
            assert!(check_version(good).is_ok(), "{good:?} was refused");
        }
    }

    #[test]
    fn an_engine_is_only_installed_when_both_binaries_are_there() {
        let root = temp("halfway");
        let dir = engine_dir(&root, "1.0");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!installed(&root, "1.0"));
        std::fs::write(dir.join(engine_exe()), b"x").unwrap();
        // The engine alone is not enough: the downloader arrives with it, and
        // fetching the game is the reason to have one.
        assert!(!installed(&root, "1.0"));
        std::fs::write(dir.join(downloader_exe()), b"x").unwrap();
        assert!(installed(&root, "1.0"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unpacking_refuses_a_path_that_climbs_out() {
        let dir = temp("escape");
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            zip.start_file("../escaped.txt", opts).unwrap();
            use std::io::Write;
            zip.write_all(b"nope").unwrap();
            zip.finish().unwrap();
        }
        assert!(unpack(std::io::Cursor::new(&buf), &dir).is_err());
        assert!(!dir.parent().unwrap().join("escaped.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn staging_never_collides_between_two_versions() {
        // `with_extension` would make both of these `2025.06.partial`, so an
        // install of one would delete the other's half-extracted tree.
        let root = Path::new("/zk");
        let a = staging_dir(&engine_dir(root, "2025.06.21"), "2025.06.21").unwrap();
        let b = staging_dir(&engine_dir(root, "2025.06.22"), "2025.06.22").unwrap();
        assert_ne!(a, b);
        // And neither can be mistaken for an installed version.
        assert_ne!(a, engine_dir(root, "2025.06.21"));
        assert!(a.file_name().unwrap().to_str().unwrap().starts_with(".partial-"));
    }

    #[test]
    fn only_one_engine_installs_at_a_time() {
        let first = InstallGuard::acquire().unwrap();
        assert!(
            InstallGuard::acquire().is_err(),
            "two installs would share one staging directory"
        );
        drop(first);
        // And the flag is released however the first one ended.
        assert!(InstallGuard::acquire().is_ok());
    }

    #[test]
    fn the_binaries_are_executable_whatever_the_zip_says() {
        assert!(must_be_executable(Path::new("spring")));
        assert!(must_be_executable(Path::new("pr-downloader")));
        assert!(must_be_executable(Path::new("spring.exe")));
        // An AI wrapper's launcher has no extension; its shared object does,
        // and is loaded rather than run.
        assert!(must_be_executable(Path::new("AI/Skirmish/CAI/0.1/CAI")));
        assert!(!must_be_executable(Path::new("AI/Skirmish/CAI/0.1/libSkirmishAI.so")));
        assert!(!must_be_executable(Path::new("cont/base.sdz")));
        assert!(!must_be_executable(Path::new("readme")));
    }

    #[cfg(unix)]
    #[test]
    fn a_zip_with_no_unix_modes_still_produces_a_runnable_engine() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp("modes");
        let mut buf = Vec::new();
        {
            // FileOptions::default() writes no unix mode, which is what a
            // package built on Windows looks like.
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            use std::io::Write;
            zip.start_file("spring", opts).unwrap();
            zip.write_all(b"engine").unwrap();
            zip.start_file("pr-downloader", opts).unwrap();
            zip.write_all(b"downloader").unwrap();
            zip.start_file("cont/base.sdz", opts).unwrap();
            zip.write_all(b"data").unwrap();
            zip.finish().unwrap();
        }
        unpack(std::io::Cursor::new(&buf), &dir).unwrap();
        let mode = |name: &str| {
            std::fs::metadata(dir.join(name)).unwrap().permissions().mode() & 0o111
        };
        assert_ne!(mode("spring"), 0, "the engine would fail with EACCES");
        assert_ne!(mode("pr-downloader"), 0, "and nothing could be downloaded");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unpacking_writes_what_it_was_given() {
        let dir = temp("unpack");
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            use std::io::Write;
            zip.start_file("spring.exe", opts).unwrap();
            zip.write_all(b"engine").unwrap();
            zip.start_file("AI/readme.txt", opts).unwrap();
            zip.write_all(b"nested").unwrap();
            zip.finish().unwrap();
        }
        assert_eq!(unpack(std::io::Cursor::new(&buf), &dir).unwrap(), 2);
        assert_eq!(std::fs::read(dir.join("spring.exe")).unwrap(), b"engine");
        assert!(dir.join("AI").join("readme.txt").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
