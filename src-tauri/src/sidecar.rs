//! What the loading screen is allowed to know about the match.
//!
//! The engine's loading context knows the game name, the current load step and
//! a progress number. It does not know who is playing, what the map is called,
//! or what the room was named - that lives in the lobby, on the other side of a
//! process boundary.
//!
//! So Shiro writes it down. A small Lua file goes beside the addon at launch,
//! the addon reads it if it is there, and the screen shows the match. Zero-K's
//! own `luaintro/main.lua` sets `VFS.DEF_MODE = VFS.RAW_FIRST`, which is what
//! lets both files be found in the data directory at all.
//!
//! Four rules this file exists to keep:
//!
//! - **It is written fresh for every launch, and cleared when the game ends.** A
//!   stale file describing last week's match is worse than none: the screen
//!   would state, confidently, something untrue. Shiro's own launches would
//!   never see that, since each one writes or clears before it starts anything -
//!   but an engine started out of the same directory by hand reads whatever is
//!   left lying there, which is why the clearing outlives the launch.
//! - **It goes only where Shiro's loading screen goes.** The addon that reads
//!   it is placed in an install Shiro owns and nowhere else - `loadscreen.rs`
//!   says why - so anywhere else this is a file nobody reads in a directory
//!   nobody asked us to write in. `launch.rs` is where that is enforced.
//! - **Every string is escaped.** A room title is typed by a person and reaches
//!   here unfiltered. An unescaped quote or newline turns a data file into a
//!   syntax error, and the addon then draws nothing where the match should be.
//! - **Nothing here is required.** The addon reads this defensively and falls
//!   back to the layout without it. A launcher that cannot write the file still
//!   launches the game.

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// One side of the match, as the screen groups them.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    /// What to call it. The lobby numbers ally teams from zero; the label is
    /// made by whoever fills this in, so the screen shows "Team 1" rather than
    /// having to know that convention.
    pub label: String,
    pub players: Vec<String>,
}

/// The match, as much of it as the screen shows.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub map: String,
    pub title: String,
    pub teams: Vec<Team>,
}

/// Where it goes. Beside the addon, not inside `Addons/`, because the handler
/// scans that directory and would try to load this as an addon.
///
/// `LuaIntro` is capitalised to match the string the addon reads it back
/// through - see `loadscreen::path`, where the same rule is the difference
/// between a screen that draws on Linux and one that does not.
pub fn path(root: &Path) -> PathBuf {
    root.join("LuaIntro").join("shiro-match.lua")
}

/// A Lua string literal that cannot break the file that contains it.
///
/// Decimal escapes rather than a passthrough: a room title is free text typed
/// by a person, and one apostrophe or line break in it would otherwise turn the
/// whole file into a parse error - which the addon survives, but by showing
/// nothing. Always three digits, so a following digit cannot be absorbed into
/// the escape.
fn lua_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for byte in value.as_bytes() {
        match byte {
            b'"' | b'\\' => out.push_str(&format!("\\{:03}", byte)),
            0x20..=0x7E => out.push(*byte as char),
            // Control bytes and everything non-ASCII. UTF-8 survives this
            // because each byte is escaped and Lua puts them back in order.
            _ => out.push_str(&format!("\\{:03}", byte)),
        }
    }
    out.push('"');
    out
}

/// The file's contents for a match.
pub fn render(m: &Match) -> String {
    let mut out = String::from(
        "-- Written by Shiro at launch. Read by LuaIntro/Addons/main.lua.\n\
         -- Replaced every launch; safe to delete.\n\
         return {\n",
    );
    out.push_str(&format!("\tmap = {},\n", lua_string(&m.map)));
    out.push_str(&format!("\ttitle = {},\n", lua_string(&m.title)));
    out.push_str("\tteams = {\n");
    for team in &m.teams {
        out.push_str("\t\t{\n");
        out.push_str(&format!("\t\t\tlabel = {},\n", lua_string(&team.label)));
        out.push_str("\t\t\tplayers = {\n");
        for player in &team.players {
            out.push_str(&format!("\t\t\t\t{},\n", lua_string(player)));
        }
        out.push_str("\t\t\t},\n\t\t},\n");
    }
    out.push_str("\t},\n}\n");
    out
}

/// Write it for this launch, replacing whatever was there.
pub fn write(root: &Path, m: &Match) -> Result<(), String> {
    let file = path(root);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    std::fs::write(&file, render(m))
        .map_err(|e| format!("could not write {}: {e}", file.display()))
}

/// Remove it, so nothing inherits the last match's roster.
pub fn clear(root: &Path) {
    let file = path(root);
    let _ = std::fs::remove_file(&file);
    /* And the directory, if this was the only thing in it. `remove_dir` refuses
       a directory that still holds something, which is the question worth
       asking: with the loading screen installed there is an addon and two
       pictures in here and the folder stays, and where this file was all Shiro
       ever put - an install of somebody else's that an older build wrote into -
       nothing of ours is left behind. */
    if let Some(dir) = file.parent() {
        let _ = std::fs::remove_dir(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shiro-sidecar-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample() -> Match {
        Match {
            map: "Comet Catcher Redux".into(),
            title: "Teams 8v8 - all welcome".into(),
            teams: vec![
                Team { label: "Team 1".into(), players: vec!["Qrow".into(), "hexed".into()] },
                Team { label: "Team 2".into(), players: vec!["CAI (1)".into()] },
            ],
        }
    }

    #[test]
    fn it_renders_a_table_the_addon_can_read() {
        let out = render(&sample());
        assert!(out.starts_with("--"), "no comment header");
        assert!(out.contains("return {"));
        assert!(out.contains("map = \"Comet Catcher Redux\""));
        assert!(out.contains("\"Qrow\""));
        assert!(out.contains("label = \"Team 2\""));
    }

    #[test]
    fn a_title_somebody_typed_cannot_break_the_file() {
        /* This is the whole reason escaping is here. A room title is free text
           and reaches this unfiltered - a quote or a newline in one would end
           the string early and turn the file into a syntax error, which the
           addon survives only by showing nothing. */
        let mut m = sample();
        m.title = "he said \"go\"\nthen left \\ north".into();
        let out = render(&m);
        // The raw delimiters must not survive into the literal.
        let line = out.lines().find(|l| l.contains("title =")).unwrap();
        assert!(!line.contains("\"go\""), "an unescaped quote reached the file");
        assert_eq!(out.matches('\n').count(), out.lines().count() - 1 + 1,
            "a newline in a value split the file across lines");
    }

    #[test]
    fn non_ascii_names_survive() {
        // Zero-K names are broad. Escaping every byte is what makes this work
        // rather than depending on the file's encoding.
        let mut m = sample();
        m.teams[0].players = vec!["Продержись".into(), "守住".into()];
        let out = render(&m);
        assert!(out.contains("\\208"), "non-ASCII was not escaped");
        assert!(out.lines().all(|l| l.is_ascii()), "the file is not pure ASCII");
    }

    #[test]
    fn every_launch_replaces_the_last_one() {
        /* A stale file is worse than no file: the screen would confidently
           state something untrue about the match being loaded. */
        let root = temp("replace");
        write(&root, &sample()).unwrap();
        let mut second = sample();
        second.map = "Another Map".into();
        write(&root, &second).unwrap();
        let text = std::fs::read_to_string(path(&root)).unwrap();
        assert!(text.contains("Another Map"));
        assert!(!text.contains("Comet Catcher Redux"), "the previous match survived");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn clearing_it_leaves_nothing_to_read() {
        let root = temp("clear");
        write(&root, &sample()).unwrap();
        clear(&root);
        assert!(!path(&root).exists());
        // And no folder of ours around where it was, for the install this was
        // never supposed to be written into in the first place.
        assert!(!root.join("LuaIntro").exists());
        // Clearing what is not there is the desired state, not an error.
        clear(&root);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn it_sits_beside_the_addon_not_among_them() {
        // `LuaIntro/Addons/` is scanned by the handler; a data file in there
        // would be loaded as an addon and fail.
        let root = temp("place");
        let p = path(&root);
        assert!(p.ends_with("shiro-match.lua"));
        assert_eq!(p.parent().unwrap().file_name().unwrap(), "LuaIntro");
        let _ = std::fs::remove_dir_all(&root);
    }
}
