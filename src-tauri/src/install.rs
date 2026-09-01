//! Locating an existing Zero-K installation.
//!
//! v1 never downloads content: we reuse the
//! engine, games and maps of whatever Zero-K install is already on the machine.
//! That makes this module the only thing standing between login and launch.
//!
//! Everything here is deliberately pure except `detect()` itself, so the path
//! logic can be tested without a Zero-K install present.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// A Zero-K data directory - the folder holding `engine/`, `games/`, `maps/`.
/// Spring calls this the write dir; ZK keeps everything under it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Install {
    pub root: PathBuf,
    /// How we found it, so the UI can say "Steam" rather than a bare path.
    pub source: String,
}

/// The file that says Shiro made this directory and is filling it.
///
/// A folder Shiro created is not recognisable as a Zero-K install until an
/// engine and a game have landed in it, which is a problem when the whole point
/// is to hand that folder to the thing that installs them. Rather than relax
/// what counts as an install - and start accepting any folder at all - a
/// directory we made says so, in writing, where anyone can look.
pub const MANAGED_MARKER: &str = ".shiro-managed";

pub fn is_managed(root: &Path) -> bool {
    root.join(MANAGED_MARKER).is_file()
}

/// Create a data directory for Shiro to fill, and mark it as ours.
pub fn make_managed(root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| format!("could not create {}: {e}", root.display()))?;
    let marker = root.join(MANAGED_MARKER);
    if !marker.is_file() {
        std::fs::write(
            &marker,
            concat!(
                "This directory is a Zero-K installation managed by Shiro.\n",
                "Deleting it removes the engine, the game and any maps downloaded here.\n",
            ),
        )
        .map_err(|e| format!("could not write {}: {e}", marker.display()))?;
    }
    Ok(())
}

/// Directories that make a folder recognisably a Zero-K data dir rather than
/// some unrelated folder that happens to be called Zero-K. `engine` alone is
/// not enough - a bare engine checkout has one too.
/// Is there a directory called this, whatever case it is written in?
///
/// `root.join("engine").is_dir()` is enough on Windows and macOS, where the
/// filesystem folds case for you. On Linux it is not, and a Zero-K whose
/// directories happen to be capitalised differently is invisible - which is a
/// bug that cannot happen on the machine most of this is written on.
///
/// The exact name is tried first, because that is the case that always hits and
/// it costs one syscall. Only a miss pays for a directory listing.
fn has_dir(root: &Path, name: &str) -> bool {
    if root.join(name).is_dir() {
        return true;
    }
    let Ok(entries) = std::fs::read_dir(root) else { return false };
    entries.flatten().any(|e| {
        e.file_name().to_str().is_some_and(|n| n.eq_ignore_ascii_case(name))
            && e.path().is_dir()
    })
}

fn has_zk_content(root: &Path) -> bool {
    has_dir(root, "engine")
        && (has_dir(root, "games") || has_dir(root, "pool") || has_dir(root, "packages"))
}

/// Why a directory is not an install, in words a person can act on.
///
/// "Looked in: <twelve paths>" tells somebody where we searched and nothing
/// about what we found, so a report comes back as "it did not detect it" and
/// the next step is a guess. This says which of the two conditions each
/// candidate failed, which turns the same report into an answer.
///
/// Worth the detail because this is the one bug that cannot be reproduced from
/// here: a Steam install on Linux is somebody else's directory layout on
/// somebody else's machine.
fn why_not(root: &Path) -> &'static str {
    if !root.exists() {
        return "not there";
    }
    if !root.is_dir() {
        return "not a directory";
    }
    if std::fs::read_dir(root).is_err() {
        return "cannot be read";
    }
    match (has_dir(root, "engine"), has_dir(root, "games") || has_dir(root, "pool") || has_dir(root, "packages")) {
        (false, false) => "no engine/ and no games, pool or packages",
        (false, true) => "has game content but no engine/",
        (true, false) => "has engine/ but no games, pool or packages",
        (true, true) => "looks like an install",
    }
}

/// Is this a Zero-K data directory?
///
/// A directory Shiro created counts from the moment it exists, because the
/// engine and the game are on their way into it. What that does *not* buy it is
/// the front of the queue - see `is_filled`.
fn looks_like_zk_root(root: &Path) -> bool {
    is_managed(root) || has_zk_content(root)
}

/// Is there an engine in here yet - any engine?
///
/// Not the one a launch needs: detection does not know the version, and turning
/// a version into a path is `find_engine`'s job. This asks the cruder question
/// of whether anything has arrived in a directory at all, and the engine is the
/// thing that arrives first.
///
/// Both layouts `engine_candidates` knows about, and neither matches what an
/// interrupted download leaves behind: staging is `.partial-<version>` with no
/// binary in it, and the empty `engine/<platform>/` around it is not an engine
/// however much it looks like the start of one.
fn has_engine(root: &Path) -> bool {
    let engines = root.join("engine");
    for dir in [engines.join(engine_platform()), engines] {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let version = entry.path();
            if version.join(engine_exe()).is_file()
                || version.join("bin").join(engine_exe()).is_file()
            {
                return true;
            }
        }
    }
    false
}

/// Has anything actually landed here, or is this still a promise?
///
/// The marker makes an empty directory count as an install, which is the entire
/// point of it: the folder has to be handed to the thing that installs the
/// engine before the engine is in it. It is not a reason to launch out of an
/// empty folder while a complete Zero-K sits elsewhere on the machine - which
/// is exactly what a prepared install whose download never arrived did. It was
/// picked first and the launch then failed at an engine that was not there, in
/// a directory with nothing in it, on a machine with a working Steam copy.
///
/// So a promise ranks below anything that can run a game today, and stops being
/// a promise as soon as one engine lands - early enough that the rest of the
/// install still goes in beside it rather than into somebody else's Zero-K.
fn is_filled(root: &Path) -> bool {
    if is_managed(root) {
        return has_engine(root);
    }
    has_zk_content(root)
}

/// Pull library paths out of Steam's `libraryfolders.vdf`.
///
/// The file is Valve's KeyValues format. We want exactly one thing from it -
/// the `"path"` of each library - so we scan for that key instead of pulling in
/// a VDF parser. Both the flat (pre-2021) and nested layouts put the value on
/// the same line as the key, which is why this holds up.
pub fn parse_library_folders(vdf: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for line in vdf.lines() {
        let mut parts = line.split('"').skip(1);
        let Some(key) = parts.next() else { continue };
        if key != "path" {
            continue;
        }
        // skip the whitespace between key and value
        let Some(value) = parts.nth(1) else { continue };
        if value.is_empty() {
            continue;
        }
        // VDF escapes backslashes, so "D:\\Games" is the path D:\Games.
        out.push(PathBuf::from(value.replace("\\\\", "\\")));
    }
    out
}

/// Steam roots to probe when `libraryfolders.vdf` has not been found yet.
fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if cfg!(windows) {
        for var in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Ok(dir) = std::env::var(var) {
                roots.push(PathBuf::from(dir).join("Steam"));
            }
        }
    }
    if let Some(home) = home_dir() {
        roots.push(home.join(".local/share/Steam"));
        roots.push(home.join(".steam/steam"));
        /* Steam's own canonical symlink. It is what Valve tells other software
           to follow, and on a Debian or Arch package install it is sometimes
           the only one of these that resolves. */
        roots.push(home.join(".steam/root"));
        // What the Debian package lays down, which Ubuntu users get by default.
        roots.push(home.join(".steam/debian-installation"));
        /* Flatpak, which is how a large share of Linux users now install Steam -
           every Steam Deck, and the recommended route on Fedora and Arch. Shiro
           itself ships as an AppImage and a deb rather than a Flatpak, so it is
           not sandboxed and can read this. */
        roots.push(home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
        roots.push(home.join(".var/app/com.valvesoftware.Steam/.steam/steam"));
        // Snap, for the Ubuntu installs that took that route instead.
        roots.push(home.join("snap/steam/common/.local/share/Steam"));
        roots.push(home.join("Library/Application Support/Steam"));
    }
    roots
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Where Shiro puts an install it manages itself, once anything has told us.
///
/// Set at startup from the app handle rather than worked out here, because the
/// answer is Tauri's `app_data_dir` and there should be one copy of it. `None`
/// until then, which is only the case in tests and before `setup` runs.
static MANAGED: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Tell detection where a managed install would be. Ignored if already set.
pub fn set_managed_root(dir: PathBuf) {
    let _ = MANAGED.set(dir);
}

/// Every place a Zero-K data dir plausibly lives, most specific first.
/// Returned in probe order; the first hit that `looks_like_zk_root` wins.
fn candidates() -> Vec<(PathBuf, String)> {
    candidates_with(MANAGED.get().map(PathBuf::as_path))
}

/// The list, given where a managed install would be.
///
/// Split out so it can be tested without a running app, and so the one place
/// that knows the managed directory stays the one place that decides it.
fn candidates_with(managed: Option<&Path>) -> Vec<(PathBuf, String)> {
    let mut out: Vec<(PathBuf, String)> = Vec::new();

    /* The install Shiro made itself, ahead of everything else.
     *
     * It was missing entirely: the only thing that knew about a managed
     * install was `settings.installRoot` in the browser's local storage. Clear
     * that - a profile reset, cleared site data - and several gigabytes of
     * engine and game went invisible, while `zks_managed_state` went on
     * reporting it as prepared on disk. Somebody would have been told to
     * install Zero-K on top of the Zero-K they already had.
     *
     * First because it is the only candidate that exists because someone asked
     * for it. Everything below is a guess about where an installer might have
     * put something.
     *
     * First in the list, that is. `choose` still puts a directory with nothing
     * in it behind an install that can run a game today - being asked for is
     * not the same as being ready. */
    if let Some(dir) = managed {
        out.push((dir.to_path_buf(), "Shiro".into()));
    }

    // The standalone installer's default, and where our own NSIS package goes.
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        out.push((
            PathBuf::from(&local).join("Programs").join("Zero-K"),
            "Zero-K installer".into(),
        ));
    }
    if let Some(home) = home_dir() {
        out.push((home.join("Zero-K"), "home directory".into()));
        // Linux ZK installs write into the Spring data dir.
        out.push((home.join(".config/spring"), "Spring data directory".into()));
        out.push((home.join(".spring"), "Spring data directory".into()));
    }

    // Steam: read every library, not just the default one. People move games
    // to a second drive constantly and then wonder why a lobby cannot find them.
    for steam in steam_roots() {
        let mut libraries = vec![steam.clone()];
        let vdf = steam.join("steamapps").join("libraryfolders.vdf");
        if let Ok(text) = std::fs::read_to_string(&vdf) {
            libraries.extend(parse_library_folders(&text));
        }
        for lib in libraries {
            out.push((
                lib.join("steamapps").join("common").join("Zero-K"),
                "Steam".into(),
            ));
        }
    }
    out
}

/// Find the Zero-K install, or explain where we looked.
///
/// `override_root` is a path someone typed into settings. It is checked like
/// any other candidate rather than trusted, so a typo says "that is not a
/// Zero-K folder" instead of failing later at the engine.
pub fn detect_with(override_root: Option<&str>) -> Result<Install, String> {
    let Some(root) = override_root.map(str::trim).filter(|r| !r.is_empty()) else {
        return detect();
    };
    let path = PathBuf::from(root);
    /* Only searched when the saved path cannot answer on its own, so the
       ordinary case is still one look at one directory. */
    if is_filled(&path) {
        return decide_override(&path, None);
    }
    decide_override(&path, detect().ok())
}

/// What a saved install path means, given what else is on the machine.
///
/// Pure so it can be tested: which of these branches is taken depends on
/// directories that exist or do not on the machine running the test, and the
/// policy is the part worth pinning down.
///
/// The case this exists for: `is_filled` and the two passes in `choose` keep a
/// managed install that was prepared and never filled from shadowing a real
/// Zero-K. **That reasoning was skipped entirely whenever a path was saved in
/// settings**, because detection returned before any of it ran -
/// `looks_like_zk_root` counts a managed directory from the moment it exists,
/// so a download that never arrived was handed back as the install and a
/// working Steam copy was never looked for.
///
/// The saved path still wins when it is real, and is still never silently
/// swapped for somewhere else - being told which directory is in use is the
/// point of setting one. What changed is that the search happens, and the
/// answer says where a usable install actually is.
fn decide_override(path: &Path, found: Option<Install>) -> Result<Install, String> {
    let source = || if is_managed(path) { "Shiro" } else { "settings" }.to_string();
    if is_filled(path) {
        return Ok(Install { root: path.to_path_buf(), source: source() });
    }
    /* Past here the path is not usable as it stands. The only way it can still
       "look like" a Zero-K is by carrying the managed marker: for anything
       else, looking like one means having the content, and that is what
       `is_filled` just answered. So this is a managed directory with nothing in
       it yet, or a path that is simply wrong. */
    match (is_managed(path), found) {
        // Mid-download, and nothing better anywhere. A real state, not an error.
        (true, None) => Ok(Install { root: path.to_path_buf(), source: source() }),

        /* An empty managed directory is not somebody's choice of install - it
           is where Shiro's own installer was going to put one, written to
           settings by pressing a button. When the download never arrived and
           there is a real Zero-K on the machine, using the real one is what the
           person wanted; being told to go and clear a text field is not. */
        (true, Some(other)) => Ok(other),

        /* A path somebody typed is a decision. A wrong one is reported rather
           than quietly replaced, or Shiro would launch from somewhere they did
           not pick and never say so. */
        (false, Some(other)) => Err(format!(
            "{} is not a Zero-K installation - {}.\nThere is one at {} - clear the install path \
             in Settings to use it.",
            path.display(),
            why_not(path),
            other.root.display()
        )),
        (false, None) => Err(format!(
            "{} is not a Zero-K installation - {}.",
            path.display(),
            why_not(path)
        )),
    }
}

/// Pick an install out of a probed list.
///
/// Two passes over the same order, which is what keeps a marked but still empty
/// directory from shadowing a real install. The first pass takes the best
/// candidate that has something in it; only if there is no such thing anywhere
/// does the second pass fall back to a directory that merely counts as one -
/// which is the state every managed install starts in and has to be found in.
///
/// Split out from `detect` because everything else here can be tested without a
/// Zero-K on the machine, and the order these are tried in is worth the same.
fn choose(probed: &[(PathBuf, String)]) -> Option<Install> {
    let first = |counts: fn(&Path) -> bool| {
        probed
            .iter()
            .find(|(root, _)| counts(root))
            .map(|(root, source)| Install {
                root: root.clone(),
                source: source.clone(),
            })
    };
    first(is_filled).or_else(|| first(looks_like_zk_root))
}

/// Find the Zero-K install, or explain where we looked.
pub fn detect() -> Result<Install, String> {
    let probed = candidates();
    if let Some(found) = choose(&probed) {
        return Ok(found);
    }
    /* The first line stands alone deliberately: somewhere as small as the
       caption under the AI picker shows that and leaves the search to
       Settings, and a sentence ending in a dangling colon is not one. */
    Err(format!(
        "No Zero-K installation found.\nLooked in:\n{}",
        probed
            .iter()
            .map(|(p, _)| format!("  {} - {}", p.display(), why_not(p)))
            .collect::<Vec<_>>()
            .join("\n")
    ))
}

/// Platform subfolder ZK files engines under.
///
/// Deferred to `engine` rather than worked out again here. This decides where
/// detection looks and `engine::engine_dir` decides where a managed install
/// writes, and while there were two of these they agreed only on win64 and
/// linux64 - so anywhere else the engine Shiro had just installed did not
/// exist as far as detection was concerned.
fn engine_platform() -> &'static str {
    crate::engine::platform()
}

fn engine_exe() -> &'static str {
    if cfg!(windows) {
        "spring.exe"
    } else {
        "spring"
    }
}

/// Where the engine binary for `version` should be.
///
/// The server sends `Welcome.Engine` / `ConnectSpring.Engine` as a bare version
/// string ("2025.06.21") and ZK names the directory with exactly that string,
/// so no normalisation is needed. Layout has moved around across ZK versions,
/// hence the fallbacks.
pub fn engine_candidates(root: &Path, version: &str) -> Vec<PathBuf> {
    let exe = engine_exe();
    vec![
        root.join("engine").join(engine_platform()).join(version).join(exe),
        root.join("engine").join(version).join(exe),
        root.join("engine").join(engine_platform()).join(version).join("bin").join(exe),
    ]
}

/// Resolve the engine binary, or say which version is missing.
pub fn find_engine(root: &Path, version: &str) -> Result<PathBuf, String> {
    /* The version arrives from the lobby server over a plaintext link and is
       used as a path component. Checked here rather than at each caller, so
       every path that turns a server string into a directory gets it. */
    crate::engine::check_version(version)?;
    for path in engine_candidates(root, version) {
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(format!(
        "Zero-K is installed at {} but engine {} is not. Start that game once in the \
         official lobby to download the engine, then try again.",
        root.display(),
        version
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shiro-install-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// An engine binary where Zero-K files one. Content, not a real engine:
    /// what is being tested is which directory gets picked, not what runs.
    fn put_an_engine_in(root: &Path) {
        let dir = root.join("engine").join(engine_platform()).join("2025.06.21");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(engine_exe()), b"an engine as far as detection is concerned").unwrap();
    }

    /// A directory that reads as somebody's working Zero-K - a Steam copy, say.
    fn a_working_install(name: &str) -> PathBuf {
        let dir = temp(name);
        put_an_engine_in(&dir);
        std::fs::create_dir_all(dir.join("pool")).unwrap();
        dir
    }

    #[test]
    fn a_zero_k_is_found_whatever_case_its_folders_are_written_in() {
        /* On Windows and macOS the filesystem folds case, so `engine` finds
           `Engine` for free and this can never fail there. On Linux it can, and
           a Zero-K whose directories are capitalised differently was simply
           invisible - which is the shape of "Linux cannot see my Steam
           install". Run this on Linux for it to mean anything. */
        let dir = temp("case");
        let engine = dir.join("Engine").join(engine_platform()).join("2025.06.21");
        std::fs::create_dir_all(&engine).unwrap();
        std::fs::write(engine.join(engine_exe()), b"x").unwrap();
        std::fs::create_dir_all(dir.join("Pool")).unwrap();

        assert!(has_dir(&dir, "engine"), "engine not found as Engine");
        assert!(has_dir(&dir, "pool"), "pool not found as Pool");
        assert!(has_zk_content(&dir), "a differently cased Zero-K reads as not one");
        assert!(looks_like_zk_root(&dir));
    }

    #[test]
    fn the_exact_case_still_works_and_a_missing_folder_is_still_missing() {
        let dir = temp("case-exact");
        std::fs::create_dir_all(dir.join("engine")).unwrap();
        assert!(has_dir(&dir, "engine"));
        // The fallback must not turn "absent" into "present".
        assert!(!has_dir(&dir, "pool"));
        assert!(!has_zk_content(&dir), "an engine alone is not an install");
        // Nor may a file of the right name pass as a directory.
        std::fs::write(dir.join("pool"), b"not a directory").unwrap();
        assert!(!has_dir(&dir, "pool"), "a file named pool is not the pool");
    }

    #[test]
    fn an_empty_managed_folder_gives_way_to_a_real_install() {
        /* Shiro's own installer writes the managed path into settings when the
           button is pressed. If the download never lands, that setting was
           never a choice about which Zero-K to use - so a real one wins, and
           nobody has to find and clear a text field to get their game back.
           This is the case a Linux tester hit with a working Steam copy. */
        let empty = temp("managed-empty");
        std::fs::write(empty.join(MANAGED_MARKER), b"").unwrap();
        let steam = Install { root: PathBuf::from("/steam/Zero-K"), source: "Steam".into() };

        let picked = decide_override(&empty, Some(steam)).expect("the real install is used");
        assert_eq!(picked.root, PathBuf::from("/steam/Zero-K"));
        assert_eq!(picked.source, "Steam");
    }

    #[test]
    fn a_path_somebody_typed_is_still_never_swapped_out_from_under_them() {
        /* The other half of the same rule. A directory chosen by hand is a
           decision, so a wrong one is reported rather than quietly replaced -
           otherwise Shiro would launch from somewhere the person did not pick
           and never say so. */
        let typed = temp("typed-wrong");
        let steam = Install { root: PathBuf::from("/steam/Zero-K"), source: "Steam".into() };
        let e = decide_override(&typed, Some(steam)).unwrap_err();
        assert!(e.contains("is not a Zero-K installation"), "{e}");
        assert!(e.contains("/steam/Zero-K"), "and it names the alternative: {e}");
    }

    #[test]
    fn a_saved_path_that_is_real_is_used_and_never_swapped() {
        let real = a_working_install("override-real");
        let elsewhere = Install { root: PathBuf::from("/elsewhere"), source: "Steam".into() };
        // Even with another install on the machine, the saved one wins.
        let found = decide_override(&real, Some(elsewhere)).unwrap();
        assert_eq!(found.root, real);
        assert_eq!(found.source, "settings");
        assert_eq!(detect_with(real.to_str()).unwrap().root, real);
    }

    #[test]
    fn a_saved_path_that_is_wrong_says_why_and_not_merely_that_it_is_wrong() {
        let junk = temp("override-junk");
        let e = decide_override(&junk, None).unwrap_err();
        assert!(e.contains("is not a Zero-K installation"), "{e}");
        assert!(e.contains("no engine/"), "the reason has to be in it: {e}");
        assert_eq!(detect_with(junk.to_str()).unwrap_err(), e);
    }

    #[test]
    fn the_failure_says_what_was_wrong_with_each_place_it_looked() {
        /* The bug this exists for cannot be reproduced here - it is somebody
           else's Steam layout on somebody else's machine - so the message has
           to carry the diagnosis back on its own. */
        let missing = std::env::temp_dir().join("shiro-install-nowhere-at-all");
        let _ = std::fs::remove_dir_all(&missing);
        assert_eq!(why_not(&missing), "not there");

        let empty = temp("why-empty");
        assert_eq!(why_not(&empty), "no engine/ and no games, pool or packages");

        let content_only = temp("why-content");
        std::fs::create_dir_all(content_only.join("games")).unwrap();
        assert_eq!(why_not(&content_only), "has game content but no engine/");

        let engine_only = temp("why-engine");
        std::fs::create_dir_all(engine_only.join("engine")).unwrap();
        assert_eq!(why_not(&engine_only), "has engine/ but no games, pool or packages");

        let both = temp("why-both");
        std::fs::create_dir_all(both.join("engine")).unwrap();
        std::fs::create_dir_all(both.join("pool")).unwrap();
        assert_eq!(why_not(&both), "looks like an install");

        // A file where a directory should be is named as such, not as absent.
        let file = temp("why-file").join("thing");
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(why_not(&file), "not a directory");
    }

    #[test]
    fn a_directory_that_cannot_be_listed_is_not_a_zero_k() {
        // The fallback reads the directory; one that is not there must say no
        // rather than panic.
        let gone = std::env::temp_dir().join("shiro-install-does-not-exist-at-all");
        let _ = std::fs::remove_dir_all(&gone);
        assert!(!has_dir(&gone, "engine"));
        assert!(!has_zk_content(&gone));
    }

    #[test]
    fn the_steam_roots_cover_how_linux_actually_installs_steam() {
        /* Flatpak is how a large share of Linux users install Steam - every
           Steam Deck, and the recommended route on Fedora and Arch - and it was
           missing entirely. So were Steam's own `root` symlink and the Debian
           package's directory. */
        let Some(home) = home_dir() else { return };
        let roots = steam_roots();
        let has = |p: &str| roots.iter().any(|r| *r == home.join(p));
        for expected in [
            ".local/share/Steam",
            ".steam/steam",
            ".steam/root",
            ".steam/debian-installation",
            ".var/app/com.valvesoftware.Steam/.local/share/Steam",
            "snap/steam/common/.local/share/Steam",
        ] {
            assert!(has(expected), "steam_roots is missing {expected}");
        }
    }


    fn probe(entries: &[(&Path, &str)]) -> Vec<(PathBuf, String)> {
        entries.iter().map(|(p, s)| (p.to_path_buf(), s.to_string())).collect()
    }

    #[test]
    fn an_empty_managed_directory_does_not_shadow_a_working_install() {
        /* Preparing a managed install marks the directory before anything is
           downloaded into it, so an engine download that fails leaves a marked
           folder with nothing in it. It is still probed first - and it still
           has to lose to a copy that can start the game, or the launch reports
           "engine is not installed" against a folder that never had one while a
           complete Zero-K sits on the same machine. */
        let managed = temp("empty-managed");
        make_managed(&managed).unwrap();
        let steam = a_working_install("steam-beside-empty");

        let found = choose(&probe(&[(&managed, "Shiro"), (&steam, "Steam")]))
            .expect("there was a working install to find");
        assert_eq!(found.root, steam, "an empty folder was preferred to a real install");
        assert_eq!(found.source, "Steam");

        let _ = std::fs::remove_dir_all(&managed);
        let _ = std::fs::remove_dir_all(&steam);
    }

    #[test]
    fn a_download_that_stopped_halfway_is_not_an_engine() {
        /* What an interrupted install leaves behind: `engine/<platform>/`
           exists, holding the staging directory and no binary. A directory that
           counts the moment `engine/` appears would call that an install. */
        let managed = temp("half-managed");
        make_managed(&managed).unwrap();
        std::fs::create_dir_all(
            managed.join("engine").join(engine_platform()).join(".partial-2025.06.21"),
        )
        .unwrap();
        let steam = a_working_install("steam-beside-half");

        let found = choose(&probe(&[(&managed, "Shiro"), (&steam, "Steam")])).unwrap();
        assert_eq!(found.root, steam, "half a download outranked a working install");

        let _ = std::fs::remove_dir_all(&managed);
        let _ = std::fs::remove_dir_all(&steam);
    }

    #[test]
    fn once_an_engine_lands_the_managed_install_leads_again() {
        /* And this is why the marker is not written on success instead. The
           game arrives after the engine, through the pr-downloader inside it,
           and it has to arrive in the directory that engine is in - not in the
           Steam install next door, which is where a managed install demoted
           until it was complete would send several gigabytes. */
        let managed = temp("engine-only-managed");
        make_managed(&managed).unwrap();
        put_an_engine_in(&managed);
        let steam = a_working_install("steam-beside-engine");

        let found = choose(&probe(&[(&managed, "Shiro"), (&steam, "Steam")])).unwrap();
        assert_eq!(found.root, managed, "the install being filled lost its place");
        assert_eq!(found.source, "Shiro");

        let _ = std::fs::remove_dir_all(&managed);
        let _ = std::fs::remove_dir_all(&steam);
    }

    #[test]
    fn an_empty_managed_directory_is_still_found_when_it_is_all_there_is() {
        // The marker's whole purpose: a directory with nothing in it yet is
        // where the engine is about to go, and detection has to name it.
        let managed = temp("only-managed");
        make_managed(&managed).unwrap();

        let found = choose(&probe(&[(&managed, "Shiro")])).expect("the marked directory was lost");
        assert_eq!(found.root, managed);
        assert_eq!(found.source, "Shiro");

        let _ = std::fs::remove_dir_all(&managed);
    }

    #[test]
    fn the_install_shiro_made_is_looked_for_first() {
        /* It was not looked for at all. The only thing that knew about a
           managed install was `settings.installRoot` in the browser's local
           storage; lose that and gigabytes of engine and game went invisible
           while `zks_managed_state` still reported them as prepared. */
        let managed = PathBuf::from("/somewhere/info.zero-k.shiro/zk");
        let got = candidates_with(Some(&managed));
        assert_eq!(got.first().map(|(p, _)| p.as_path()), Some(managed.as_path()),
            "a directory somebody asked for should not queue behind guesses");
        assert_eq!(got.first().map(|(_, s)| s.as_str()), Some("Shiro"));
    }

    #[test]
    fn without_one_the_rest_of_the_list_is_unchanged() {
        /* The managed entry is an addition, not a replacement: somebody with a
           Steam or installer copy and no managed one must probe exactly what
           they probed before. */
        let with = candidates_with(Some(Path::new("/somewhere/zk")));
        let without = candidates_with(None);
        assert_eq!(with.len(), without.len() + 1);
        assert_eq!(&with[1..], &without[..]);
    }

    #[test]
    fn parses_the_nested_libraryfolders_layout() {
        let vdf = r#"
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}
"#;
        let got = parse_library_folders(vdf);
        assert_eq!(
            got,
            vec![
                PathBuf::from(r"C:\Program Files (x86)\Steam"),
                PathBuf::from(r"D:\SteamLibrary"),
            ]
        );
    }

    #[test]
    fn ignores_keys_that_merely_contain_a_path() {
        // "mounted" and "contentstatsid" sit beside "path" in real files.
        let vdf = "\t\"contentstatsid\"\t\t\"12345\"\n\t\"path\"\t\t\"/home/u/.local/share/Steam\"\n";
        assert_eq!(
            parse_library_folders(vdf),
            vec![PathBuf::from("/home/u/.local/share/Steam")]
        );
    }

    #[test]
    fn survives_a_truncated_or_empty_vdf() {
        assert!(parse_library_folders("").is_empty());
        assert!(parse_library_folders("\"path\"").is_empty());
        assert!(parse_library_folders("\"path\" \"\"").is_empty());
    }

    #[test]
    fn an_override_is_checked_like_any_other_candidate() {
        let err = detect_with(Some("/definitely/not/zero-k")).unwrap_err();
        assert!(err.contains("not a Zero-K installation"), "{err}");
    }

    #[test]
    fn a_blank_override_falls_through_to_detection() {
        // Whatever detection returns here, it must not be the override error.
        if let Err(e) = detect_with(Some("   ")) {
            assert!(e.contains("No Zero-K installation found"), "{e}");
            /* `ais.rs` shows the first line alone under the AI picker, where a
               list of probed paths would collapse into a paragraph. That only
               works while the first line is a whole sentence. */
            assert_eq!(e.lines().next(), Some("No Zero-K installation found."), "{e}");
        }
    }

    #[test]
    fn engine_lookup_reports_the_version_rather_than_a_bare_not_found() {
        let err = find_engine(Path::new("/nonexistent/Zero-K"), "2025.06.21").unwrap_err();
        assert!(err.contains("2025.06.21"), "{err}");
    }

    /// Detection has to look where a managed install writes. Two copies of the
    /// platform name drifted apart, and off win64/linux64 an engine Shiro had
    /// just downloaded was reported missing.
    #[test]
    fn an_engine_installed_by_us_is_where_detection_looks() {
        let root = temp("managed-engine-is-found");
        let dir = crate::engine::engine_dir(&root, "2025.06.21");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(engine_exe()), b"an engine as far as detection is concerned")
            .unwrap();
        assert!(has_engine(&root), "the engine we just installed is invisible");
        assert_eq!(find_engine(&root, "2025.06.21").unwrap(), dir.join(engine_exe()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn engine_candidates_lead_with_the_platform_layout() {
        let paths = engine_candidates(Path::new("/zk"), "2025.06.21");
        assert!(paths[0].to_string_lossy().contains(engine_platform()));
        assert!(paths[0].ends_with(engine_exe()));
    }

    #[test]
    fn a_folder_needs_content_beside_the_engine_to_count() {
        let tmp = std::env::temp_dir().join("shiro-install-test");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("engine")).unwrap();
        assert!(!looks_like_zk_root(&tmp), "engine alone must not qualify");
        std::fs::create_dir_all(tmp.join("pool")).unwrap();
        assert!(looks_like_zk_root(&tmp));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
