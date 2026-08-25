//! The two config files the settings menu writes besides `springsettings.cfg`.
//!
//! Zero-K's in-game settings do not all land in one file. Six of them - the Lups
//! effect switches and the shader detail level - are written into `lups.cfg`,
//! and the two command-colour sliders into `cmdcolors.txt`. Upstream builds both
//! by substituting placeholders into a template that ships inside the Chobby
//! archive, so there is nothing to patch in place: the file is regenerated whole
//! from the template every time.
//!
//! We cannot read a template out of an sd7 without implementing archive access,
//! so the seven small templates are vendored beside this file at a pinned
//! upstream commit. `every_placeholder_we_substitute_exists` guards the pin: if
//! a bump changes a placeholder's name, the test fails rather than the app
//! quietly writing a config with a literal `__AIR_JET__` in it.
//!
//! Which placeholder gets which value is decided in TypeScript
//! (src/net/gameSettings.ts), because that is where the rest of the menu lives.
//! This module only chooses the template and does the substitution.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::install;

/// Pinned with tools/gen-settings.mjs. Bump both together.
pub const TEMPLATE_PIN: &str = "8fed2a62a8e1d4f325aea013743ab82314c9396e";

const LUPS: [&str; 5] = [
    include_str!("templates/lups0.cfg"),
    include_str!("templates/lups1.cfg"),
    include_str!("templates/lups2.cfg"),
    include_str!("templates/lups3.cfg"),
    include_str!("templates/lups4.cfg"),
];
const CMDCOLORS: &str = include_str!("templates/cmdcolors_source.txt");

const LUPS_TARGET: &str = "lups.cfg";
const CMDCOLORS_TARGET: &str = "cmdcolors.txt";
const INFOLOG: &str = "infolog.txt";

/// How much of the engine's log to hand back for the GPU check.
///
/// The driver banner is in the first couple of hundred lines and the scan gives
/// up at `PostInit` anyway, but a full infolog from a long game runs to many
/// megabytes and there is no reason to move it across the bridge.
const INFOLOG_SCAN_BYTES: usize = 64 * 1024;

/// Pick a Lups template by the path upstream names it with.
///
/// The argument is a VFS path like
/// `LuaMenu/configs/gameConfig/zk/lups/lups3.cfg`; only the quality digit in the
/// file name matters here.
pub fn lups_template(upstream_path: &str) -> Option<&'static str> {
    let name = upstream_path.rsplit(['/', '\\']).next()?;
    let digit = name.strip_prefix("lups")?.strip_suffix(".cfg")?;
    digit.parse::<usize>().ok().and_then(|i| LUPS.get(i).copied())
}

/// Substitute `subs` into `template`, and normalise the line endings.
///
/// Every key is expected to be one of the `__NAME__` placeholders. Substitution
/// is a single left-to-right pass, so a value that happens to contain a
/// placeholder is not re-expanded.
///
/// The templates upstream are stored with lone carriage returns - old Mac
/// endings, presumably from whoever first committed them. Lua does not care,
/// but a lone `\r` is not a line break to most things that read a file back,
/// including our own reader in src/net/gameSettings.ts. The copy the official
/// client writes has plain newlines, so match it.
pub fn substitute(template: &str, subs: &BTreeMap<String, String>) -> String {
    let normalised = template.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = String::with_capacity(normalised.len() + 64);
    let mut rest = normalised.as_str();
    'outer: while !rest.is_empty() {
        let Some(start) = rest.find("__") else { break };
        // The shortest placeholder is __X__; look for the closing pair after it.
        if let Some(end) = rest[start + 2..].find("__") {
            let name = &rest[start..start + 2 + end + 2];
            if let Some(value) = subs.get(name) {
                out.push_str(&rest[..start]);
                out.push_str(value);
                rest = &rest[start + 2 + end + 2..];
                continue 'outer;
            }
        }
        // Not a placeholder we know: copy the marker and carry on past it.
        out.push_str(&rest[..start + 2]);
        rest = &rest[start + 2..];
    }
    out.push_str(rest);
    out
}

/// Placeholders left in the text after substitution, if any.
pub fn unsubstituted(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes: Vec<&str> = text.split("__").collect();
    // Odd-indexed fragments sit between a pair of markers.
    for (i, part) in bytes.iter().enumerate() {
        if i % 2 == 1 && !part.is_empty()
            && part.chars().all(|c| c.is_ascii_uppercase() || c == '_')
        {
            out.push(format!("__{part}__"));
        }
    }
    out
}

fn data_file(root: &Path, name: &str) -> PathBuf {
    root.join(name)
}

// -------------------------------------------------------------- commands ----

/// The head of the engine's own log, for the ATI/Intel compatibility check.
///
/// A missing log is not an error - the engine has simply never run here - and
/// the caller treats `None` the way upstream does.
#[tauri::command]
pub fn zks_read_infolog(install_root: Option<String>) -> Result<Option<String>, String> {
    let found = install::detect_with(install_root.as_deref())?;
    let path = data_file(&found.root, INFOLOG);
    match std::fs::read(&path) {
        Ok(bytes) => {
            let head = &bytes[..bytes.len().min(INFOLOG_SCAN_BYTES)];
            Ok(Some(String::from_utf8_lossy(head).into_owned()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("could not read {}: {e}", path.display())),
    }
}

/// The generated `lups.cfg` as it stands, so the settings screen can open
/// showing what the six Lups settings are actually set to.
#[tauri::command]
pub fn zks_read_lups(install_root: Option<String>) -> Result<Option<String>, String> {
    let found = install::detect_with(install_root.as_deref())?;
    let path = data_file(&found.root, LUPS_TARGET);
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("could not read {}: {e}", path.display())),
    }
}

/// Regenerate `lups.cfg` from the template `upstream_path` names.
#[tauri::command]
pub fn zks_write_lups(
    install_root: Option<String>,
    upstream_path: String,
    subs: BTreeMap<String, String>,
) -> Result<(), String> {
    let template = lups_template(&upstream_path)
        .ok_or_else(|| format!("no vendored Lups template for {upstream_path}"))?;
    let text = substitute(template, &subs);
    let left = unsubstituted(&text);
    if !left.is_empty() {
        return Err(format!("lups.cfg would still contain {}", left.join(", ")));
    }
    let found = install::detect_with(install_root.as_deref())?;
    let path = data_file(&found.root, LUPS_TARGET);
    std::fs::write(&path, text).map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// Regenerate `cmdcolors.txt` from the two alpha sliders.
#[tauri::command]
pub fn zks_write_cmdcolors(
    install_root: Option<String>,
    subs: BTreeMap<String, String>,
) -> Result<(), String> {
    let text = substitute(CMDCOLORS, &subs);
    let left = unsubstituted(&text);
    if !left.is_empty() {
        return Err(format!("cmdcolors.txt would still contain {}", left.join(", ")));
    }
    let found = install::detect_with(install_root.as_deref())?;
    let path = data_file(&found.root, CMDCOLORS_TARGET);
    std::fs::write(&path, text).map_err(|e| format!("could not write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn subs(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    /// The whole point of vendoring: if a pin bump renames or drops a
    /// placeholder, fail here rather than write a config the engine cannot read.
    #[test]
    fn every_placeholder_we_substitute_exists() {
        const LUPS_KEYS: [&str; 7] = [
            "__AIR_JET__", "__RIBBON__", "__NANO_PARTICLES__",
            "__SHIELD_SPHERE_COLOR__", "__SHIELD_SPHERE_HIGH_QUALITY__",
            "__ENABLE_REFRACT__", "__ENABLE_REFLECT__",
        ];
        for (i, template) in LUPS.iter().enumerate() {
            for key in LUPS_KEYS {
                assert!(template.contains(key), "lups{i}.cfg is missing {key}");
            }
        }
        for key in ["__CMD_ALPHA__", "__CMD_ALPHA_DARK__", "__QUEUE_ICON_ALPHA__"] {
            assert!(CMDCOLORS.contains(key), "cmdcolors_source.txt is missing {key}");
        }
    }

    /// The other half: nothing in a template goes unhandled.
    #[test]
    fn the_templates_hold_no_placeholder_we_do_not_set() {
        let lups = subs(&[
            ("__AIR_JET__", "true"), ("__RIBBON__", "true"),
            ("__NANO_PARTICLES__", "true"), ("__SHIELD_SPHERE_COLOR__", "false"),
            ("__SHIELD_SPHERE_HIGH_QUALITY__", "true"),
            ("__ENABLE_REFRACT__", "0"), ("__ENABLE_REFLECT__", "0"),
        ]);
        for (i, template) in LUPS.iter().enumerate() {
            let left = unsubstituted(&substitute(template, &lups));
            assert!(left.is_empty(), "lups{i}.cfg left {left:?}");
        }
        let cmd = subs(&[
            ("__CMD_ALPHA__", "0.6"), ("__CMD_ALPHA_DARK__", "0.65"),
            ("__QUEUE_ICON_ALPHA__", "0.45"),
        ]);
        assert!(unsubstituted(&substitute(CMDCOLORS, &cmd)).is_empty());
    }

    #[test]
    fn the_template_is_chosen_by_the_digit_in_its_name() {
        let by = |p| lups_template(p).expect("a vendored template");
        assert!(by("LuaMenu/configs/gameConfig/zk/lups/lups0.cfg").contains("Quality=0"));
        assert!(by("lups4.cfg").contains("Quality=4"));
        assert!(lups_template("lups9.cfg").is_none());
        assert!(lups_template("not-a-template").is_none());
    }

    /// The five templates are NOT a clean quality ladder - they carry 0, 2, 3,
    /// 3 and 4 - so reading the file back cannot go by that number alone. The
    /// two that share a quality are told apart by DistortionUpdateSkip, and
    /// src/net/gameSettings.ts relies on exactly that. Pin it here, because a
    /// pin bump that tidied these up would silently mis-read every lups.cfg.
    #[test]
    fn the_quality_numbers_are_the_ones_the_reader_expects() {
        let quality: Vec<&str> = LUPS
            .iter()
            .map(|t| {
                let i = t.find("Quality=").expect("a Quality line") + "Quality=".len();
                &t[i..i + 1]
            })
            .collect();
        assert_eq!(quality, ["0", "2", "3", "3", "4"]);

        // The templates use lone carriage returns, so `lines()` would see each
        // one as a single line. Substituting normalises that.
        let uncommented_skip = |t: &str| {
            substitute(t, &BTreeMap::new())
                .lines()
                .any(|l| l.trim_start().starts_with("DistortionUpdateSkip"))
        };
        // Only the Medium template leaves it in, which is what separates it
        // from High.
        assert!(uncommented_skip(LUPS[2]), "lups2 should set DistortionUpdateSkip");
        assert!(!uncommented_skip(LUPS[3]), "lups3 should comment it out");
    }

    /// The reader on the other side splits on newlines, and a template full of
    /// lone carriage returns would arrive as one line.
    #[test]
    fn the_written_file_has_ordinary_line_endings() {
        let out = substitute(LUPS[0], &BTreeMap::new());
        assert!(!out.contains('\r'), "a carriage return survived");
        assert!(out.lines().count() > 20, "the file collapsed to one line");
    }

    #[test]
    fn substitution_replaces_every_occurrence() {
        let out = substitute("a __X__ b __X__ c", &subs(&[("__X__", "1")]));
        assert_eq!(out, "a 1 b 1 c");
    }

    #[test]
    fn text_without_placeholders_survives_untouched() {
        let text = "path = C:\\some__weird__name\\file";
        assert_eq!(substitute(text, &subs(&[("__X__", "1")])), text);
    }

    #[test]
    fn a_value_containing_a_placeholder_is_not_expanded_again() {
        let out = substitute("__A____B__", &subs(&[("__A__", "__B__"), ("__B__", "z")]));
        assert_eq!(out, "__B__z");
    }

    #[test]
    fn unsubstituted_finds_what_was_left_behind() {
        assert_eq!(unsubstituted("x __AIR_JET__ y"), vec!["__AIR_JET__"]);
        assert!(unsubstituted("x true y").is_empty());
        // Lower case is not a placeholder; the templates only use upper.
        assert!(unsubstituted("__lower__").is_empty());
    }

    #[test]
    fn a_real_lups_file_comes_out_readable() {
        let lups = subs(&[
            ("__AIR_JET__", "false"), ("__RIBBON__", "false"),
            ("__NANO_PARTICLES__", "false"), ("__SHIELD_SPHERE_COLOR__", "false"),
            ("__SHIELD_SPHERE_HIGH_QUALITY__", "false"),
            ("__ENABLE_REFRACT__", "1"), ("__ENABLE_REFLECT__", "1"),
        ]);
        let out = substitute(LUPS[4], &lups);
        assert!(out.contains("Quality=4"));
        assert!(out.contains("AirJet      = false"));
        assert!(out.contains("EnableRefraction = 1"));
        assert!(out.contains("EnableReflection = 1"));
    }
}
