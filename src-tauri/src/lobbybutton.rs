//! The in-game Lobby button, on this side of the process boundary.
//!
//! Zero-K's own Lobby button only exists when the lobby is a LuaMenu inside the
//! engine, so under Shiro it is absent and the button row has a hole where it
//! used to be. `lobbybutton/shiro_lobby_button.lua` puts a button back; this is
//! what happens when somebody presses it.
//!
//! The channel is a file, for the reason the widget cannot use anything better:
//! the engine removes `os.execute`, `io.popen` and `os.getenv` from LuaUI, and
//! `Spring.SendLuaMenuMsg` is a silent no-op with no menu. A write into the
//! engine's write directory is permitted and is what Zero-K's own widgets
//! already use to save their configs.
//!
//! Two rules this file exists to keep:
//!
//! - **A press is a change in content, not the file existing.** Deleting the
//!   file to consume a press would race the widget writing the next one, and a
//!   press that lands in that window is a button that did nothing. The widget
//!   writes a time and a counter; a value we have not seen is a press.
//! - **A file left over from a previous game is not a press.** Shiro raising
//!   itself the instant a match starts is the exact opposite of what the button
//!   is for, so a launch takes whatever is on disk as already seen.

use std::path::{Path, PathBuf};

/// Where the widget writes, relative to the engine's write directory.
///
/// The widget spells this as `LuaUI/shiro-lobby.txt`; the two have to agree,
/// which is what the test at the bottom of this file checks.
const SIGNAL: &str = "shiro-lobby.txt";

pub fn path(root: &Path) -> PathBuf {
    root.join("LuaUI").join(SIGNAL)
}

/// What the file says, or `None` when there is nothing to read.
fn read(root: &Path) -> Option<String> {
    std::fs::read_to_string(path(root)).ok()
}

/// Take the current state as already seen, and tidy up if we can.
///
/// Called once per launch. The removal is the tidy half and is allowed to fail:
/// what actually stops a stale press firing is that its content is returned
/// here as the baseline, so a file we could not delete is still not a press.
pub fn prime(root: &Path) -> Option<String> {
    let seen = read(root);
    let _ = std::fs::remove_file(path(root));
    seen
}

/// Whether the button has been pressed since the last look.
///
/// `seen` carries the state between calls and is updated in place.
pub fn pressed(root: &Path, seen: &mut Option<String>) -> bool {
    let now = read(root);
    if now.is_none() || now == *seen {
        return false;
    }
    *seen = now;
    true
}

/// Bring the lobby to the front.
///
/// The same pair the single instance handler uses when a second launch is
/// really a request to look at the window that already exists. Both are allowed
/// to fail: a window manager that refuses to raise a window is not a reason to
/// take the game down with it.
pub fn raise(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// The widget's file name in `LuaUI/Widgets/`.
///
/// The `shiro_` prefix is the one the widget installer uses, so the widgets
/// panel already recognises this as ours and will offer to take it back out.
const WIDGET_NAME: &str = "shiro_lobby_button.lua";

/// Put the widget in place, so that there is a button to press.
///
/// Nothing did this. `supervise` primed and polled for the file five times a
/// second for the length of every game, and the only thing that writes it is a
/// widget that only a developer running `tools/install-lobby-button.mjs` had:
/// for everybody else the feature did not exist.
///
/// Only into an install Shiro manages, which is the same rule the loading
/// screen addon follows. A player's own Zero-K is theirs, and writing widgets
/// into it uninvited is not Shiro's to do.
///
/// Allowed to fail for the same reason as the loading screen: a game is worth
/// more than a button, and a read-only install should still start.
pub fn place(root: &Path) {
    if !crate::install::is_managed(root) {
        return;
    }
    let dir = root.join("LuaUI").join("Widgets");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let lua = include_str!("lobbybutton/shiro_lobby_button.lua");
    if let Err(e) = std::fs::write(dir.join(WIDGET_NAME), lua) {
        eprintln!("could not place the lobby button: {e}");
        return;
    }
    // Zero-K ignores LuaUI/Widgets until this is set, so without it the file
    // above is one that never loads.
    if let Err(e) = crate::widgets::turn_on_local_widgets(root) {
        eprintln!("could not switch local widgets on for the lobby button: {e}");
    }
}

/// How often the file is looked at while a game is running.
///
/// Fast enough that the button feels like a button, and one `stat` of one small
/// file apart, it costs nothing.
pub const POLL: std::time::Duration = std::time::Duration::from_millis(200);

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shiro-lobbybutton-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("LuaUI")).unwrap();
        dir
    }

    /// The widget is only useful if something puts it where the engine looks.
    #[test]
    fn the_widget_is_placed_into_an_install_shiro_manages() {
        let root = temp("place");
        // What marks an install as Shiro's own.
        std::fs::write(root.join(crate::install::MANAGED_MARKER), "").unwrap();

        place(&root);

        let widget = root.join("LuaUI").join("Widgets").join(WIDGET_NAME);
        assert!(widget.is_file(), "nothing writes the file the poll waits for");
        let lua = std::fs::read_to_string(&widget).unwrap();
        assert!(lua.contains(SIGNAL), "the placed widget writes a different file");
        let data = std::fs::read_to_string(root.join("LuaUI/Config/ZK_data.lua"))
            .expect("raw widgets were never switched on, so it would never load");
        assert!(data.contains("useLocalWidgets"), "{data}");
    }

    /// Somebody else's Zero-K is not ours to write widgets into.
    #[test]
    fn an_install_shiro_does_not_manage_is_left_alone() {
        let root = temp("unmanaged");
        place(&root);
        assert!(!root.join("LuaUI").join("Widgets").join(WIDGET_NAME).exists());
    }

    fn press(root: &Path, body: &str) {
        std::fs::write(path(root), body).unwrap();
    }

    #[test]
    fn nothing_written_is_not_a_press() {
        let root = temp("quiet");
        let mut seen = prime(&root);
        assert!(!pressed(&root, &mut seen));
        assert!(!pressed(&root, &mut seen));
    }

    #[test]
    fn a_write_is_one_press_however_often_we_look() {
        let root = temp("once");
        let mut seen = prime(&root);
        press(&root, "1787821824:1\n");
        assert!(pressed(&root, &mut seen), "the press was missed");
        assert!(!pressed(&root, &mut seen), "the same press fired twice");
        assert!(!pressed(&root, &mut seen));
    }

    #[test]
    fn each_new_value_is_its_own_press() {
        let root = temp("again");
        let mut seen = prime(&root);
        for n in 1..=4 {
            press(&root, &format!("1787821824:{n}\n"));
            assert!(pressed(&root, &mut seen), "press {n} was missed");
        }
    }

    /// The case that decides whether the button is usable at all. Consuming a
    /// press by deleting the file would drop the second of two quick presses;
    /// comparing content cannot.
    #[test]
    fn a_press_is_never_consumed_by_reading_it() {
        let root = temp("race");
        let mut seen = prime(&root);
        press(&root, "1787821824:1\n");
        assert!(pressed(&root, &mut seen));
        assert!(path(&root).is_file(), "reading a press removed it");
    }

    /// A launch is not a press. The file outlives the game that wrote it, and
    /// Shiro jumping in front of the map at the start of the next match is
    /// exactly what nobody wants.
    #[test]
    fn a_press_from_a_previous_game_does_not_fire() {
        let root = temp("stale");
        press(&root, "1787821824:9\n");
        let mut seen = prime(&root);
        assert!(!pressed(&root, &mut seen));
        // And the game after that one, if the file could not be removed.
        std::fs::write(path(&root), "1787821824:9\n").unwrap();
        assert!(!pressed(&root, &mut seen));
    }

    /// Both halves name the same file, in two languages, in two directories.
    #[test]
    fn the_widget_and_this_module_agree_on_the_path() {
        let lua = include_str!("lobbybutton/shiro_lobby_button.lua");
        let want = format!("\"LuaUI/{SIGNAL}\"");
        assert!(
            lua.contains(&want),
            "the widget does not write {want}; it and lobbybutton.rs have drifted"
        );
    }
}
