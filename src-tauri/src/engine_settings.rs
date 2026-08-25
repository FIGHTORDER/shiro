//! Reading and writing the engine's `springsettings.cfg`.
//!
//! The engine reads this file out of the data dir we hand it via `SPRING_DATADIR`
//! (see `launch.rs`). Shiro never wrote it, so a game booted with whatever the
//! previous client happened to leave there — most visibly `interfaceScale`, which
//! is why the in-game UI could come up at the wrong size.
//!
//! Format is one `Key = Value` per line, no comments, no sections, LF endings.
//! We patch keys in place and leave every other line exactly as found: the file
//! holds ~110 graphics and networking settings that are none of our business, and
//! rewriting it wholesale would silently discard anything we do not model.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::install;

/// The file, relative to the Zero-K data dir.
const FILE: &str = "springsettings.cfg";

/// Split one `Key = Value` line. Returns None for blanks and anything without
/// a separator, so unparseable lines survive a round trip untouched.
fn split_line(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('/') {
        return None;
    }
    let (k, v) = trimmed.split_once('=')?;
    Some((k.trim(), v.trim()))
}

/// Every setting in the file, in a stable order.
pub fn parse(text: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for line in text.lines() {
        if let Some((k, v)) = split_line(line) {
            out.insert(k.to_string(), v.to_string());
        }
    }
    out
}

/// Patch `changes` into `text`, preserving every other line verbatim.
///
/// Existing keys are rewritten where they sit, so the file keeps its order and
/// any line we do not understand is carried through untouched. Keys the file
/// does not have yet are appended.
pub fn apply(text: &str, changes: &BTreeMap<String, String>) -> String {
    let mut remaining = changes.clone();
    let mut out = String::with_capacity(text.len() + 64);

    for line in text.lines() {
        match split_line(line) {
            Some((key, _)) if remaining.contains_key(key) => {
                let value = remaining.remove(key).expect("checked above");
                out.push_str(&format!("{key} = {value}\n"));
            }
            _ => {
                out.push_str(line);
                out.push('\n');
            }
        }
    }

    // Anything the file did not already carry.
    for (key, value) in remaining {
        out.push_str(&format!("{key} = {value}\n"));
    }
    out
}

fn config_path(root: &Path) -> PathBuf {
    root.join(FILE)
}

/// Read the engine settings from the located install.
///
/// A missing file is not an error: the engine writes one on first run, and an
/// empty map is the honest answer until then.
#[tauri::command]
pub fn zks_read_engine_settings(
    install_root: Option<String>,
) -> Result<BTreeMap<String, String>, String> {
    let found = install::detect_with(install_root.as_deref())?;
    let path = config_path(&found.root);
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(parse(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(e) => Err(format!("could not read {}: {e}", path.display())),
    }
}

/// Write the given settings, leaving everything else in the file alone.
///
/// Refused while a game is running. The engine holds these settings in memory
/// and writes the whole file back when it exits, so anything saved in the
/// meantime is overwritten without a word - the change appears to work, and is
/// gone by the time anybody looks.
#[tauri::command]
pub fn zks_write_engine_settings(
    game: tauri::State<'_, crate::launch::Game>,
    install_root: Option<String>,
    changes: BTreeMap<String, String>,
) -> Result<(), String> {
    if changes.is_empty() {
        return Ok(());
    }
    if game.is_running() {
        return Err(
            "Zero-K is running. It rewrites this file when it exits, so changes saved now \
             would be lost - close the game and try again."
                .into(),
        );
    }
    let found = install::detect_with(install_root.as_deref())?;
    let path = config_path(&found.root);

    let existing = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("could not read {}: {e}", path.display())),
    };

    std::fs::write(&path, apply(&existing, &changes))
        .map_err(|e| format!("could not write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn changes(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    const SAMPLE: &str = "3DTrees = 1\nFontSize = 18\nXResolution = 1920\ninterfaceScale = 125\n";

    #[test]
    fn parses_key_value_lines() {
        let s = parse(SAMPLE);
        assert_eq!(s.get("interfaceScale").map(String::as_str), Some("125"));
        assert_eq!(s.get("FontSize").map(String::as_str), Some("18"));
        assert_eq!(s.len(), 4);
    }

    #[test]
    fn patches_in_place_and_keeps_position() {
        let out = apply(SAMPLE, &changes(&[("interfaceScale", "100")]));
        assert_eq!(
            out,
            "3DTrees = 1\nFontSize = 18\nXResolution = 1920\ninterfaceScale = 100\n"
        );
    }

    /// The whole point: the file holds ~110 settings we do not model, and none
    /// of them may be lost because we touched one.
    #[test]
    fn never_drops_settings_it_does_not_understand() {
        let messy = "AllowDeferredMapRendering = 1\nCamTimeExponent = 4.0\n\
                     SomeFutureKey = whatever\ninterfaceScale = 125\n";
        let out = apply(messy, &changes(&[("interfaceScale", "150")]));
        assert!(out.contains("AllowDeferredMapRendering = 1"));
        assert!(out.contains("CamTimeExponent = 4.0"));
        assert!(out.contains("SomeFutureKey = whatever"));
        assert!(out.contains("interfaceScale = 150"));
        assert_eq!(out.lines().count(), 4);
    }

    #[test]
    fn appends_keys_the_file_does_not_have() {
        let out = apply("FontSize = 18\n", &changes(&[("interfaceScale", "125")]));
        assert!(out.contains("FontSize = 18"));
        assert!(out.contains("interfaceScale = 125"));
    }

    #[test]
    fn writing_into_an_empty_file_produces_the_settings() {
        let out = apply("", &changes(&[("interfaceScale", "100")]));
        assert_eq!(out, "interfaceScale = 100\n");
    }

    #[test]
    fn tolerates_lines_that_are_not_settings() {
        let odd = "# a comment\n\nFontSize = 18\ngarbage without a separator\n";
        let out = apply(odd, &changes(&[("FontSize", "20")]));
        assert!(out.contains("# a comment"));
        assert!(out.contains("garbage without a separator"));
        assert!(out.contains("FontSize = 20"));
    }

    #[test]
    fn values_containing_equals_survive() {
        // split_once takes the FIRST '=', so a value may contain more.
        let s = parse("Path = C:\\a=b\\c\n");
        assert_eq!(s.get("Path").map(String::as_str), Some("C:\\a=b\\c"));
    }
}
