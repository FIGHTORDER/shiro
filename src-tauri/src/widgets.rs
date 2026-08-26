//! Community widgets, installed into Zero-K's own LuaUI directory.
//!
//! Zero-K's widget handler scans `<ZK>/LuaUI/Widgets/*.lua` and picks its VFS
//! mode from `<ZK>/LuaUI/Config/ZK_data.lua`. The two lines that read it
//! (`cawidgets.lua:114-115`) are:
//!
//! ```lua
//! localWidgetsFirst = cadata["Local Widgets Config"].useLocalWidgetsFirst or true
//! localWidgets      = cadata["Local Widgets Config"].useLocalWidgets or true
//! ```
//!
//! `false or true` is true in Lua, so once that table exists both flags are on
//! whatever they are set to. Two consequences run through this whole module:
//!
//! - **Enabling local widgets means ensuring the table exists**, and disabling
//!   them means removing it. Writing `false` does nothing at all.
//! - **The mode is then always `RAW_FIRST`**, where a raw file replaces the
//!   packaged widget of the same name. `ZIP_FIRST`, where the archive would
//!   win, is unreachable through config, so there is no engine-level guard
//!   against shadowing and [`is_stock`] is the only one.
//!
//! Everything here is path and text logic kept apart from the filesystem, the
//! way `launch.rs` and `install.rs` are, so it tests without a Zero-K install.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::gitsource::{self, Build, Repo};
use crate::install;

/// Every widget filename Zero-K ships, from `tools/gen-stock-widgets.mjs`.
const STOCK: &str = include_str!("stock_widgets.txt");

/// Ours, so removal can never take a file we did not put there.
const PREFIX: &str = "shiro_";

const LUAUI_DIR: &str = "LuaUI";
const WIDGET_DIR: &str = "LuaUI/Widgets";
const ORDER_FILE: &str = "LuaUI/Config/ZK_order.lua";
const DATA_FILE: &str = "LuaUI/Config/ZK_data.lua";

/// The key `cawidgets.lua` looks for. Its presence is the whole setting.
const LOCAL_WIDGETS_KEY: &str = "Local Widgets Config";

/// Where a widget we enable lands in the load order. Zero-K uses 12345 for
/// "back of the pack" when it meets a widget it has never seen, so this matches
/// what the game would have chosen on its own.
const BACK_OF_THE_PACK: i64 = 12345;

/// A widget's own declaration, read out of its `GetInfo()`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WidgetInfo {
    /// The name Zero-K keys `ZK_order.lua` on - **not** the filename.
    pub name: String,
    /// Whether it asks to be on by default.
    pub enabled: bool,
    /// `alwaysStart` overrides the order list entirely.
    pub always_start: bool,
}

/// One widget file found in the install.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledWidget {
    pub file: String,
    pub name: String,
    /// Whether it will load next time the game starts.
    pub enabled: bool,
    /// True when Shiro installed it, which is what makes it ours to remove.
    pub ours: bool,
}

// ------------------------------------------------------------- stock list ---

/// Whether Zero-K ships a file at this path, relative to `LuaUI/Widgets`.
///
/// The comparison is the whole path, because that is what actually collides.
/// `cawidgets.lua:496-508` dedups the VFS listing on the full path with
/// separators normalised, so `chili/Skins/Shiro/skin.lua` does not displace
/// `chili/Skins/Evolved/skin.lua` even though both are called `skin.lua`.
///
/// Matching on the basename instead looked equivalent and is not: Zero-K ships
/// twenty-two files named `skin.lua`, so every game UI skin would have been
/// reported as replacing a packaged widget.
pub fn is_stock(widgets_rel: &str) -> bool {
    let want = widgets_rel.trim().replace('\\', "/").to_ascii_lowercase();
    if want.is_empty() {
        return false;
    }
    STOCK
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case(&want))
}

// ---------------------------------------------------------- GetInfo parse ---

/// Blank out Lua comments so a commented-out field cannot be read as live.
///
/// Quote-aware, because `--` inside a string is not a comment and blanking it
/// would eat the rest of a legitimate line. Long comments (`--[[ ]]`) are
/// handled because widgets genuinely use them to disable blocks.
fn strip_comments(lua: &str) -> String {
    let b = lua.as_bytes();
    let mut out = String::with_capacity(lua.len());
    let mut i = 0;
    let mut quote: Option<u8> = None;
    while i < b.len() {
        let c = b[i];
        match quote {
            Some(q) => {
                out.push(c as char);
                if c == b'\\' && i + 1 < b.len() {
                    out.push(b[i + 1] as char);
                    i += 2;
                    continue;
                }
                if c == q {
                    quote = None;
                }
                i += 1;
            }
            None => {
                if c == b'"' || c == b'\'' {
                    quote = Some(c);
                    out.push(c as char);
                    i += 1;
                } else if c == b'-' && i + 1 < b.len() && b[i + 1] == b'-' {
                    // A long comment runs to its matching close; a short one to end of line.
                    if b[i..].starts_with(b"--[[") {
                        match lua[i..].find("]]") {
                            Some(end) => i += end + 2,
                            None => i = b.len(),
                        }
                    } else {
                        while i < b.len() && b[i] != b'\n' {
                            i += 1;
                        }
                    }
                } else {
                    out.push(c as char);
                    i += 1;
                }
            }
        }
    }
    out
}

/// Whether the `GetInfo` at `at` is a definition rather than a call site.
///
/// Library files in the wild call `widget:GetInfo().name` on *other* widgets,
/// and anchoring on the first mention would parse whatever table happened to
/// follow. Matches `function widget:GetInfo()`, the dot form, and the
/// `widget.GetInfo = function()` form.
fn is_definition(lua: &str, at: usize) -> bool {
    if lua[at + "GetInfo".len()..].trim_start().starts_with("= function") {
        return true;
    }
    // Walk back over exactly `function <receiver>:` and nothing else. A window
    // that merely *contains* "function" also matches `local function nice(w)`
    // wrapping a `w:GetInfo()` call, which is the case this has to exclude.
    let head = lua[..at].trim_end();
    let Some(head) = head.strip_suffix([':', '.']) else {
        return false;
    };
    let head = head.trim_end();
    let receiver_start = head
        .rfind(|c: char| !(c.is_alphanumeric() || c == '_'))
        .map(|i| i + 1)
        .unwrap_or(0);
    if receiver_start == head.len() {
        return false;
    }
    head[..receiver_start].trim_end().ends_with("function")
}

/// The body of the table `GetInfo` returns, or `None` if it cannot be found.
fn get_info_block(lua: &str) -> Option<&str> {
    let mut at = None;
    let mut from = 0;
    while let Some(hit) = lua[from..].find("GetInfo") {
        let idx = from + hit;
        if is_definition(lua, idx) {
            at = Some(idx);
            break;
        }
        from = idx + "GetInfo".len();
    }
    let at = at?;
    let open = lua[at..].find('{')? + at;
    let b = lua.as_bytes();
    let mut depth = 0usize;
    for (i, &c) in b.iter().enumerate().skip(open) {
        if c == b'{' {
            depth += 1;
        } else if c == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some(&lua[open + 1..i]);
            }
        }
    }
    None
}

/// `field = "value"` inside the block, at any nesting, first match wins.
fn field_string(block: &str, field: &str) -> Option<String> {
    let rest = after_assignment(block, field)?;
    let q = rest.chars().next()?;
    if q != '"' && q != '\'' {
        return None;
    }
    let body = &rest[q.len_utf8()..];
    let end = body.find(q)?;
    Some(body[..end].to_string())
}

/// `field = true` / `field = false` inside the block.
fn field_bool(block: &str, field: &str) -> Option<bool> {
    let rest = after_assignment(block, field)?;
    if rest.starts_with("true") {
        Some(true)
    } else if rest.starts_with("false") {
        Some(false)
    } else {
        None
    }
}

/// The text just past `field` `=`, with the field matched as a whole word so
/// `name` does not also match `basename`.
fn after_assignment<'a>(block: &'a str, field: &str) -> Option<&'a str> {
    let mut from = 0;
    while let Some(at) = block[from..].find(field) {
        let start = from + at;
        let end = start + field.len();
        let before_ok = start == 0
            || !block[..start]
                .chars()
                .next_back()
                .map(|c| c.is_alphanumeric() || c == '_')
                .unwrap_or(false);
        let rest = block[end..].trim_start();
        if before_ok && rest.starts_with('=') {
            return Some(rest[1..].trim_start());
        }
        from = end;
    }
    None
}

/// What a widget says about itself.
///
/// A file we cannot read a name out of is not installable: the name is the key
/// `ZK_order.lua` uses, and guessing it from the filename would write an entry
/// that silently governs nothing.
pub fn parse_get_info(lua: &str) -> Option<WidgetInfo> {
    let clean = strip_comments(lua);
    let block = get_info_block(&clean)?;
    let name = field_string(block, "name")?;
    if name.trim().is_empty() {
        return None;
    }
    Some(WidgetInfo {
        name: name.trim().to_string(),
        // Zero-K's own default for a widget that does not say.
        enabled: field_bool(block, "enabled").unwrap_or(false),
        always_start: field_bool(block, "alwaysStart").unwrap_or(false),
    })
}

// ------------------------------------------------------ ZK_order.lua edit ---

/// How Spring's `table.save` writes a key: bare when it is a Lua identifier,
/// bracketed and quoted otherwise.
fn lua_key(name: &str) -> String {
    let ident = !name.is_empty()
        && !name.starts_with(|c: char| c.is_ascii_digit())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ident {
        name.to_string()
    } else {
        format!("[{:?}]", name)
    }
}

/// Find the line holding `name`'s entry, as a byte range over the whole line.
fn order_entry(text: &str, name: &str) -> Option<(usize, usize, i64)> {
    let bare = lua_key(name);
    let bracketed = format!("[{:?}]", name);
    let mut at = 0;
    for line in text.split_inclusive('\n') {
        let start = at;
        at += line.len();
        let t = line.trim();
        let key = match t.split('=').next() {
            Some(k) => k.trim(),
            None => continue,
        };
        if key != bare && key != bracketed {
            continue;
        }
        let value = t
            .split('=')
            .nth(1)
            .and_then(|v| v.trim().trim_end_matches(',').trim().parse::<i64>().ok());
        if let Some(v) = value {
            return Some((start, at, v));
        }
    }
    None
}

/// Every entry in an order list, as declared name to order value.
///
/// Used to read a pack's *own* ZK_order.lua. The file itself is never
/// installed - it carries the player's whole widget selection and their
/// keybinds live beside it - but the entries for widgets the pack actually
/// ships are the pack saying which of its own parts should be on, and
/// dropping that leaves it installed with the wrong selection.
pub fn order_entries(text: &str) -> BTreeMap<String, i64> {
    let mut out = BTreeMap::new();
    for line in text.lines() {
        let t = line.trim().trim_end_matches(',');
        let Some((key, value)) = t.split_once('=') else {
            continue;
        };
        let Ok(v) = value.trim().parse::<i64>() else {
            continue;
        };
        let key = key.trim();
        // Both forms table.save writes, plus the bookkeeping keys it adds.
        let name = if let Some(inner) = key.strip_prefix('[').and_then(|k| k.strip_suffix(']')) {
            inner.trim().trim_matches('"').to_string()
        } else {
            key.to_string()
        };
        if name.is_empty() || name == "version" || name == "lastWidgetDetailLevel" {
            continue;
        }
        out.insert(name, v);
    }
    out
}

/// The order value recorded for a widget, if any.
pub fn order_of(text: &str, name: &str) -> Option<i64> {
    order_entry(text, name).map(|(_, _, v)| v)
}

/// Set a widget's order entry, editing in place and leaving the rest byte for
/// byte as it was. Zero-K rewrites this file itself at every start and on
/// shutdown, so the less of it we touch the better.
pub fn set_order(text: &str, name: &str, value: i64) -> Result<String, String> {
    if let Some((start, end, _)) = order_entry(text, name) {
        let line = &text[start..end];
        let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
        let nl = if line.ends_with("\r\n") {
            "\r\n"
        } else if line.ends_with('\n') {
            "\n"
        } else {
            ""
        };
        let replacement = format!("{indent}{} = {value},{nl}", lua_key(name));
        return Ok(format!("{}{}{}", &text[..start], replacement, &text[end..]));
    }
    // New entry, inserted before the closing brace of the returned table.
    let close = text
        .rfind('}')
        .ok_or_else(|| "ZK_order.lua has no closing brace".to_string())?;
    let entry = format!("\t{} = {value},\n", lua_key(name));
    Ok(format!("{}{}{}", &text[..close], entry, &text[close..]))
}

/// A `ZK_order.lua` for an install that has never written one.
pub fn empty_order() -> String {
    "-- Widget Order List  (0 disables a widget)\nreturn {\n}\n".to_string()
}

// ------------------------------------------------------- ZK_data.lua edit ---

/// Whether raw widgets load at all.
///
/// The presence of the table is the setting - see the module header. The stored
/// booleans are dead, so they are deliberately not consulted.
pub fn local_widgets_on(zk_data: &str) -> bool {
    let clean = strip_comments(zk_data);
    clean.contains(&format!("[{:?}]", LOCAL_WIDGETS_KEY))
        || clean.contains(&format!("[{}]", LOCAL_WIDGETS_KEY))
}

/// Add the table if it is absent, so an installed widget actually loads.
///
/// Both flags are written true even though the values are ignored, because a
/// human reading the file should see what the game is going to do.
pub fn enable_local_widgets(zk_data: &str) -> Result<String, String> {
    if local_widgets_on(zk_data) {
        return Ok(zk_data.to_string());
    }
    let close = zk_data
        .rfind('}')
        .ok_or_else(|| "ZK_data.lua has no closing brace".to_string())?;
    let block = format!(
        "\t[{:?}] = {{\n\t\tuseLocalWidgets = true,\n\t\tuseLocalWidgetsFirst = true,\n\t}},\n",
        LOCAL_WIDGETS_KEY
    );
    Ok(format!(
        "{}{}{}",
        &zk_data[..close],
        block,
        &zk_data[close..]
    ))
}

/// A `ZK_data.lua` for an install that has never written one.
pub fn empty_data() -> String {
    "-- Widget Custom Data\nreturn {\n}\n".to_string()
}

// ------------------------------------------------------------ plan / paths ---

/// How an add-on's files are laid down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Namespaced, so nothing can take the place of a packaged widget. The
    /// default, and the right answer for a pack of single-purpose widgets.
    Namespaced,
    /// Original paths, which under RAW_FIRST means packaged widgets of the
    /// same name are replaced. This is what a UI replacement pack needs in
    /// order to work at all, and it is never chosen on a player's behalf.
    ///
    /// Reversible: the packaged widget is never touched. It stays in the game
    /// archive, and removing our raw file is enough to bring it back.
    Replace,
}

impl Default for Mode {
    fn default() -> Self {
        Self::Namespaced
    }
}

/// What may be copied into the install.
///
/// Not only `.lua`. A real pack carries the shaders and pictures its widgets
/// load - New-Hel-K ships twelve `.glsl` files and three `.jpg` - and a rule
/// that took Lua alone would install widgets whose assets were missing.
const ASSETS: &[&str] = &[
    "lua", "glsl", "vert", "frag", "comp", "png", "jpg", "jpeg", "tga", "dds",
];

/// Repository furniture. Present in every real pack, part of none of them.
fn is_furniture(rel: &str) -> bool {
    let base = rel.rsplit('/').next().unwrap_or(rel).to_ascii_lowercase();
    base.starts_with('.')
        || matches!(
            base.as_str(),
            "readme.md" | "readme" | "license" | "license.md" | "license.txt"
        )
        || base.ends_with(".sh")
        || base.ends_with(".bat")
        || base.ends_with(".ps1")
        || base.ends_with(".backup")
}

/// Where the archive's `LuaUI` directory begins.
///
/// Four layouts occur in the wild and the installer has to read all of them:
///
/// - `LuaUI/Widgets/x.lua` - the archive contains a LuaUI directory
/// - `Widgets/x.lua`       - the repository root *is* LuaUI, which is what
///                           New-Hel-K's README says to copy into it
/// - `x.lua` at the root   - a single widget, published bare
/// - `x.lua` plus `lib/`   - a few widgets with their own support directories
#[derive(Debug, Clone, PartialEq)]
pub struct Layout {
    /// Stripped from the front of every path.
    pub strip: String,
    /// True when what remains is already relative to `LuaUI`, false when the
    /// files are loose widgets that belong in `Widgets/`.
    pub under_luaui: bool,
}

pub fn detect_layout<'a>(paths: impl Iterator<Item = &'a str>) -> Layout {
    let mut luaui: Option<String> = None;
    let mut widgets = false;
    for p in paths {
        let p = p.replace('\\', "/");
        if let Some(at) = p.find("LuaUI/") {
            // Keep the shallowest, so a stray nested LuaUI cannot win.
            let prefix = p[..at + "LuaUI/".len()].to_string();
            if luaui.as_ref().map(|c| prefix.len() < c.len()).unwrap_or(true) {
                luaui = Some(prefix);
            }
        } else if p.starts_with("Widgets/") {
            widgets = true;
        }
    }
    if let Some(strip) = luaui {
        return Layout { strip, under_luaui: true };
    }
    if widgets {
        return Layout { strip: String::new(), under_luaui: true };
    }
    Layout { strip: String::new(), under_luaui: false }
}

/// An archive path as a path relative to the install's `LuaUI` directory.
pub fn to_luaui(path: &str, layout: &Layout) -> Option<String> {
    let p = path.replace('\\', "/");
    let rest = if layout.strip.is_empty() {
        p.clone()
    } else {
        p.strip_prefix(layout.strip.as_str())?.to_string()
    };
    if rest.is_empty() {
        return None;
    }
    if layout.under_luaui {
        Some(rest)
    } else {
        // Loose widgets, and whatever they keep beside them.
        Some(format!("Widgets/{rest}"))
    }
}

/// Whether a file is a library rather than a widget.
///
/// Zero-K ships these itself - `COFCtools/Interpolate.lua` and
/// `Include/DrawPrimitiveAtUnit.lua` are both in the stock list - so a pack
/// that carries one is normal. They declare no `GetInfo`, get no order entry,
/// and simply sit there for a widget to include.
pub fn is_library(body: &str) -> bool {
    parse_get_info(body).is_none()
}

/// What should happen to one file.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    /// Copied into the install.
    Install,
    /// Left alone. Repository furniture and anything that is not add-on
    /// content: quietly ignored, because refusing a pack over its README
    /// would refuse every pack there is.
    Skip(String),
    /// Blocks the whole add-on.
    Refuse(String),
}

/// What to do with one file, by its path relative to `LuaUI`.
pub fn classify(luaui_rel: &str, body: &[u8], mode: Mode) -> Verdict {
    let rel = luaui_rel.replace('\\', "/");
    let base = rel.rsplit('/').next().unwrap_or(&rel).to_string();

    if rel.contains("../") || rel.starts_with('/') || rel.contains(':') {
        return Verdict::Refuse(format!("{base}: the archive tried to escape its directory"));
    }
    // The config files carry the player's own settings and their keybinds. A
    // pack shipping them means to replace both wholesale, which is never
    // something an install should do on somebody's behalf. True in either mode.
    if rel.starts_with("Config/") || rel.starts_with("Configs/") {
        return Verdict::Refuse(format!(
            "{base}: add-ons may not replace your widget settings or keybinds"
        ));
    }
    if is_furniture(&rel) {
        return Verdict::Skip(format!("{base}: part of the repository, not the add-on"));
    }
    let ext = base.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if !ASSETS.contains(&ext.as_str()) {
        return Verdict::Skip(format!("{base}: not a widget or an asset"));
    }
    if mode == Mode::Replace {
        // Replace lays files down exactly as the pack has them.
        return Verdict::Install;
    }
    // Namespaced mode renames, and renaming breaks four things.
    let Some(under) = rel.strip_prefix("Widgets/") else {
        return Verdict::Refuse(format!(
            "{base}: sits outside Widgets, which only a replacing install can keep"
        ));
    };
    if under.contains('/') {
        return Verdict::Refuse(format!(
            "{base}: sits in a subdirectory, which only a replacing install can keep"
        ));
    }
    if ext != "lua" {
        return Verdict::Refuse(format!(
            "{base}: an asset loaded by path, which only a replacing install can keep"
        ));
    }
    if is_library(&String::from_utf8_lossy(body)) {
        return Verdict::Refuse(format!(
            "{base}: a library rather than a widget, and renaming it would break whatever includes it"
        ));
    }
    if is_stock(under) {
        return Verdict::Refuse(format!("{base}: Zero-K ships a widget by this name"));
    }
    Verdict::Install
}

/// Where a file lands in the install, relative to `LuaUI`.
pub fn installed_name(addon: &str, luaui_rel: &str, mode: Mode) -> String {
    match mode {
        // Flat under Widgets by construction: namespaced mode refuses the rest.
        Mode::Namespaced => {
            let base = luaui_rel.rsplit('/').next().unwrap_or(luaui_rel);
            format!("Widgets/{PREFIX}{addon}_{base}")
        }
        // The whole point of this mode is that the path is the original one.
        Mode::Replace => luaui_rel.to_string(),
    }
}

/// Whether a file in the install is one of ours.
pub fn ours(file: &str) -> bool {
    file.rsplit('/').next().unwrap_or(file).starts_with(PREFIX)
}

fn zk_path(root: &Path, rel: &str) -> PathBuf {
    let mut p = root.to_path_buf();
    for part in rel.split('/') {
        p.push(part);
    }
    p
}

fn read_or(root: &Path, rel: &str, fallback: fn() -> String) -> Result<String, String> {
    let path = zk_path(root, rel);
    match std::fs::read_to_string(&path) {
        Ok(t) => Ok(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(fallback()),
        Err(e) => Err(format!("could not read {}: {e}", path.display())),
    }
}

/// Write a config file, keeping a `.bak` the way Zero-K's own
/// `CheckLUAFileAndBackup` does.
fn write_config(root: &Path, rel: &str, text: &str) -> Result<(), String> {
    let path = zk_path(root, rel);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }
    if path.exists() {
        let bak = path.with_extension("lua.bak");
        std::fs::copy(&path, &bak)
            .map_err(|e| format!("could not back up {}: {e}", path.display()))?;
    }
    std::fs::write(&path, text).map_err(|e| format!("could not write {}: {e}", path.display()))
}

// -------------------------------------------------------------- commands ----

/// Everything in the install's widget directory, ours and the player's own.
#[tauri::command]
pub fn zks_widgets_list(install_root: Option<String>) -> Result<Vec<InstalledWidget>, String> {
    let found = install::detect_with(install_root.as_deref())?;
    let dir = zk_path(&found.root, WIDGET_DIR);
    let order = read_or(&found.root, ORDER_FILE, empty_order)?;

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        // Never launched with local widgets, so there is nothing to list.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("could not read {}: {e}", dir.display())),
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let file = entry.file_name().to_string_lossy().into_owned();
        if !file.to_ascii_lowercase().ends_with(".lua") {
            continue;
        }
        let body = match std::fs::read_to_string(entry.path()) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let Some(info) = parse_get_info(&body) else {
            continue;
        };
        // cawidgets.lua:732 - a recorded order wins, otherwise the widget's own
        // default decides, and alwaysStart overrides both.
        let enabled = match order_of(&order, &info.name) {
            Some(v) => v > 0,
            None => info.enabled,
        } || info.always_start;
        out.push(InstalledWidget {
            ours: ours(&file),
            file,
            name: info.name,
            enabled,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Where downloaded widget add-ons are unpacked, one directory each.
fn addons_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    let dir = base.join("widgets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not make {}: {e}", dir.display()))?;
    Ok(dir)
}

/// One add-on's directory. The id is checked rather than trusted: it reaches
/// this from the page, and a `..` in it would walk out of the app data dir.
fn addon_dir(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("{id} is not a usable add-on id"));
    }
    Ok(addons_dir(app)?.join(id))
}

/// Every file under an unpacked add-on, as archive-relative path to bytes.
///
/// Bytes rather than text: a pack carries shaders and pictures beside its Lua,
/// and reading those as UTF-8 would either mangle them or drop them.
fn read_addon(dir: &Path) -> Result<BTreeMap<String, Vec<u8>>, String> {
    fn walk(base: &Path, at: &Path, out: &mut BTreeMap<String, Vec<u8>>) -> Result<(), String> {
        let entries = match std::fs::read_dir(at) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(format!("could not read {}: {e}", at.display())),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(base, &path, out)?;
                continue;
            }
            let rel = path
                .strip_prefix(base)
                .map_err(|_| "a file escaped the add-on directory".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if let Ok(bytes) = std::fs::read(&path) {
                out.insert(rel, bytes);
            }
        }
        Ok(())
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out)?;
    Ok(out)
}

/// One file of an add-on, resolved to where it would land.
#[derive(Debug, Clone)]
pub struct Planned {
    /// Path relative to the install's `LuaUI`.
    pub target: String,
    pub body: Vec<u8>,
}

/// What installing an add-on would write, or why it may not be installed.
///
/// The whole add-on is refused rather than the acceptable half of it: a pack
/// silently missing a file it expected is a harder thing to diagnose than one
/// that plainly did not install.
pub fn plan_install(
    addon: &str,
    files: &BTreeMap<String, Vec<u8>>,
    mode: Mode,
) -> Result<Vec<Planned>, String> {
    if addon.is_empty() || !addon.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("{addon} is not a usable add-on id"));
    }
    let layout = detect_layout(files.keys().map(String::as_str));
    let mut out = Vec::new();
    let mut refused = Vec::new();
    for (path, body) in files {
        let Some(rel) = to_luaui(path, &layout) else {
            continue;
        };
        match classify(&rel, body, mode) {
            Verdict::Install => out.push(Planned {
                target: installed_name(addon, &rel, mode),
                body: body.clone(),
            }),
            Verdict::Skip(_) => {}
            Verdict::Refuse(why) => refused.push(why),
        }
    }
    if !refused.is_empty() {
        return Err(refused.join("; "));
    }
    if out.is_empty() {
        return Err(format!("{addon} contains no widgets"));
    }
    Ok(out)
}

/// Which of an add-on's files would take the place of a packaged widget.
///
/// Read before installing, so the number can be put in front of somebody
/// rather than discovered afterwards.
pub fn would_replace(files: &BTreeMap<String, Vec<u8>>) -> Vec<String> {
    let layout = detect_layout(files.keys().map(String::as_str));
    let mut out: Vec<String> = files
        .keys()
        .filter_map(|p| to_luaui(p, &layout))
        .filter_map(|rel| {
            let under = rel.strip_prefix("Widgets/")?.to_string();
            is_stock(&under).then_some(under)
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// The widgets an add-on declares, by the name Zero-K keys its order list on.
fn declared_widgets(files: &BTreeMap<String, Vec<u8>>) -> BTreeMap<String, WidgetInfo> {
    let layout = detect_layout(files.keys().map(String::as_str));
    files
        .iter()
        .filter(|(p, _)| {
            to_luaui(p, &layout)
                .map(|r| r.starts_with("Widgets/") && r.ends_with(".lua"))
                .unwrap_or(false)
        })
        .filter_map(|(_, body)| {
            parse_get_info(&String::from_utf8_lossy(body)).map(|i| (i.name.clone(), i))
        })
        .collect()
}

/// What fetching a repository found, before anything is installed.
///
/// Every number here is read off the add-on that was actually downloaded, not
/// off its description, so the count of replaced widgets is the real one.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddonPreview {
    pub id: String,
    pub repo: String,
    pub build: Build,
    /// How many files it would actually install. Not how many the repository
    /// holds - a README and an update script are not part of the add-on.
    pub files: usize,
    /// The names of packaged Zero-K widgets it would replace, if installed in
    /// replace mode. Empty means it adds only new widgets.
    pub replaces: Vec<String>,
    /// Why it cannot be installed at all, in either mode.
    pub refused: Vec<String>,
}

impl AddonPreview {
    /// Whether the safe mode is enough, which is the common case and the one
    /// that needs no decision from anybody.
    pub fn installs_safely(&self) -> bool {
        self.refused.is_empty() && self.replaces.is_empty()
    }
}

/// A directory name for a repository. `Helwor/New-Hel-K` becomes `new-hel-k`.
pub fn id_for(repo: &Repo) -> String {
    let mut out = String::new();
    for c in repo.name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "addon".to_string()
    } else {
        trimmed
    }
}

/// Look at a repository and report what installing it would do.
///
/// Downloads and unpacks, because the only honest way to say what a pack
/// contains is to read it. Nothing reaches the Zero-K install here.
#[tauri::command]
pub fn zks_widget_fetch(app: tauri::AppHandle, repo: String) -> Result<AddonPreview, String> {
    let parsed = gitsource::parse_repo(&repo)?;
    let build = gitsource::resolve(&parsed)?;
    let id = id_for(&parsed);
    let dir = addon_dir(&app, &id)?;

    // A fresh tree each time, so a file dropped upstream does not linger.
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not make {}: {e}", dir.display()))?;

    let bytes = gitsource::download(&parsed, &build.sha)?;
    gitsource::unpack_tree(&bytes, &dir)?;

    let files = read_addon(&dir)?;
    let replaces = would_replace(&files);
    let layout = detect_layout(files.keys().map(String::as_str));
    let verdicts: Vec<Verdict> = files
        .iter()
        .filter_map(|(path, body)| {
            to_luaui(path, &layout).map(|rel| classify(&rel, body, Mode::Replace))
        })
        .collect();
    // What is wrong with it even allowing replacement: config files, and
    // anything that tried to escape the directory.
    let refused: Vec<String> = verdicts
        .iter()
        .filter_map(|v| match v {
            Verdict::Refuse(why) => Some(why.clone()),
            _ => None,
        })
        .collect();
    // Files it would install, not blobs it contains: a README is not part of
    // the add-on, and counting it would overstate the pack.
    let installable = verdicts.iter().filter(|v| **v == Verdict::Install).count();

    Ok(AddonPreview {
        id,
        repo: parsed.slug(),
        build,
        files: installable,
        replaces,
        refused,
    })
}

/// What was already fetched, without going back to the network.
#[tauri::command]
pub fn zks_widget_preview(app: tauri::AppHandle, addon: String) -> Result<usize, String> {
    Ok(read_addon(&addon_dir(&app, &addon)?)?.len())
}

/// What an add-on actually wrote into the game, so removal can take exactly
/// that and nothing else.
///
/// The `shiro_` prefix is enough to identify a namespaced install, but a
/// Replace install writes original filenames on purpose - and guessing at
/// those from the add-on's current contents would delete a file the player
/// installed themselves if the pack changed between install and removal.
const MANIFEST: &str = "installed.json";

fn read_manifest(dir: &Path) -> Vec<String> {
    std::fs::read_to_string(dir.join(MANIFEST))
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
}

fn write_manifest(dir: &Path, names: &[String]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(names)
        .map_err(|e| format!("could not record what was installed: {e}"))?;
    std::fs::write(dir.join(MANIFEST), text)
        .map_err(|e| format!("could not record what was installed: {e}"))
}

/// Copy an add-on's widget files into the install and make them loadable.
///
/// Rust reads the add-on's own directory rather than taking file bodies from
/// the page. `docs/PLUGINS.md` §10.4 is explicit that the frontend must not
/// drive what gets written into the game install, and handing over the contents
/// is the same hole as handing over the paths.
#[tauri::command]
pub fn zks_widget_install(
    app: tauri::AppHandle,
    addon: String,
    mode: Option<Mode>,
    install_root: Option<String>,
) -> Result<Vec<String>, String> {
    let mode = mode.unwrap_or_default();
    let source = addon_dir(&app, &addon)?;
    let files = read_addon(&source)?;
    let planned = plan_install(&addon, &files, mode)?;

    let found = install::detect_with(install_root.as_deref())?;
    let luaui = zk_path(&found.root, LUAUI_DIR);
    std::fs::create_dir_all(&luaui).map_err(|e| {
        format!(
            "could not create {} - a Zero-K install outside Steam is often read-only: {e}",
            luaui.display()
        )
    })?;

    let mut written = Vec::new();
    for p in &planned {
        let target = zk_path(&luaui, &p.target);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        std::fs::write(&target, &p.body)
            .map_err(|e| format!("could not write {}: {e}", target.display()))?;
        written.push(p.target.clone());
    }
    write_manifest(&source, &written)?;

    // Raw widgets have to be switched on at all, or none of the above loads.
    let data = read_or(&found.root, DATA_FILE, empty_data)?;
    let next = enable_local_widgets(&data)?;
    if next != data {
        write_config(&found.root, DATA_FILE, &next)?;
    }

    // What the pack says about its own widgets, if it shipped an order list.
    // Only names it actually ships are taken, so a pack cannot switch off a
    // widget the player installed themselves.
    let mine = declared_widgets(&files);
    let wanted: BTreeMap<String, i64> = files
        .iter()
        .find(|(p, _)| p.ends_with("ZK_order.lua"))
        .map(|(_, body)| order_entries(&String::from_utf8_lossy(body)))
        .unwrap_or_default()
        .into_iter()
        .filter(|(name, _)| mine.contains_key(name))
        .collect();

    let mut order = read_or(&found.root, ORDER_FILE, empty_order)?;
    let mut touched = false;
    for (name, info) in &mine {
        let recorded = order_of(&order, name);
        // The pack's own choice wins where it made one.
        if let Some(&v) = wanted.get(name) {
            if recorded != Some(v) {
                order = set_order(&order, name, v)?;
                touched = true;
            }
            continue;
        }
        // Otherwise only widgets that would not load on their own need saying.
        if (!info.enabled && recorded.is_none()) || recorded == Some(0) {
            order = set_order(&order, name, BACK_OF_THE_PACK)?;
            touched = true;
        }
    }
    if touched {
        write_config(&found.root, ORDER_FILE, &order)?;
    }

    Ok(written)
}

/// Take an add-on's widgets back out. Only ever removes files we installed.
#[tauri::command]
pub fn zks_widget_remove(
    app: tauri::AppHandle,
    addon: String,
    install_root: Option<String>,
) -> Result<Vec<String>, String> {
    let found = install::detect_with(install_root.as_deref())?;
    let luaui = zk_path(&found.root, LUAUI_DIR);
    let dir = zk_path(&found.root, WIDGET_DIR);
    let source = addon_dir(&app, &addon)?;

    // What we recorded writing. An install from before manifests existed, or
    // one whose record was lost, still has the namespaced prefix to go on.
    let mut names = read_manifest(&source);
    if names.is_empty() {
        let want = format!("{PREFIX}{addon}_");
        if let Ok(entries) = std::fs::read_dir(&dir) {
            names = entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|f| f.starts_with(&want))
                .map(|f| format!("Widgets/{f}"))
                .collect();
        }
    }

    let mut removed = Vec::new();
    for file in names {
        let path = zk_path(&luaui, &file);
        if !path.is_file() {
            continue;
        }
        std::fs::remove_file(&path).map_err(|e| format!("could not remove {file}: {e}"))?;
        removed.push(file);
    }
    // The unpacked copy goes too, so a reinstall fetches rather than resurrects.
    if let Ok(dir) = addon_dir(&app, &addon) {
        std::fs::remove_dir_all(&dir).ok();
    }
    Ok(removed)
}

/// Turn one widget on or off, by the name it declares.
#[tauri::command]
pub fn zks_widget_set_enabled(
    name: String,
    enabled: bool,
    install_root: Option<String>,
) -> Result<(), String> {
    let found = install::detect_with(install_root.as_deref())?;
    let order = read_or(&found.root, ORDER_FILE, empty_order)?;
    let next = set_order(&order, &name, if enabled { BACK_OF_THE_PACK } else { 0 })?;
    write_config(&found.root, ORDER_FILE, &next)
}

/// Whether raw widgets load, so the screen can offer the switch.
#[tauri::command]
pub fn zks_widgets_local_enabled(install_root: Option<String>) -> Result<bool, String> {
    let found = install::detect_with(install_root.as_deref())?;
    let data = read_or(&found.root, DATA_FILE, empty_data)?;
    Ok(local_widgets_on(&data))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
function widget:GetInfo()
	return {
		name      = "Transport AI",
		desc      = "Automates transports",
		author    = "someone",
		layer     = 0,
		enabled   = true,
	}
end
"#;

    #[test]
    fn a_widget_declares_the_name_the_order_list_keys_on() {
        let info = parse_get_info(SAMPLE).unwrap();
        assert_eq!(info.name, "Transport AI");
        assert!(info.enabled);
        assert!(!info.always_start);
    }

    /// `name` must not also match `basename`, which every Zero-K widget has.
    #[test]
    fn a_field_is_matched_as_a_whole_word() {
        let lua = r#"
function widget:GetInfo()
	return { basename = "wrong.lua", name = "Right", enabled = false }
end
"#;
        let info = parse_get_info(lua).unwrap();
        assert_eq!(info.name, "Right");
        assert!(!info.enabled);
    }

    /// A commented-out widget is a real thing in the wild, and reading its
    /// fields as live would enable something the author had switched off.
    #[test]
    fn commented_out_fields_are_not_read() {
        let lua = r#"
function widget:GetInfo()
	return {
		name = "Real",
		-- enabled = true,
		enabled = false,
	}
end
"#;
        assert!(!parse_get_info(lua).unwrap().enabled);
    }

    #[test]
    fn a_double_dash_inside_a_string_is_not_a_comment() {
        let lua = r#"
function widget:GetInfo()
	return { desc = "uses -- dashes", name = "Kept", enabled = true }
end
"#;
        let info = parse_get_info(lua).unwrap();
        assert_eq!(info.name, "Kept");
        assert!(info.enabled);
    }

    /// Library files call `widget:GetInfo().name` on other widgets. Anchoring
    /// on the first mention parsed whichever table followed the call site.
    #[test]
    fn a_call_site_is_not_mistaken_for_the_definition() {
        let lua = r#"
local function report()
	Echo("debug for " .. widget:GetInfo().name)
	local opts = { name = "WRONG" }
end

function widget:GetInfo()
	return { name = "Right One", enabled = true }
end
"#;
        assert_eq!(parse_get_info(lua).unwrap().name, "Right One");
    }

    /// A library that only ever calls GetInfo defines no widget, so it must
    /// not parse as one.
    #[test]
    fn a_library_that_only_calls_get_info_is_not_a_widget() {
        let lua = r#"
local function nice(w)
	return w.GetInfo and w:GetInfo().name or w.basename
end
local defaults = { name = "not a widget" }
"#;
        assert!(parse_get_info(lua).is_none());
    }

    #[test]
    fn a_file_without_a_readable_name_is_not_installable() {
        assert!(parse_get_info("function widget:GetInfo() return {} end").is_none());
        assert!(parse_get_info("-- not a widget at all").is_none());
    }

    // ------------------------------------------------------------ order ----

    const ORDER: &str = "-- Widget Order List  (0 disables a widget)\nreturn {\n\t[\"API Unit Tracker GL4\"] = 0,\n\tAdvPlayersList = 0,\n\tAllyCursors = 37,\n}\n";

    #[test]
    fn both_key_forms_spring_writes_are_read() {
        assert_eq!(order_of(ORDER, "AllyCursors"), Some(37));
        assert_eq!(order_of(ORDER, "API Unit Tracker GL4"), Some(0));
        assert_eq!(order_of(ORDER, "Nothing Like This"), None);
    }

    #[test]
    fn a_name_is_written_back_in_the_form_spring_uses() {
        assert_eq!(lua_key("AllyCursors"), "AllyCursors");
        assert_eq!(lua_key("Alert Callouts"), "[\"Alert Callouts\"]");
        assert_eq!(lua_key("*Apophis Intro Music*"), "[\"*Apophis Intro Music*\"]");
    }

    /// Zero-K rewrites this file at every start and on shutdown, so an edit
    /// that reformatted it would fight the game. Only the one line may move.
    #[test]
    fn setting_an_order_leaves_every_other_byte_alone() {
        let next = set_order(ORDER, "AllyCursors", 0).unwrap();
        assert!(next.contains("AllyCursors = 0,"));
        assert!(next.contains("[\"API Unit Tracker GL4\"] = 0,"));
        assert!(next.contains("AdvPlayersList = 0,"));
        assert!(next.starts_with("-- Widget Order List"));
        assert_eq!(next.lines().count(), ORDER.lines().count());
    }

    #[test]
    fn a_widget_with_no_entry_yet_gets_one_inside_the_table() {
        let next = set_order(ORDER, "Brand New", 12345).unwrap();
        assert!(next.contains("[\"Brand New\"] = 12345,"));
        let body = next.split_once('{').unwrap().1;
        assert!(body.find("Brand New").unwrap() < body.rfind('}').unwrap());
        assert_eq!(order_of(&next, "Brand New"), Some(12345));
    }

    #[test]
    fn enabling_then_disabling_round_trips() {
        let on = set_order(ORDER, "AdvPlayersList", 12345).unwrap();
        assert_eq!(order_of(&on, "AdvPlayersList"), Some(12345));
        let off = set_order(&on, "AdvPlayersList", 0).unwrap();
        assert_eq!(order_of(&off, "AdvPlayersList"), Some(0));
    }

    // ------------------------------------------------------- local widgets --

    /// The stored booleans are dead - `false or true` is true - so the table
    /// being there at all is what the reader must key on.
    #[test]
    fn the_table_being_present_is_the_setting() {
        let off = "return {\n\t[\"Chili\"] = {},\n}\n";
        assert!(!local_widgets_on(off));

        let stored_false = "return {\n\t[\"Local Widgets Config\"] = {\n\t\tuseLocalWidgets = false,\n\t},\n}\n";
        assert!(
            local_widgets_on(stored_false),
            "false is still on, because cawidgets.lua reads `x or true`"
        );
    }

    #[test]
    fn enabling_adds_the_table_once_and_only_once() {
        let data = "-- Widget Custom Data\nreturn {\n\t[\"Chili\"] = {},\n}\n";
        let once = enable_local_widgets(data).unwrap();
        assert!(local_widgets_on(&once));
        assert!(once.contains("[\"Chili\"] = {},"), "kept what was there");
        let twice = enable_local_widgets(&once).unwrap();
        assert_eq!(once, twice);
    }

    // -------------------------------------------------------------- refuse --

    fn ok_widget(name: &str) -> String {
        format!("function widget:GetInfo() return {{ name = {name:?}, enabled = true }} end")
    }

    fn addon_of(pairs: &[(&str, String)]) -> BTreeMap<String, Vec<u8>> {
        pairs
            .iter()
            .map(|(p, b)| (p.to_string(), b.clone().into_bytes()))
            .collect()
    }

    fn installs(rel: &str, body: &str, mode: Mode) -> bool {
        classify(rel, body.as_bytes(), mode) == Verdict::Install
    }

    fn why(rel: &str, body: &str, mode: Mode) -> String {
        match classify(rel, body.as_bytes(), mode) {
            Verdict::Refuse(w) => w,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    // ------------------------------------------------------------ layout ----

    /// Four layouts occur in the wild. New-Hel-K puts Widgets at the
    /// repository root because its README says to copy the repository into
    /// LuaUI; other packs carry the LuaUI directory itself; several
    /// single-widget repositories publish one bare .lua file.
    #[test]
    fn every_layout_in_the_wild_resolves_to_the_same_place() {
        let cases: [(&[&str], &str, &str); 4] = [
            (&["LuaUI/Widgets/x.lua"], "LuaUI/Widgets/x.lua", "Widgets/x.lua"),
            (&["Widgets/x.lua", "README.md"], "Widgets/x.lua", "Widgets/x.lua"),
            (&["x.lua"], "x.lua", "Widgets/x.lua"),
            (
                &["x.lua", "lib/helper.lua"],
                "lib/helper.lua",
                "Widgets/lib/helper.lua",
            ),
        ];
        for (paths, probe, want) in cases {
            let layout = detect_layout(paths.iter().copied());
            assert_eq!(
                to_luaui(probe, &layout).as_deref(),
                Some(want),
                "layout {layout:?} for {paths:?}"
            );
        }
    }

    /// A nested LuaUI must not beat the real one.
    #[test]
    fn the_shallowest_luaui_wins() {
        let layout = detect_layout(
            ["repo/LuaUI/Widgets/a.lua", "repo/LuaUI/Widgets/old/LuaUI/b.lua"].into_iter(),
        );
        assert_eq!(layout.strip, "repo/LuaUI/");
    }

    // ---------------------------------------------------------- classify ----

    #[test]
    fn a_plain_widget_is_accepted() {
        assert!(installs("Widgets/my_thing.lua", &ok_widget("My Thing"), Mode::Namespaced));
    }

    /// Zero-K ships twenty-two files called `skin.lua`, one per Chili skin.
    /// Matching stock by basename reported every one of them as a collision,
    /// so a new game UI skin looked like it replaced a packaged widget when it
    /// replaces nothing. What collides is the full path: `cawidgets.lua:496`
    /// dedups the VFS listing on the whole path, not the filename.
    #[test]
    fn a_new_chili_skin_replaces_nothing() {
        assert!(
            is_stock("chili/Skins/Evolved/skin.lua"),
            "the packaged skin is stock"
        );
        assert!(
            !is_stock("chili/Skins/Shiro/skin.lua"),
            "a new skin shares only a filename with it"
        );

        let files = addon_of(&[
            ("Widgets/chili/Skins/Shiro/skin.lua", "return {}".to_string()),
            ("Widgets/chili_old/Skins/Shiro/skin.lua", "return {}".to_string()),
        ]);
        assert!(
            would_replace(&files).is_empty(),
            "a new skin replaces nothing: {:?}",
            would_replace(&files)
        );
    }

    /// And a skin that really does overwrite a packaged one still says so.
    #[test]
    fn overwriting_a_packaged_skin_is_still_reported() {
        let files = addon_of(&[(
            "Widgets/chili/Skins/Evolved/skin.lua",
            "return {}".to_string(),
        )]);
        assert_eq!(would_replace(&files), vec!["chili/Skins/Evolved/skin.lua"]);
    }

    /// The one that matters. RAW_FIRST means a raw file replaces the packaged
    /// widget of the same name, and the safe mode must never do that.
    #[test]
    fn a_file_named_after_a_stock_widget_is_refused() {
        for stock in ["unit_healthbars.lua", "api_chili.lua", "gui_epicmenu.lua"] {
            let w = why(&format!("Widgets/{stock}"), &ok_widget("X"), Mode::Namespaced);
            assert!(w.contains("Zero-K ships"), "{w}");
        }
    }

    #[test]
    fn an_addon_may_not_replace_the_players_settings_or_keybinds() {
        for path in ["Config/ZK_data.lua", "Config/ZK_order.lua", "Configs/zk_keys.lua"] {
            for mode in [Mode::Namespaced, Mode::Replace] {
                let w = why(path, "return {}", mode);
                assert!(w.contains("settings or keybinds"), "{w}");
            }
        }
    }

    #[test]
    fn nothing_escapes_the_widget_directory() {
        for path in ["../evil.lua", "/etc/evil.lua", "C:/evil.lua"] {
            for mode in [Mode::Namespaced, Mode::Replace] {
                assert!(
                    matches!(classify(path, b"x", mode), Verdict::Refuse(_)),
                    "{path} was allowed"
                );
            }
        }
    }

    /// Repository furniture is skipped, not refused. Refusing a pack over its
    /// README would refuse every pack there is.
    #[test]
    fn repository_furniture_is_skipped_rather_than_fatal() {
        for path in [
            "README.md",
            "LICENSE",
            ".gitignore",
            "Hel-K_Update.sh",
            "Hel-K_Update.bat",
            "Widgets/Shaders/default_tint.backup",
        ] {
            assert!(
                matches!(classify(path, b"x", Mode::Replace), Verdict::Skip(_)),
                "{path} was not skipped"
            );
        }
    }

    /// A pack carries the shaders and pictures its widgets load. New-Hel-K
    /// ships twelve .glsl and three .jpg, and installing the Lua without them
    /// would install widgets whose assets are missing.
    #[test]
    fn assets_a_widget_loads_come_with_it() {
        for path in [
            "Widgets/Shaders/draw_terra.frag.glsl",
            "Widgets/Drawings/goal.jpg",
        ] {
            assert!(installs(path, "binary", Mode::Replace), "{path} was dropped");
            // Namespacing renames, and these are loaded by path.
            assert!(matches!(
                classify(path, b"binary", Mode::Namespaced),
                Verdict::Refuse(_)
            ));
        }
    }

    /// Zero-K ships libraries in LuaUI/Widgets itself. Namespacing renames
    /// them, which breaks the include path of whatever needs them.
    #[test]
    fn a_library_can_only_be_installed_by_a_replacing_install() {
        let lib = "local M = {}\nreturn M";
        let w = why("Widgets/UtilsFunc.lua", lib, Mode::Namespaced);
        assert!(w.contains("library"), "{w}");
        assert!(installs("Widgets/UtilsFunc.lua", lib, Mode::Replace));
    }

    #[test]
    fn a_subdirectory_survives_a_replacing_install() {
        let p = "Widgets/COFCtools/Interpolate.lua";
        assert!(matches!(classify(p, b"local M = {}", Mode::Namespaced), Verdict::Refuse(_)));
        assert!(installs(p, "local M = {}", Mode::Replace));
        assert_eq!(
            installed_name("helk", p, Mode::Replace),
            "Widgets/COFCtools/Interpolate.lua"
        );
    }

    // -------------------------------------------------------------- plan ----

    #[test]
    fn a_clean_addon_plans_namespaced_files() {
        let files = addon_of(&[
            ("Widgets/mark_spots.lua", ok_widget("Mark Spots")),
            ("Widgets/lag_handler.lua", ok_widget("Lag Handler")),
            ("README.md", "hello".to_string()),
        ]);
        let planned = plan_install("helk", &files, Mode::Namespaced).unwrap();
        let names: Vec<&str> = planned.iter().map(|p| p.target.as_str()).collect();
        assert_eq!(names.len(), 2, "the README is not part of the add-on");
        assert!(names.contains(&"Widgets/shiro_helk_mark_spots.lua"));
        assert!(names.iter().all(|n| ours(n)));
    }

    /// One bad file stops the whole pack. A partial install leaves something
    /// that half works and looks like Shiro broke the game.
    #[test]
    fn one_refused_file_refuses_the_whole_addon() {
        let files = addon_of(&[
            ("Widgets/fine.lua", ok_widget("Fine")),
            ("Widgets/unit_healthbars.lua", ok_widget("Health Bars")),
        ]);
        let w = plan_install("helk", &files, Mode::Namespaced).unwrap_err();
        assert!(w.contains("Zero-K ships"), "{w}");
    }

    #[test]
    fn an_addon_carrying_config_files_is_refused_entirely() {
        let files = addon_of(&[
            ("Widgets/fine.lua", ok_widget("Fine")),
            ("Config/ZK_order.lua", "return {}".to_string()),
        ]);
        for mode in [Mode::Namespaced, Mode::Replace] {
            assert!(plan_install("helk", &files, mode).is_err());
        }
    }

    #[test]
    fn an_addon_id_cannot_walk_out_of_its_directory() {
        let files = addon_of(&[("Widgets/fine.lua", ok_widget("Fine"))]);
        for bad in ["..", "../evil", "a/b", ""] {
            assert!(
                plan_install(bad, &files, Mode::Namespaced).is_err(),
                "{bad} was allowed"
            );
        }
    }

    /// A pack that means to replace Zero-K's own UI cannot be namespaced: a
    /// renamed api_chili.lua does not take the place of the packaged one, it
    /// runs beside it.
    #[test]
    fn replace_mode_keeps_the_original_paths() {
        let files = addon_of(&[
            ("Widgets/api_chili.lua", ok_widget("Chili Framework")),
            ("Widgets/unit_healthbars.lua", ok_widget("Health Bars")),
        ]);
        assert!(
            plan_install("helk", &files, Mode::Namespaced).is_err(),
            "the safe mode must still refuse these"
        );
        let planned = plan_install("helk", &files, Mode::Replace).unwrap();
        let names: Vec<&str> = planned.iter().map(|p| p.target.as_str()).collect();
        assert!(names.contains(&"Widgets/api_chili.lua"));
        assert!(names.iter().all(|n| !ours(n)), "replacements are not prefixed");
    }

    /// The number that has to be put in front of somebody before they agree
    /// to a replacing install.
    #[test]
    fn what_would_be_replaced_is_countable_up_front() {
        let files = addon_of(&[
            ("Widgets/api_chili.lua", ok_widget("A")),
            ("Widgets/unit_healthbars.lua", ok_widget("B")),
            ("Widgets/my_own.lua", ok_widget("C")),
        ]);
        assert_eq!(
            would_replace(&files),
            vec!["api_chili.lua", "unit_healthbars.lua"]
        );
    }

    #[test]
    fn a_packs_own_order_list_is_read_but_not_installed() {
        let pack = "-- Widget Order List  (0 disables a widget)\nreturn {\n\t[\"version\"] = 8,\n\t[\"Ally Shapes\"] = 42,\n\tAdvPlayersList = 0,\n}\n";
        let got = order_entries(pack);
        assert_eq!(got.get("Ally Shapes"), Some(&42));
        assert_eq!(got.get("AdvPlayersList"), Some(&0));
        assert!(!got.contains_key("version"), "bookkeeping keys are not widgets");
        // And the file itself still never reaches the install.
        assert!(matches!(
            classify("Config/ZK_order.lua", pack.as_bytes(), Mode::Replace),
            Verdict::Refuse(_)
        ));
    }

    #[test]
    fn an_installed_file_says_who_owns_it() {
        let n = installed_name("helk", "Widgets/thing.lua", Mode::Namespaced);
        assert_eq!(n, "Widgets/shiro_helk_thing.lua");
        assert!(ours(&n));
        assert!(!ours("Widgets/unit_healthbars.lua"));
    }

    #[test]
    fn a_repository_name_becomes_a_directory_name() {
        let r = |o: &str, n: &str| Repo { owner: o.into(), name: n.into() };
        assert_eq!(id_for(&r("Helwor", "New-Hel-K")), "new-hel-k");
        assert_eq!(id_for(&r("a", "Zero-K.Widgets")), "zero-k-widgets");
        assert_eq!(id_for(&r("a", "___")), "addon");
    }

    // ------------------------------------------------- against the real thing --

    /// Runs the parser over a real directory of widgets, which is the only way
    /// to know it copes with what people actually write. Ignored because it
    /// needs a corpus on disk:
    ///
    ///   SHIRO_WIDGET_CORPUS=<dir> cargo test widgets:: -- --ignored --nocapture
    #[test]
    #[ignore]
    fn the_parser_survives_real_widgets() {
        let dir = std::env::var("SHIRO_WIDGET_CORPUS")
            .expect("set SHIRO_WIDGET_CORPUS to a directory of .lua widgets");
        let mut ok = 0;
        let mut failed = Vec::new();
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("lua") {
                continue;
            }
            let Ok(body) = std::fs::read_to_string(&path) else {
                continue;
            };
            match parse_get_info(&body) {
                Some(info) => {
                    assert!(!info.name.trim().is_empty());
                    ok += 1;
                }
                None => failed.push(entry.file_name().to_string_lossy().into_owned()),
            }
        }
        println!("parsed {ok}, no readable name in {}", failed.len());
        for f in &failed {
            println!("    {f}");
        }
        assert!(ok > 0, "corpus had no widgets in it");
    }

    /// The whole pipeline against a real repository: resolve, download, unpack,
    /// detect the layout, and report what installing would do in each mode.
    ///
    /// Ignored because it needs the network. It is the only check that the
    /// resolver, the zipball layout and the layout detector match reality, and
    /// the four layouts in the wild mean a fixed assumption would be wrong for
    /// three of them.
    ///
    ///   SHIRO_ADDON_REPO=Helwor/New-Hel-K cargo test widgets:: -- --ignored --nocapture
    #[test]
    #[ignore]
    fn fetching_a_real_pack_reports_what_it_would_do() {
        let slug =
            std::env::var("SHIRO_ADDON_REPO").unwrap_or_else(|_| "Helwor/New-Hel-K".to_string());
        let repo = gitsource::parse_repo(&slug).unwrap();
        let build = gitsource::resolve(&repo).expect("resolve");
        println!("repo:  {}", repo.slug());
        println!("build: {} {} ({})", build.kind, build.label, build.short());

        let bytes = gitsource::download(&repo, &build.sha).expect("download");
        let dir = std::env::temp_dir().join(format!("shiro-fetch-{}", build.short()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let n = gitsource::unpack_tree(&bytes, &dir).expect("unpack");
        println!("archive: {} bytes, {n} files", bytes.len());

        let files = read_addon(&dir).unwrap();
        let layout = detect_layout(files.keys().map(String::as_str));
        println!("layout: {layout:?}");

        let mut install = 0;
        let mut skip = 0;
        let mut refuse = Vec::new();
        for (path, body) in &files {
            let Some(rel) = to_luaui(path, &layout) else {
                continue;
            };
            match classify(&rel, body, Mode::Replace) {
                Verdict::Install => install += 1,
                Verdict::Skip(_) => skip += 1,
                Verdict::Refuse(w) => refuse.push(w),
            }
        }
        println!("would install {install}, skip {skip}, refuse {}", refuse.len());
        for r in refuse.iter().take(6) {
            println!("    {r}");
        }
        println!("would replace {} packaged widgets", would_replace(&files).len());
        println!("declares {} widgets", declared_widgets(&files).len());
        for (label, mode) in [("safe", Mode::Namespaced), ("replace", Mode::Replace)] {
            println!(
                "{label:>8}: {}",
                match plan_install("addon", &files, mode) {
                    Ok(p) => format!("would install {} files", p.len()),
                    Err(e) => format!("refused - {}", e.chars().take(90).collect::<String>()),
                }
            );
        }

        assert!(!files.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_stock_list_actually_loaded() {
        assert!(STOCK.lines().count() > 300, "generated list looks short");
        assert!(is_stock("unit_shapes.lua"));
        assert!(!is_stock("shiro_helk_thing.lua"));
        // Paths, not names.
        assert!(is_stock("chili/Skins/Evolved/skin.lua"));
        assert!(!is_stock("skin.lua"));
    }
}
