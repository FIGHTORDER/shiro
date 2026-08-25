//! Handing a battle off to the Spring engine.
//!
//! The server hosts the game; all we do is write the eight-line connect script
//! it implies and start the engine pointed at it (docs/ARCHITECTURE.md
//! section 6). Everything up to the spawn is pure so it can be tested without
//! an engine on the machine.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::install::{self, Install};

/// Game process lifecycle, mirrored to the UI.
const GAME_EVENT: &str = "zks://game";

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GameStatus {
    Launched { pid: u32 },
    Exited { code: Option<i32> },
    Failed { reason: String },
}

/// The fields of `ConnectSpring` that actually reach the engine.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    pub engine: String,
    pub ip: String,
    pub port: u16,
    pub my_player_name: String,
    pub script_password: String,
    /// What the loading screen is allowed to say about this match.
    ///
    /// Optional, and absent is a normal case rather than a degraded one: a
    /// launch that carries no match still launches, and the screen falls back
    /// to the layout that shows none.
    #[serde(default)]
    pub match_info: Option<crate::sidecar::Match>,
}

/// Spring's script format is unquoted and `;`-terminated, so a value containing
/// a delimiter would silently produce a different script rather than an error.
/// Server-issued names and passwords never contain these; reject rather than
/// mangle, so a protocol change surfaces as a message instead of a broken join.
fn check_value(field: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{field} is empty"));
    }
    if let Some(bad) = value.chars().find(|c| matches!(c, ';' | '}' | '{' | '\n' | '\r')) {
        return Err(format!(
            "{field} contains {bad:?}, which the engine script cannot represent"
        ));
    }
    Ok(())
}

/// The entire connect script, per `ScriptGenerator.cs:22-34`.
pub fn connect_script(req: &ConnectRequest) -> Result<String, String> {
    check_value("host address", &req.ip)?;
    check_value("player name", &req.my_player_name)?;
    check_value("script password", &req.script_password)?;
    Ok(format!(
        "[GAME]\n\
         {{\n\
         HostIP={};\n\
         HostPort={};\n\
         IsHost=0;\n\
         MyPlayerName={};\n\
         MyPasswd={};\n\
         }}\n",
        req.ip, req.port, req.my_player_name, req.script_password
    ))
}

/// Everything needed to start the engine, resolved but not yet executed.
#[derive(Debug, PartialEq, Eq)]
pub struct SpawnPlan {
    pub exe: PathBuf,
    pub cwd: PathBuf,
    pub args: Vec<OsString>,
    pub env: Vec<(String, OsString)>,
}

/// Build the command line.
///
/// The data dir is passed through the environment rather than a flag: engine
/// versions disagree about the spelling of the write-dir option, and an
/// unrecognised flag aborts startup, whereas `SPRING_DATADIR` has been stable
/// for a decade. Without it the engine writes to the user's Documents folder
/// and finds none of the installed games or maps.
///
/// `SPRING_WRITEDIR` is set to the same place and is not a duplicate: the
/// engine builds its data directory list write-dir first and `SPRING_DATADIR`
/// last, after `~/.config/spring` and `~/.spring`. Setting both is what puts
/// the installation Shiro is pointed at ahead of a Zero-K the machine may
/// already have - which decides, among other things, whose `LuaIntro/` is read.
pub fn spawn_plan(exe: &Path, root: &Path, script: &Path) -> SpawnPlan {
    let mut args: Vec<OsString> = Vec::new();
    let config = root.join("springsettings.cfg");
    if config.is_file() {
        args.push("--config".into());
        args.push(config.into_os_string());
    }
    args.push(script.as_os_str().to_os_string());
    SpawnPlan {
        exe: exe.to_path_buf(),
        cwd: exe.parent().unwrap_or(root).to_path_buf(),
        args,
        env: vec![
            ("SPRING_DATADIR".into(), root.as_os_str().to_os_string()),
            ("SPRING_WRITEDIR".into(), root.as_os_str().to_os_string()),
        ],
    }
}

/// Where the connect script is written.
///
/// Deliberately not inside the Zero-K folder: a Steam install under
/// `Program Files` is not writable by a per-user process, and failing to launch
/// because of that would be a maddening bug to diagnose.
pub fn script_path() -> PathBuf {
    script_dir().join("connect_script.txt")
}

/// A directory only this user can read.
///
/// The script carries `ScriptPassword`, which is what proves to the game server
/// that a connection is this player. On Windows the temp directory is per-user
/// and that is enough; on Linux `/tmp` is shared, so anyone with an account on
/// the machine could read the password out of it - and `/tmp/shiro` is
/// first-come-first-served, so they could own the directory before we do.
fn script_dir() -> PathBuf {
    if cfg!(windows) {
        return std::env::temp_dir().join("shiro");
    }
    if let Some(run) = std::env::var_os("XDG_RUNTIME_DIR") {
        // Created by the session manager, 0700, and ours.
        return PathBuf::from(run).join("shiro");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join(".cache").join("shiro");
    }
    std::env::temp_dir().join("shiro")
}

/// Make the script readable only by us, on platforms where that is a question.
#[cfg(unix)]
fn restrict(path: &Path, dir: bool) {
    use std::os::unix::fs::PermissionsExt;
    let mode = if dir { 0o700 } else { 0o600 };
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn restrict(_path: &Path, _dir: bool) {}

/// One running game at a time. Zero-K itself is single-instance and two engines
/// fighting over the same write dir corrupts the config.
#[derive(Default)]
pub struct Game {
    running: Arc<Mutex<bool>>,
    /// A path from settings, if the player keeps Zero-K somewhere unusual.
    root: Arc<Mutex<Option<String>>>,
}

/// What a launch would do, resolved but not run.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPreview {
    pub install: Install,
    pub exe: PathBuf,
    pub cwd: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub script_path: PathBuf,
    pub script: String,
}

/// Resolve everything a launch needs and report it, without starting anything.
///
/// The launch is the one part of this client that cannot be exercised without a
/// Zero-K install and a real match, so the first time it runs it had better not
/// be a blank failure. This answers "would it work, and with what" from the
/// settings screen, where the fix - a wrong install path, a missing engine - is
/// two fields away.
#[tauri::command]
pub fn zks_launch_preview(
    game: State<'_, Game>,
    engine: String,
    player: String,
) -> Result<LaunchPreview, String> {
    let root = game.root.lock().ok().and_then(|r| r.clone());
    let install = install::detect_with(root.as_deref())?;
    let exe = install::find_engine(&install.root, &engine)?;
    let script_path = script_path();
    // Placeholder connect details: the point is the paths and the shape of the
    // script, not the address of a game that is not running.
    let req = ConnectRequest {
        engine,
        ip: "0.0.0.0".into(),
        port: 0,
        my_player_name: player,
        script_password: "preview".into(),
        // A preview resolves paths; it is not a match, so there is nothing for
        // the loading screen to be told about.
        match_info: None,
    };
    let script = connect_script(&req)?;
    let plan = spawn_plan(&exe, &install.root, &script_path);
    Ok(LaunchPreview {
        install,
        exe: plan.exe,
        cwd: plan.cwd,
        args: plan.args.iter().map(|a| a.to_string_lossy().into_owned()).collect(),
        env: plan.env.iter()
            .map(|(k, v)| (k.clone(), v.to_string_lossy().into_owned()))
            .collect(),
        script_path,
        script,
    })
}

impl Game {
    /// Is an engine running right now?
    ///
    /// Asked by anything that writes into the data directory: the engine
    /// rewrites `springsettings.cfg` from memory when it exits, so a change
    /// saved while it runs is thrown away without a word.
    pub fn is_running(&self) -> bool {
        self.running.lock().map(|r| *r).unwrap_or(false)
    }
}

#[tauri::command]
pub fn zks_locate_install(game: State<'_, Game>, root: Option<String>) -> Result<Install, String> {
    // The override is remembered so a launch uses the same install the settings
    // screen just confirmed, without having to pass it through ConnectSpring.
    if let Ok(mut r) = game.root.lock() {
        *r = root.clone().filter(|s| !s.trim().is_empty());
    }
    install::detect_with(root.as_deref())
}

/// Write the script and start the engine. Returns once the process has been
/// spawned; the exit arrives later on `zks://game`.
#[tauri::command]
pub fn zks_launch_spring(
    app: AppHandle,
    game: State<'_, Game>,
    req: ConnectRequest,
) -> Result<u32, String> {
    {
        let mut running = game
            .running
            .lock()
            .map_err(|_| "game state poisoned".to_string())?;
        if *running {
            return Err("A game is already running.".into());
        }
        *running = true;
    }

    let override_root = game.root.lock().ok().and_then(|r| r.clone());
    let (mut child, root) = match start(&req, override_root.as_deref()) {
        Ok(started) => started,
        Err(e) => {
            if let Ok(mut r) = game.running.lock() {
                *r = false;
            }
            let _ = app.emit(GAME_EVENT, GameStatus::Failed { reason: e.clone() });
            return Err(e);
        }
    };

    let pid = child.id();
    let _ = app.emit(GAME_EVENT, GameStatus::Launched { pid });

    // Supervise off-thread: the engine owns the screen for the length of a
    // match, and the lobby has to come back by itself when it exits.
    let running = game.running.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        /* The match is over, so what the file beside the loading screen says
           about it stops being true. Nothing else would ever remove it - the
           next launch through Shiro overwrites it, but an engine started out of
           this directory by hand reads whatever is there, and would put the
           roster of a match that finished days ago in front of an unrelated
           game. */
        crate::sidecar::clear(&root);
        if let Ok(mut r) = running.lock() {
            *r = false;
        }
        let _ = app.emit(GAME_EVENT, GameStatus::Exited { code });
    });

    Ok(pid)
}

/// Tell the loading screen what it is loading, or clear what a launch left.
///
/// Only written into an install Shiro owns. The screen that reads this file is
/// only ever placed in one - `loadscreen.rs` says why, and every other entry
/// point to it already asks - so anywhere else this is a file nothing will read
/// in a directory that is not ours, and in a Steam install under Program Files
/// it is a write that fails anyway.
///
/// Clearing is not conditional on that, deliberately: Shiro wrote this file
/// into whatever it launched from before the rule reached here, and nothing
/// else is ever going to tidy those away.
///
/// Failing to write it is not a reason to refuse a launch - the screen degrades
/// to the layout without it, and a game is worth more than a caption.
fn tell_the_loading_screen(root: &Path, m: Option<&crate::sidecar::Match>) {
    match m.filter(|_| install::is_managed(root)) {
        Some(m) => {
            if let Err(e) = crate::sidecar::write(root, m) {
                eprintln!("could not write the match details: {e}");
                crate::sidecar::clear(root);
            }
        }
        None => crate::sidecar::clear(root),
    }
}

/// Resolve install and engine, write the script, spawn. Reports the directory
/// it launched from, which is where the match file has to be cleared later.
fn start(
    req: &ConnectRequest,
    root: Option<&str>,
) -> Result<(std::process::Child, PathBuf), String> {
    let install = install::detect_with(root)?;

    let exe = install::find_engine(&install.root, &req.engine)?;
    let script = script_path();
    if let Some(dir) = script.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        restrict(dir, true);
    }
    std::fs::write(&script, connect_script(req)?)
        .map_err(|e| format!("cannot write {}: {e}", script.display()))?;
    restrict(&script, false);

    let plan = spawn_plan(&exe, &install.root, &script);
    let mut cmd = Command::new(&plan.exe);
    cmd.current_dir(&plan.cwd).args(&plan.args);
    for (k, v) in &plan.env {
        cmd.env(k, v);
    }

    /* Last, once everything that could refuse the launch has had its say. A
       launch that fails at a missing engine never draws a loading screen, so a
       match file written before that check describes a match nothing loaded -
       and sits there until something else launches. */
    tell_the_loading_screen(&install.root, req.match_info.as_ref());

    match cmd.spawn() {
        Ok(child) => Ok((child, install.root)),
        Err(e) => {
            // No engine started, so nothing is going to read it and nothing
            // else would come along to take it away.
            crate::sidecar::clear(&install.root);
            Err(format!("cannot start {}: {e}", plan.exe.display()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shiro-launch-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn a_match() -> crate::sidecar::Match {
        crate::sidecar::Match {
            map: "Comet Catcher Redux".into(),
            title: "Teams 8v8 - all welcome".into(),
            teams: vec![crate::sidecar::Team {
                label: "Team 1".into(),
                players: vec!["Qrow".into()],
            }],
        }
    }

    #[test]
    fn the_match_file_only_goes_into_an_install_shiro_owns() {
        /* The rule loadscreen.rs states and every switch on the screen already
           honours: somebody else's Zero-K is theirs. The addon that reads this
           file is never placed in one, so writing it there litters a directory
           we were not invited into with a file nothing will ever open. */
        let theirs = temp("someone-elses");
        tell_the_loading_screen(&theirs, Some(&a_match()));
        assert!(!crate::sidecar::path(&theirs).exists(), "a match file landed in somebody else's install");

        let ours = temp("managed");
        install::make_managed(&ours).unwrap();
        tell_the_loading_screen(&ours, Some(&a_match()));
        let written = std::fs::read_to_string(crate::sidecar::path(&ours)).unwrap();
        assert!(written.contains("Comet Catcher Redux"));

        let _ = std::fs::remove_dir_all(&theirs);
        let _ = std::fs::remove_dir_all(&ours);
    }

    #[test]
    fn one_an_older_shiro_left_in_their_install_is_taken_away() {
        // Before the rule reached here, every launch wrote this wherever it
        // launched from. Nothing else knows those files are ours.
        let theirs = temp("their-leftover");
        crate::sidecar::write(&theirs, &a_match()).unwrap();
        tell_the_loading_screen(&theirs, Some(&a_match()));
        assert!(!crate::sidecar::path(&theirs).exists());
        assert!(!theirs.join("LuaIntro").exists(), "an empty LuaIntro was left in their install");
        let _ = std::fs::remove_dir_all(&theirs);
    }

    #[test]
    fn a_launch_with_no_match_clears_the_last_one() {
        // The rule sidecar.rs opens with: a file describing a match that is not
        // the one loading is worse than no file at all.
        let ours = temp("no-match");
        install::make_managed(&ours).unwrap();
        tell_the_loading_screen(&ours, Some(&a_match()));
        tell_the_loading_screen(&ours, None);
        assert!(!crate::sidecar::path(&ours).exists());
        let _ = std::fs::remove_dir_all(&ours);
    }

    fn req() -> ConnectRequest {
        ConnectRequest {
            engine: "2025.06.21".into(),
            ip: "128.0.0.1".into(),
            port: 8452,
            my_player_name: "Qrow".into(),
            script_password: "sp-9f2c".into(),
            match_info: None,
        }
    }

    #[test]
    fn writes_the_script_upstream_specifies() {
        assert_eq!(
            connect_script(&req()).unwrap(),
            "[GAME]\n{\nHostIP=128.0.0.1;\nHostPort=8452;\nIsHost=0;\n\
             MyPlayerName=Qrow;\nMyPasswd=sp-9f2c;\n}\n"
        );
    }

    #[test]
    fn never_hosts() {
        assert!(connect_script(&req()).unwrap().contains("IsHost=0;"));
    }

    #[test]
    fn refuses_values_that_would_forge_a_different_script() {
        let mut r = req();
        r.script_password = "x;EnableLag=1".into();
        let err = connect_script(&r).unwrap_err();
        assert!(err.contains("script password"), "{err}");

        let mut r = req();
        r.my_player_name = "a\nb".into();
        assert!(connect_script(&r).is_err());
    }

    #[test]
    fn refuses_empty_values() {
        let mut r = req();
        r.script_password = String::new();
        assert!(connect_script(&r).unwrap_err().contains("empty"));
    }

    #[test]
    fn the_engine_runs_from_its_own_folder_with_the_zk_data_dir() {
        let plan = spawn_plan(
            Path::new("/zk/engine/linux64/2025.06.21/spring"),
            Path::new("/zk"),
            Path::new("/tmp/shiro/connect_script.txt"),
        );
        assert_eq!(plan.cwd, Path::new("/zk/engine/linux64/2025.06.21"));
        assert_eq!(plan.args, vec![OsString::from("/tmp/shiro/connect_script.txt")]);
        /* Both, not either. The engine reads the write dir first and
           SPRING_DATADIR last, so on a machine with a Zero-K in ~/.spring the
           second alone would leave that one's data ahead of ours - including
           the LuaIntro the loading screen is written into. */
        for key in ["SPRING_DATADIR", "SPRING_WRITEDIR"] {
            assert!(plan.env.iter().any(|(k, v)| k == key && v == "/zk"), "{key} is not set");
        }
    }

    #[test]
    fn the_script_never_lands_inside_the_install() {
        /* A Steam install under Program Files is read-only for a per-user
           process, so the script goes somewhere scratch. Which scratch
           directory depends on the platform - see script_dir - so the property
           worth pinning is that it is not in the install and is somewhere only
           this user can reach. */
        let path = script_path();
        assert!(path.ends_with("connect_script.txt"));
        assert_eq!(path.parent().and_then(|p| p.file_name()), Some("shiro".as_ref()));
        assert!(!path.to_string_lossy().contains("Zero-K"));
    }

    #[cfg(unix)]
    #[test]
    fn the_script_directory_is_not_world_readable() {
        use std::os::unix::fs::PermissionsExt;
        // It carries ScriptPassword, which is what proves a connection is this
        // player. On a shared machine /tmp is everybody's.
        let dir = std::env::temp_dir().join("shiro-perm-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        restrict(&dir, true);
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o077;
        assert_eq!(mode, 0, "another user on this machine can read the script");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
