//! Signing in with Steam, without letting Steam near this process.
//!
//! Zero-K's lobby server already accepts a Steam ticket: `Login` carries a
//! `SteamAuthToken`, the server hands it to Steam's
//! `ISteamUserAuth/AuthenticateUserTicket` with its own web API key, and looks
//! the account up by the `steamid` that comes back. Nothing here talks to
//! Steam's web API, and Shiro never needs a key of its own.
//!
//! All this module does is get a ticket, and it does that by running a separate
//! program for about a second.
//!
//! ## Why a separate program
//!
//! Linking the Steamworks SDK puts `steam_api64.dll` in the import table, and a
//! binary with a load-time import it cannot resolve does not start: no window,
//! no message, exit code `0xC0000135`. Measured, not assumed.
//!
//! That would be a poor trade at the best of times, for a feature most players
//! will never use. It is worse than it looks, because `steam_api64.dll` is one
//! of the most frequently false-flagged files on Windows - cracked games ship a
//! replacement for it, so antivirus quarantines it as a matter of routine. A
//! launcher that silently refuses to start after an antivirus update, on
//! machines where Steam was never the point, is not a trade worth making.
//!
//! So `shiro-steam.exe` carries that dependency instead. If it is missing, or
//! its DLL was quarantined, or Steam is not running, it fails and Shiro carries
//! on with a sign-in button that explains itself.
//!
//! It buys one more thing. Minting a ticket means introducing ourselves to
//! Steam as Zero-K, because a ticket is only valid for the app it was minted
//! for and the server checks Zero-K's. In a sidecar that lasts a second, Steam
//! shows the player as in-game for a second. Linked in here, it would be for as
//! long as the launcher is open.
//!
//! ## The ticket
//!
//! A credential: single use, valid for minutes, and enough to sign in as that
//! player. It is read off the child's stdout, handed to the caller, and never
//! written to a log, a file or an error message. The failure paths deliberately
//! carry no part of it.

use std::path::PathBuf;
use std::process::Stdio;

/// How long to let the helper run.
///
/// It waits about 2.5s on Steam's callbacks by design, so this is that plus
/// room for a cold Steam client, and well short of a person deciding the
/// button is broken.
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(12);

/// Where the helper lives: beside the launcher.
///
/// Tauri drops an `externalBin` next to the main executable with its target
/// triple stripped, and that is true of a dev run and an installed copy alike,
/// so there is one path rather than two.
fn helper() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let name = if cfg!(windows) { "shiro-steam.exe" } else { "shiro-steam" };
    let path = exe.parent()?.join(name);
    path.is_file().then_some(path)
}

/// Steam's own library, as each platform names it.
const STEAM_LIB: &str = if cfg!(windows) { "steam_api64.dll" } else { "libsteam_api.so" };

/// The variable that platform's loader searches for it.
///
/// Windows resolves a load-time import from `PATH`; the ELF loader uses
/// `LD_LIBRARY_PATH` and ignores `PATH` entirely, so setting the wrong one is
/// the same as setting none.
const LOADER_PATH: &str = if cfg!(windows) { "PATH" } else { "LD_LIBRARY_PATH" };

/// The separator that variable takes.
const PATH_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// The directory holding Steam's library, if it shipped.
///
/// The helper imports it at load time, so it has to be findable before the
/// helper's own code runs - too late for anything the helper could do about it.
/// The parent puts the directory on the loader's search path for the child,
/// rather than the bundler having to land a library beside an executable whose
/// placement it does not own.
fn dll_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let dir = app.path().resource_dir().ok()?.join("resources").join("steam");
    dir.join(STEAM_LIB).is_file().then_some(dir)
}

/// Whether signing in with Steam is worth offering on this machine.
///
/// Only asks whether the helper is on disk. Deliberately does not run it:
/// starting it tells Steam that Zero-K is running, and doing that on every
/// launch, to answer a question nobody asked, would put a player in-game for
/// no reason.
#[tauri::command]
pub fn zks_steam_available() -> bool {
    helper().is_some()
}

/// A Steam auth ticket for Zero-K, hex encoded, ready to be a `SteamAuthToken`.
#[tauri::command(async)]
pub fn zks_steam_ticket(app: tauri::AppHandle) -> Result<String, String> {
    let Some(path) = helper() else {
        return Err("This copy of Shiro was built without Steam sign-in.".into());
    };

    let mut cmd = std::process::Command::new(&path);

    /* Without this Windows gives the child its own console, and a black box
       flashes over the launcher for the second it lives. It is a console
       program - it prints one line - so the window is the default rather than
       anything going wrong, and hiding it is the whole fix.

       Set here rather than by building the helper as a windows-subsystem
       binary, because that would also stop it printing when somebody runs it
       from a terminal, and running it by hand is how its failures get
       diagnosed. Piped stdout is unaffected either way. */
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        /// `CREATE_NO_WINDOW`, from the Windows process creation flags.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    /* Prepended rather than replacing: the child still needs the system
       directories to find everything else it links. */
    if let Some(dir) = dll_dir(&app) {
        let existing = std::env::var(LOADER_PATH).unwrap_or_default();
        let mut value = dir.as_os_str().to_os_string();
        if !existing.is_empty() {
            value.push(PATH_SEP.to_string());
            value.push(&existing);
        }
        cmd.env(LOADER_PATH, value);
    }

    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not start the Steam helper: {e}"))?;

    /* Waited on in steps rather than with `wait()`, because a helper that hangs
       would otherwise hang the button that started it. */
    let mut waited = std::time::Duration::ZERO;
    let step = std::time::Duration::from_millis(50);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Err(e) => return Err(format!("The Steam helper failed: {e}")),
            Ok(None) => {}
        }
        if waited >= TIMEOUT {
            let _ = child.kill();
            return Err("Steam did not answer in time.".into());
        }
        std::thread::sleep(step);
        waited += step;
    }

    let out = child
        .wait_with_output()
        .map_err(|e| format!("The Steam helper failed: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    parse(&text)
}

/// The helper's one line of output.
///
/// Split out so the failure paths can be tested without Steam, a helper binary
/// or a machine that has either.
fn parse(stdout: &str) -> Result<String, String> {
    for line in stdout.lines() {
        let line = line.trim();
        if let Some(hex) = line.strip_prefix("ok ") {
            let hex = hex.trim();
            /* Checked rather than trusted. A ticket is hex and nothing else, and
               a malformed one is better refused here than sent to the lobby,
               where a rejected token counts as a failed login attempt and those
               are rate limited by IP. */
            if hex.len() >= 32 && hex.len() % 2 == 0 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Ok(hex.to_string());
            }
            return Err("Steam returned a ticket that does not look like one.".into());
        }
        if let Some(why) = line.strip_prefix("err ") {
            return Err(why.trim().to_string());
        }
    }
    /* No parseable line at all, which is what a missing or quarantined
       `steam_api64.dll` looks like: the helper dies before `main` runs and says
       nothing. There is no way to tell that apart from here, so the sentence
       covers both and neither blames the player. */
    Err("Steam sign-in is not available on this machine. Steam may not be running, \
         or its files may have been removed by antivirus."
        .into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ticket_comes_back_as_the_hex_the_lobby_wants() {
        let hex = "a".repeat(468);
        assert_eq!(parse(&format!("ok {hex}\n")).unwrap(), hex);
    }

    #[test]
    fn the_helpers_own_complaint_is_passed_through() {
        // The helper says why it could not; repeating that beats inventing one.
        let said = parse("err Steam is not available (SteamAPI init failed).\n").unwrap_err();
        assert!(said.contains("Steam is not available"), "{said}");
    }

    #[test]
    fn saying_nothing_is_read_as_steam_being_unavailable() {
        /* A helper whose DLL was quarantined dies before it can print, so this
           is the antivirus case and the no-Steam case at once. */
        let said = parse("").unwrap_err();
        assert!(said.contains("not available"), "{said}");
        assert!(!said.contains("0xC0000135"), "an exit code is not an explanation");
    }

    #[test]
    fn something_that_is_not_a_ticket_is_refused_rather_than_sent() {
        /* Sending a malformed token costs a failed login attempt, and those are
           rate limited by IP at the server. Cheaper to refuse here. */
        assert!(parse("ok not-hex-at-all\n").is_err());
        assert!(parse("ok deadbeef\n").is_err(), "far too short to be a ticket");
        // Odd length cannot be whole bytes.
        assert!(parse(&format!("ok {}\n", "a".repeat(467))).is_err());
    }

    #[test]
    fn noise_before_the_answer_does_not_hide_it() {
        // The SDK prints its own lines to stdout on startup.
        let hex = "b".repeat(64);
        let noisy = format!("Setting breakpad minidump AppID = 334920\nok {hex}\n");
        assert_eq!(parse(&noisy).unwrap(), hex);
    }
}
