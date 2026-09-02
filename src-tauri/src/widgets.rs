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
/// The same directory, relative to `LuaUI`, which is how manifests record it.
const WIDGET_DIR_REL: &str = "Widgets";
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
    /// The add-on that installed it, if one did. A replacing install writes
    /// original filenames, so the prefix cannot answer this on its own and the
    /// manifests are read instead.
    pub addon: Option<String>,
}

/// An add-on as it sits unpacked, for the page to offer removal of.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledAddon {
    pub id: String,
    /// The repository it came from, if that was recorded.
    pub repo: Option<String>,
    /// Everything it wrote, relative to `LuaUI`. Not every one of these shows
    /// in the widget list: a replacing install writes outside `Widgets` too,
    /// and removal takes all of them.
    pub files: Vec<String>,
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
    lua_scan(lua).map(|(_, c, _)| c).collect()
}

/// Walks Lua source a character at a time, dropping comments and reporting
/// whether each character it yields sits inside a string literal.
///
/// The comment strip and the brace scan both need the same notion of "inside a
/// string" - a `--` there is not a comment and a `{` there is not a table - and
/// two copies of that would drift apart. Characters, not bytes: the input is
/// already valid UTF-8 and widget authors write in every language there is.
struct LuaScan<'a> {
    src: &'a str,
    at: usize,
    quote: Option<char>,
    escaped: bool,
}

fn lua_scan(src: &str) -> LuaScan<'_> {
    LuaScan { src, at: 0, quote: None, escaped: false }
}

impl Iterator for LuaScan<'_> {
    /// Byte offset into the source, the character, and whether it is inside a
    /// string literal. The quotes themselves count as inside.
    type Item = (usize, char, bool);

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let at = self.at;
            let c = self.src[at..].chars().next()?;
            if let Some(q) = self.quote {
                self.at += c.len_utf8();
                if self.escaped {
                    self.escaped = false;
                } else if c == '\\' {
                    self.escaped = true;
                } else if c == q {
                    self.quote = None;
                }
                return Some((at, c, true));
            }
            if c == '"' || c == '\'' {
                self.quote = Some(c);
                self.at += c.len_utf8();
                return Some((at, c, true));
            }
            if self.src[at..].starts_with("--") {
                // A long comment runs to its matching close; a short one to end of line.
                self.at = if self.src[at..].starts_with("--[[") {
                    self.src[at..].find("]]").map_or(self.src.len(), |e| at + e + 2)
                } else {
                    self.src[at..].find('\n').map_or(self.src.len(), |n| at + n)
                };
                continue;
            }
            self.at += c.len_utf8();
            return Some((at, c, false));
        }
    }
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
    // Stepping off the char, not off the byte: `rfind` reports where a char
    // begins, so `+ 1` landed mid-character and the slice below panicked.
    let receiver_start = head
        .char_indices()
        .rev()
        .find(|(_, c)| !(c.is_alphanumeric() || *c == '_'))
        .map_or(0, |(i, c)| i + c.len_utf8());
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
    // Quote-aware, because a lone brace in a `desc` string is a real thing and
    // counting it ran the scan off the end, losing the widget altogether.
    let mut open = None;
    let mut depth = 0usize;
    for (i, c, in_string) in lua_scan(lua) {
        if i < at || in_string {
            continue;
        }
        if c == '{' {
            depth += 1;
            open.get_or_insert(i);
        } else if c == '}' {
            let start = open?;
            depth -= 1;
            if depth == 0 {
                return Some(&lua[start + 1..i]);
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
        format!("[{}]", lua_string(name))
    }
}

/// A quoted string literal in Lua 5.1's own spelling.
///
/// `{:?}` is Rust's escaping, not Lua's: it would emit `\u{NN}`, which Lua 5.1
/// has no escape for at all. Everything outside the handful of escapes below
/// passes through as written, so a name in any script stays readable.
fn lua_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            // Lua's escape for a raw byte is decimal.
            c if (c as u32) < 0x20 || c == '\u{7f}' => {
                out.push_str(&format!("\\{:03}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Find the line holding `name`'s entry, as a byte range over the whole line.
fn order_entry(text: &str, name: &str) -> Option<(usize, usize, i64)> {
    let bare = lua_key(name);
    let bracketed = format!("[{}]", lua_string(name));
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
    find_local_widgets(zk_data).is_some()
}

/// Where the table's key begins, if it is there at all.
fn find_local_widgets(zk_data: &str) -> Option<usize> {
    // Comments are not stripped first: doing so shifts every offset, and the
    // caller needs one into the original text.
    zk_data
        .find(&format!("[{:?}]", LOCAL_WIDGETS_KEY))
        .or_else(|| zk_data.find(&format!("[{}]", LOCAL_WIDGETS_KEY)))
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

/// Take the table out again, which is the only way to turn raw widgets off.
///
/// Writing `useLocalWidgets = false` does nothing at all - `cawidgets.lua:114`
/// reads it as `x or true` - so the table has to go.
pub fn disable_local_widgets(zk_data: &str) -> String {
    let Some(at) = find_local_widgets(zk_data) else {
        return zk_data.to_string();
    };
    // From the start of its line to just past the closing brace of its value.
    let line_start = zk_data[..at].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let Some(open) = zk_data[at..].find('{').map(|i| i + at) else {
        return zk_data.to_string();
    };
    let bytes = zk_data.as_bytes();
    let mut depth = 0usize;
    let mut end = None;
    for (i, &c) in bytes.iter().enumerate().skip(open) {
        if c == b'{' {
            depth += 1;
        } else if c == b'}' {
            depth -= 1;
            if depth == 0 {
                end = Some(i + 1);
                break;
            }
        }
    }
    let Some(mut end) = end else {
        return zk_data.to_string();
    };
    // Take the trailing comma and newline with it, so no blank entry is left.
    if bytes.get(end) == Some(&b',') {
        end += 1;
    }
    while bytes.get(end) == Some(&b'\r') || bytes.get(end) == Some(&b'\n') {
        end += 1;
    }
    format!("{}{}", &zk_data[..line_start], &zk_data[end..])
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
    //
    // Folded, because the filesystem folds. `config/ZK_order.lua` and
    // `Config/ZK_order.lua` are the same file on Windows, so a case-sensitive
    // test here is not a guard at all: the write lands on the real order list
    // and takes the player's whole widget selection with it.
    let folded = rel.to_ascii_lowercase();
    if folded.starts_with("config/") || folded.starts_with("configs/") {
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

/// Zero-K's config files are not guaranteed to be UTF-8.
///
/// `ZK_data.lua` is written by the game from whatever widgets put in it, and a
/// widget storing a byte string leaves the file undecodable - the reported
/// failure was `stream did not contain valid UTF-8` on a real install.
///
/// Reading it lossily would be worse than failing: the text is written back,
/// so every undecodable byte would come back as U+FFFD and quietly corrupt
/// eighty kilobytes of somebody's widget settings. So each byte becomes one
/// char instead. The parsing below only ever looks at ASCII - braces, `=`,
/// digits, quoted keys - and every other byte survives untouched to be written
/// back exactly as it was found.
fn decode(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

/// The inverse of [`decode`].
///
/// A char above U+00FF cannot have come from `decode`, so it was introduced by
/// us - a widget name out of a `GetInfo` - and is written as UTF-8. Zero-K
/// reads these files as bytes, so a name is stored the way its own source
/// spelled it.
fn encode(text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut buf = [0u8; 4];
    for c in text.chars() {
        if (c as u32) <= 0xFF {
            out.push(c as u8);
        } else {
            out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
        }
    }
    out
}

/// Switch raw widgets on in `ZK_data.lua`, if they are not on already.
///
/// Anything written straight into `LuaUI/Widgets/` is invisible to Zero-K until
/// this is set, so every caller that places one has to do this too or it has
/// written a file that will never load. Shared rather than repeated because the
/// skin installer did not do it and reported success anyway.
pub fn turn_on_local_widgets(root: &Path) -> Result<(), String> {
    let data = read_or(root, DATA_FILE, empty_data)?;
    let next = enable_local_widgets(&data)?;
    if next != data {
        write_config(root, DATA_FILE, &next)?;
    }
    Ok(())
}

fn read_or(root: &Path, rel: &str, fallback: fn() -> String) -> Result<String, String> {
    let path = zk_path(root, rel);
    match std::fs::read(&path) {
        Ok(bytes) => Ok(decode(&bytes)),
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
    std::fs::write(&path, encode(text))
        .map_err(|e| format!("could not write {}: {e}", path.display()))
}

// -------------------------------------------------------------- commands ----

/// Why nothing may write `ZK_order.lua` or `ZK_data.lua` mid-game.
///
/// Same reason `engine_settings.rs` refuses `springsettings.cfg`: Zero-K keeps
/// these tables in memory and serialises them back over the files on shutdown,
/// so a write landing now is discarded and the player sees a widget that
/// installed and then simply is not on.
const GAME_RUNNING: &str = "Zero-K is running. It rewrites its widget config when it exits, so \
                            changes saved now would be lost - close the game and try again.";

/// Everything in the install's widget directory, ours and the player's own.
///
/// Off the main thread: it reads and parses every `.lua` file in the install's
/// widget directory, and the window should keep answering while it does.
#[tauri::command(async)]
pub fn zks_widgets_list(
    app: tauri::AppHandle,
    install_root: Option<String>,
) -> Result<Vec<InstalledWidget>, String> {
    let owners = addon_owners(&app);
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
        let addon = owners.get(&format!("{WIDGET_DIR_REL}/{file}")).cloned();
        out.push(InstalledWidget {
            // A replacing install is ours too, and only the manifest says so.
            ours: ours(&file) || addon.is_some(),
            addon,
            file,
            name: info.name,
            enabled,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Which add-on wrote each file, by path relative to `LuaUI`.
///
/// Read from the manifests rather than guessed from the filename, because a
/// replacing install keeps the original name and a namespaced prefix would
/// claim files it did not write.
fn addon_owners(app: &tauri::AppHandle) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for addon in installed_addons(app) {
        for file in addon.files {
            out.insert(file, addon.id.clone());
        }
    }
    out
}

/// Every unpacked add-on, with what it wrote.
///
/// An add-on installed before manifests existed has an empty file list. Its
/// files are still removable, because [`zks_widget_remove`] falls back to the
/// namespaced prefix, but they cannot be attributed here and so are listed as
/// nobody's.
fn installed_addons(app: &tauri::AppHandle) -> Vec<InstalledAddon> {
    let Ok(base) = addons_dir(app) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&base) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        out.push(InstalledAddon {
            repo: read_source(&dir),
            files: read_manifest(&dir).files,
            id,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// The add-ons the page may offer to remove.
///
/// Off the main thread: it reads a manifest per add-on directory.
#[tauri::command(async)]
pub fn zks_widget_addons(app: tauri::AppHandle) -> Vec<InstalledAddon> {
    installed_addons(&app)
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

/// One part of an id, in the charset [`addon_dir`] will accept back.
fn slug(part: &str) -> String {
    let mut out = String::new();
    for c in part.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

/// A directory name for a repository. `Helwor/New-Hel-K` becomes
/// `helwor-new-hel-k`.
///
/// The owner is part of it because the name alone is not an identity. Anyone
/// may fork a pack and keep its name, and `Helwor/New-Hel-K` and
/// `SomeoneElse/New-Hel-K` sharing one directory meant merely looking at the
/// second wiped the first: [`fetch_blocking`] clears the directory before it
/// unpacks, and the manifest that says what the first one installed lives in
/// there. Folding both parts in is not a proof of uniqueness on its own, which
/// is why the resolved slug is written beside the manifest and checked.
pub fn id_for(repo: &Repo) -> String {
    let joined = [slug(&repo.owner), slug(&repo.name)]
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("-");
    if joined.is_empty() {
        "addon".to_string()
    } else {
        joined
    }
}

/// Which repository an unpacked add-on directory came from.
///
/// Written at fetch, read before the next fetch clears the directory. Two
/// repositories that slugged to the same id would otherwise destroy each
/// other's manifest in silence; with this they collide loudly instead.
const SOURCE: &str = "source.json";

fn read_source(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join(SOURCE)).ok()?;
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()?
        .get("repo")?
        .as_str()
        .map(str::to_string)
}

fn write_source(dir: &Path, slug: &str) -> Result<(), String> {
    let text = serde_json::json!({ "repo": slug }).to_string();
    std::fs::write(dir.join(SOURCE), text)
        .map_err(|e| format!("could not record where this came from: {e}"))
}

/// Look at a repository and report what installing it would do.
///
/// Downloads and unpacks, because the only honest way to say what a pack
/// contains is to read it. Nothing reaches the Zero-K install here.
/// Off the main thread, as the skin installer is: this resolves a repository
/// over the network, downloads an archive, unpacks it and reads the whole tree
/// back, and none of that may hold the window.
#[tauri::command]
pub async fn zks_widget_fetch(
    app: tauri::AppHandle,
    repo: String,
) -> Result<AddonPreview, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_blocking(&app, &repo))
        .await
        .map_err(|e| format!("the fetch did not finish: {e}"))?
}

fn fetch_blocking(app: &tauri::AppHandle, repo: &str) -> Result<AddonPreview, String> {
    let parsed = gitsource::parse_repo(&repo)?;
    let build = gitsource::resolve(&parsed)?;
    let id = id_for(&parsed);
    let dir = addon_dir(&app, &id)?;

    // Whose directory this is, before it is cleared. Anything already here
    // belongs to a pack somebody installed, and its manifest is the only record
    // of what that pack wrote into the game.
    if let Some(previous) = read_source(&dir) {
        if !previous.eq_ignore_ascii_case(&parsed.slug()) {
            return Err(format!(
                "{previous} is already here under the same name; remove it before adding {}",
                parsed.slug()
            ));
        }
    }

    // A fresh tree each time, so a file dropped upstream does not linger.
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not make {}: {e}", dir.display()))?;
    write_source(&dir, &parsed.slug())?;

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
///
/// Off the main thread: it still walks the unpacked tree and reads every file.
#[tauri::command(async)]
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

/// What one install wrote, and what it had to move aside to write it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Manifest {
    /// Paths relative to `LuaUI`.
    pub files: Vec<String>,
    /// Files that were already on disk at one of those paths, by where they
    /// were moved to. Also relative to `LuaUI`.
    #[serde(default)]
    pub backups: BTreeMap<String, String>,
}

/// The manifest was a bare list of names before there was anything else to
/// record, and an add-on installed by that version has to keep working.
#[derive(Deserialize)]
#[serde(untagged)]
enum ManifestFile {
    Files(Vec<String>),
    Full(Manifest),
}

fn read_manifest(dir: &Path) -> Manifest {
    std::fs::read_to_string(dir.join(MANIFEST))
        .ok()
        .and_then(|t| serde_json::from_str::<ManifestFile>(&t).ok())
        .map(|m| match m {
            ManifestFile::Files(files) => Manifest { files, ..Manifest::default() },
            ManifestFile::Full(m) => m,
        })
        .unwrap_or_default()
}

fn write_manifest(dir: &Path, manifest: &Manifest) -> Result<(), String> {
    let text = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("could not record what was installed: {e}"))?;
    std::fs::write(dir.join(MANIFEST), text)
        .map_err(|e| format!("could not record what was installed: {e}"))
}

/// What a file already at a target is renamed to before we write over it.
///
/// Not an extension Zero-K loads and not one [`classify`] installs, so a
/// backup sitting in `LuaUI/Widgets` is inert: `zks_widgets_list` only reads
/// `.lua`, and so does the game's own widget handler.
const BACKUP_SUFFIX: &str = ".shiro-backup";

/// Move aside anything already at a planned target that we did not put there.
///
/// Replace mode writes original filenames on purpose, which is the only way a
/// UI replacement pack can work at all - but it means the write lands on
/// whatever is at that path. A player who followed a pack's README and copied
/// it in by hand, then edited a widget, had those edits overwritten with no
/// warning and no way back, and the consent text told them removing the pack
/// would restore what was there. This is what makes that sentence true.
///
/// `previous` is what this same add-on wrote last time. Reinstalling over our
/// own files is not somebody's work being lost, so it backs nothing up and the
/// common case costs no disk at all.
///
/// An existing backup is left alone. The first one is the player's own file;
/// a second pass would replace it with the first pack's copy.
fn back_up_existing(
    luaui: &Path,
    planned: &[Planned],
    previous: &std::collections::BTreeSet<String>,
) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    for p in planned {
        if previous.contains(&p.target) {
            continue;
        }
        let target = zk_path(luaui, &p.target);
        if !target.is_file() {
            continue;
        }
        let kept = format!("{}{BACKUP_SUFFIX}", p.target);
        let backup = zk_path(luaui, &kept);
        if !backup.exists() {
            std::fs::rename(&target, &backup)
                .map_err(|e| format!("could not set {} aside: {e}", p.target))?;
        }
        out.insert(p.target.clone(), kept);
    }
    Ok(out)
}

/// Lay an add-on's planned files down under `luaui`.
///
/// Kept apart from the command so the order of the two steps - set aside, then
/// write - is testable without a Zero-K install or a running app.
fn write_planned(
    luaui: &Path,
    planned: &[Planned],
    before: &Manifest,
) -> Result<(Vec<String>, BTreeMap<String, String>), String> {
    let previous: std::collections::BTreeSet<String> = before.files.iter().cloned().collect();
    let mut backups = before.backups.clone();
    backups.extend(back_up_existing(luaui, planned, &previous)?);

    let mut written = Vec::new();
    for p in planned {
        let target = zk_path(luaui, &p.target);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        std::fs::write(&target, &p.body)
            .map_err(|e| format!("could not write {}: {e}", target.display()))?;
        written.push(p.target.clone());
    }
    Ok((written, backups))
}

/// Put back what [`back_up_existing`] moved aside. Returns what came back.
fn restore_backups(luaui: &Path, backups: &BTreeMap<String, String>) -> Vec<String> {
    let mut out = Vec::new();
    for (target, kept) in backups {
        let backup = zk_path(luaui, kept);
        let target_path = zk_path(luaui, target);
        // Only into a gap. If something is at the target now it is not ours to
        // overwrite, and the backup stays where a player can find it.
        if backup.is_file() && !target_path.exists() && std::fs::rename(&backup, &target_path).is_ok()
        {
            out.push(target.clone());
        }
    }
    out
}

/// Copy an add-on's widget files into the install and make them loadable.
///
/// Rust reads the add-on's own directory rather than taking file bodies from
/// the page. The frontend must not drive what gets written into the game
/// install, and handing over the contents is the same hole as handing over the
/// paths.
///
/// Refused while a game is running. Zero-K holds `ZK_order.lua` and
/// `ZK_data.lua` in memory and writes them back when it exits, so a widget
/// enabled now would be switched off again without a word.
///
/// Off the main thread: it copies a whole pack into the install. The running
/// check is read into a plain bool first, because `tauri::State` is not `Send`
/// and cannot cross into the blocking task.
#[tauri::command]
pub async fn zks_widget_install(
    app: tauri::AppHandle,
    game: tauri::State<'_, crate::launch::Game>,
    addon: String,
    mode: Option<Mode>,
    install_root: Option<String>,
) -> Result<Vec<String>, String> {
    if game.is_running() {
        return Err(GAME_RUNNING.into());
    }
    tauri::async_runtime::spawn_blocking(move || install_blocking(&app, &addon, mode, install_root))
        .await
        .map_err(|e| format!("the install did not finish: {e}"))?
}

fn install_blocking(
    app: &tauri::AppHandle,
    addon: &str,
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

    // What this add-on wrote last time is ours to write over. Everything else
    // at a target is somebody's own file and is set aside first. The old
    // backups are carried forward, or reinstalling would forget what the first
    // install moved and removal would never put it back.
    let before = read_manifest(&source);
    let (written, backups) = write_planned(&luaui, &planned, &before)?;
    write_manifest(
        &source,
        &Manifest { files: written.clone(), backups },
    )?;

    // Raw widgets have to be switched on at all, or none of the above loads.
    turn_on_local_widgets(&found.root)?;

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
///
/// Off the main thread: it walks the install and deletes an unpacked tree. No
/// running-game check, because it touches no config file - the order entries it
/// leaves behind name widgets that are simply no longer there, which is what
/// Zero-K already copes with at every start.
#[tauri::command(async)]
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
    let manifest = read_manifest(&source);
    let mut names = manifest.files;
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
    // What was on disk before the install comes back, which is the promise the
    // consent text makes. Zero-K's own packaged widgets need nothing done to
    // them - they were never touched - but a file the player put there by hand
    // only comes back because it was set aside.
    restore_backups(&luaui, &manifest.backups);
    // The unpacked copy goes too, so a reinstall fetches rather than resurrects.
    if let Ok(dir) = addon_dir(&app, &addon) {
        std::fs::remove_dir_all(&dir).ok();
    }
    Ok(removed)
}

/// Turn one widget on or off, by the name it declares.
///
/// Refused while a game is running, for the reason [`GAME_RUNNING`] gives.
#[tauri::command]
pub async fn zks_widget_set_enabled(
    game: tauri::State<'_, crate::launch::Game>,
    name: String,
    enabled: bool,
    install_root: Option<String>,
) -> Result<(), String> {
    if game.is_running() {
        return Err(GAME_RUNNING.into());
    }
    tauri::async_runtime::spawn_blocking(move || set_enabled_blocking(&name, enabled, install_root))
        .await
        .map_err(|e| format!("the change did not finish: {e}"))?
}

fn set_enabled_blocking(
    name: &str,
    enabled: bool,
    install_root: Option<String>,
) -> Result<(), String> {
    let found = install::detect_with(install_root.as_deref())?;
    let order = read_or(&found.root, ORDER_FILE, empty_order)?;
    let next = set_order(&order, &name, if enabled { BACK_OF_THE_PACK } else { 0 })?;
    write_config(&found.root, ORDER_FILE, &next)
}

/// What an emergency reset did.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetReport {
    /// Where the widget directory was moved to, if there was one.
    pub moved_to: Option<String>,
    /// How many `.lua` files went with it.
    pub widgets: usize,
    /// Whether the order list was taken out of the way.
    pub order_reset: bool,
    /// Whether raw widget loading was switched off.
    pub local_widgets_off: bool,
}

/// Put the game's UI back to how it ships.
///
/// The escape hatch for a pack that breaks Zero-K badly enough that its own
/// widget list cannot be reached to turn anything off. New-Hel-K's README gives
/// the manual version of this - rename `LuaUI/Widgets`, then `/luaui reload` -
/// and this is the same move without a file manager.
///
/// **Nothing is deleted.** The widget directory is moved aside and the config
/// files are copied to `.bak` before being taken out of the way, so a reset is
/// recoverable by hand if it turns out the widgets were not the problem.
///
/// Off the main thread: it counts and moves the whole widget directory.
#[tauri::command(async)]
pub fn zks_widgets_reset(install_root: Option<String>) -> Result<ResetReport, String> {
    let found = install::detect_with(install_root.as_deref())?;
    let luaui = zk_path(&found.root, LUAUI_DIR);
    let widgets = zk_path(&found.root, WIDGET_DIR);

    let mut report = ResetReport {
        moved_to: None,
        widgets: 0,
        order_reset: false,
        local_widgets_off: false,
    };

    if widgets.is_dir() {
        report.widgets = read_addon(&widgets)
            .map(|f| f.keys().filter(|k| k.ends_with(".lua")).count())
            .unwrap_or(0);
        // A name that cannot already exist, so a second reset never overwrites
        // the first one's copy.
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut aside = luaui.join(format!("Widgets.off-{stamp}"));
        let mut n = 1;
        while aside.exists() {
            aside = luaui.join(format!("Widgets.off-{stamp}-{n}"));
            n += 1;
        }
        std::fs::rename(&widgets, &aside)
            .map_err(|e| format!("could not move {}: {e}", widgets.display()))?;
        report.moved_to = Some(aside.file_name().unwrap_or_default().to_string_lossy().into_owned());
    }

    // The order list names widgets that are no longer there. Zero-K rebuilds it
    // from each widget's own default the next time it starts, which is what
    // "back to how it ships" means.
    let order_path = zk_path(&found.root, ORDER_FILE);
    if order_path.is_file() {
        let bak = order_path.with_extension("lua.bak");
        std::fs::copy(&order_path, &bak)
            .map_err(|e| format!("could not back up {}: {e}", order_path.display()))?;
        std::fs::remove_file(&order_path)
            .map_err(|e| format!("could not remove {}: {e}", order_path.display()))?;
        report.order_reset = true;
    }

    // And stop raw widgets loading at all, so anything left behind stays quiet.
    let data = read_or(&found.root, DATA_FILE, empty_data)?;
    if local_widgets_on(&data) {
        let next = disable_local_widgets(&data);
        write_config(&found.root, DATA_FILE, &next)?;
        report.local_widgets_off = true;
    }

    Ok(report)
}

/// Whether raw widgets load, so the screen can offer the switch.
///
/// A read, so no running-game check: the screen has to be able to show the
/// state while the game is up, and nothing here writes.
#[tauri::command(async)]
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

    /// The declared name is the key `ZK_order.lua` is written under, so a
    /// non-ASCII one has to come back byte for byte and go out in a form Lua
    /// 5.1 can read. Lua 5.1 has no `\u` escape.
    #[test]
    fn a_non_ascii_name_survives_the_parse_and_the_key() {
        let lua = "function widget:GetInfo()\n\treturn { name = \"日本語ウィジェット\", enabled = true }\nend\n";
        let info = parse_get_info(lua).unwrap();
        assert_eq!(info.name, "日本語ウィジェット");
        assert!(info.enabled);
        assert_eq!(lua_key("日本語ウィジェット"), "[\"日本語ウィジェット\"]");

        let lua = "function widget:GetInfo() return { name = \"Nick’s “Widget”\" } end";
        assert_eq!(parse_get_info(lua).unwrap().name, "Nick’s “Widget”");

        // Ours to escape, in Lua's own spelling, not Rust's.
        assert_eq!(lua_key("a\tb\"c\\d"), "[\"a\\tb\\\"c\\\\d\"]");
        assert_eq!(lua_key("bell\u{7}"), "[\"bell\\007\"]");
    }

    /// `rfind` reports where a char starts, so `+ 1` landed mid-character and
    /// the slice that followed panicked. All three shapes are from the wild.
    #[test]
    fn a_multi_byte_char_by_the_definition_does_not_panic() {
        let a = "local msg = \"café\"\nfunction widget:GetInfo()\n\treturn { name = \"A\" }\nend\n";
        assert_eq!(parse_get_info(a).unwrap().name, "A");

        let b = "local help = \"…widget:GetInfo()\"\nfunction widget:GetInfo() return { name = \"B\" } end\n";
        assert_eq!(parse_get_info(b).unwrap().name, "B");

        let c = "function\u{a0}widget:GetInfo()\n\treturn { name = \"C\" }\nend\n";
        assert_eq!(parse_get_info(c).unwrap().name, "C");
    }

    /// An unbalanced brace inside a string ran the depth scan off the end, and
    /// the widget then vanished from the list entirely.
    #[test]
    fn an_unbalanced_brace_in_a_string_does_not_hide_the_widget() {
        let open = "function widget:GetInfo()\n\treturn {\n\t\tname = \"Opener\",\n\t\tdesc = \"press { to open\",\n\t}\nend\n";
        assert_eq!(parse_get_info(open).unwrap().name, "Opener");

        let close = "function widget:GetInfo()\n\treturn {\n\t\tdesc = \"press } to close\",\n\t\tname = \"Closer\",\n\t}\nend\n";
        assert_eq!(parse_get_info(close).unwrap().name, "Closer");
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

    /// The guard was case-sensitive, and the filesystem is not. A pack
    /// spelling the directory `config/` reached Verdict::Install, and on NTFS
    /// that write lands on the real `LuaUI/Config/ZK_order.lua`.
    #[test]
    fn the_config_guard_folds_case_because_the_filesystem_does() {
        for spelling in ["config", "CONFIG", "Config", "cOnFiG", "configs", "CONFIGS"] {
            let path = format!("{spelling}/ZK_order.lua");
            for mode in [Mode::Namespaced, Mode::Replace] {
                match classify(&path, b"return {}", mode) {
                    Verdict::Refuse(why) => {
                        assert!(why.contains("settings or keybinds"), "{path}: {why}")
                    }
                    other => panic!("{path} in {mode:?} reached {other:?}"),
                }
            }
        }
    }

    /// And a pack's own subdirectory called config is not the game's, so it is
    /// still installable - the guard is about the top level only.
    #[test]
    fn a_widgets_own_config_subdirectory_is_not_the_games() {
        let v = classify("Widgets/MyPack/config/table.lua", b"local t = {}", Mode::Replace);
        assert_eq!(v, Verdict::Install, "got {v:?}");
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

    /// The widget list attributes a file to an add-on by looking the path up in
    /// that add-on's manifest, so the two have to spell the same file the same
    /// way. They are written in different places and nothing else would notice
    /// them drifting apart: the Remove button would just stop appearing.
    #[test]
    fn a_manifest_path_is_what_the_list_looks_up() {
        let files = addon_of(&[("Widgets/mark_spots.lua", ok_widget("Mark Spots"))]);
        for mode in [Mode::Namespaced, Mode::Replace] {
            let planned = plan_install("helk", &files, mode).unwrap();
            let target = planned[0].target.as_str();
            let base = target.rsplit('/').next().unwrap();
            assert_eq!(target, format!("{WIDGET_DIR_REL}/{base}"), "{mode:?}");
        }
    }

    /// The widget Shiro places in the game has to be one Shiro can read back.
    ///
    /// `zks_widgets_list` shows a widget by the name its `GetInfo` declares and
    /// decides whether it is on from `enabled`. A widget whose `GetInfo` this
    /// parser cannot read is invisible in the widget list and, worse, tells us
    /// nothing about whether Zero-K would load it either.
    #[test]
    fn the_lobby_button_declares_an_info_shiro_can_read() {
        let src = include_str!("lobbybutton/shiro_lobby_button.lua");
        let info = parse_get_info(src).expect("GetInfo is unreadable");
        assert_eq!(info.name, "Shiro Lobby Button");
        assert!(info.enabled, "it would install and then not run");
        assert!(!info.always_start);
        // The name is what ZK_order.lua is keyed on, so a stock widget by the
        // same name would have us fighting over one entry.
        assert!(!is_stock("shiro_lobby_button.lua"));
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

    fn repo(o: &str, n: &str) -> Repo {
        Repo { owner: o.into(), name: n.into() }
    }

    #[test]
    fn a_repository_name_becomes_a_directory_name() {
        assert_eq!(id_for(&repo("Helwor", "New-Hel-K")), "helwor-new-hel-k");
        assert_eq!(id_for(&repo("a", "Zero-K.Widgets")), "a-zero-k-widgets");
        assert_eq!(id_for(&repo("a", "___")), "a");
        assert_eq!(id_for(&repo("___", "___")), "addon");
        // Still a name addon_dir will hand back rather than refuse.
        for id in [id_for(&repo("Hel_wor", "New.Hel K")), id_for(&repo("..", "x"))] {
            assert!(
                !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
                "{id}"
            );
        }
    }

    /// A fork keeps the name. Two packs sharing a directory meant a look at the
    /// second cleared the first's tree and the manifest that said what it had
    /// written into the game, leaving files nothing could find again.
    #[test]
    fn two_owners_of_one_name_are_two_add_ons() {
        assert_ne!(
            id_for(&repo("Helwor", "New-Hel-K")),
            id_for(&repo("SomeoneElse", "New-Hel-K")),
        );
    }

    // ------------------------------------------ files that were there first --

    fn luaui_scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shiro-luaui-{tag}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("Widgets")).unwrap();
        dir
    }

    fn planned_file(target: &str, body: &str) -> Planned {
        Planned { target: target.to_string(), body: body.as_bytes().to_vec() }
    }

    /// The consent text says removing a replacing pack puts back what it took
    /// the place of. That is free for Zero-K's own widgets, which live in the
    /// game archive and were never touched - and false for a file the player
    /// copied in by hand, which the install used to write straight over.
    #[test]
    fn a_file_the_player_already_had_is_set_aside_and_put_back() {
        let luaui = luaui_scratch("handmade");
        let target = "Widgets/gui_chili_economy.lua";
        let mine = luaui.join("Widgets").join("gui_chili_economy.lua");
        std::fs::write(&mine, "-- my own edits\n").unwrap();

        let planned = vec![planned_file(target, "-- the pack's copy\n")];
        let (written, backups) =
            write_planned(&luaui, &planned, &Manifest::default()).unwrap();
        assert_eq!(written, vec![target.to_string()]);
        assert_eq!(std::fs::read_to_string(&mine).unwrap(), "-- the pack's copy\n");

        let kept = luaui.join("Widgets").join("gui_chili_economy.lua.shiro-backup");
        assert!(kept.is_file(), "the player's file was overwritten with no copy kept");
        assert_eq!(std::fs::read_to_string(&kept).unwrap(), "-- my own edits\n");

        // Removal takes our file out and puts theirs back, which is what the
        // screen promised.
        std::fs::remove_file(&mine).unwrap();
        assert_eq!(restore_backups(&luaui, &backups), vec![target.to_string()]);
        assert_eq!(std::fs::read_to_string(&mine).unwrap(), "-- my own edits\n");
        assert!(!kept.exists());
        std::fs::remove_dir_all(&luaui).ok();
    }

    /// Reinstalling the same pack is not somebody's work being lost, so it
    /// keeps no second copy - and it must not forget the first one either.
    #[test]
    fn reinstalling_over_our_own_files_keeps_no_extra_copies() {
        let luaui = luaui_scratch("reinstall");
        let target = "Widgets/gui_chili_economy.lua";
        std::fs::write(luaui.join("Widgets").join("gui_chili_economy.lua"), "mine").unwrap();

        let first = vec![planned_file(target, "v1")];
        let (files, backups) = write_planned(&luaui, &first, &Manifest::default()).unwrap();

        let second = vec![planned_file(target, "v2")];
        let (_, again) = write_planned(&luaui, &second, &Manifest { files, backups }).unwrap();

        assert_eq!(again.len(), 1, "the first backup was forgotten or doubled");
        let kept = luaui.join("Widgets").join("gui_chili_economy.lua.shiro-backup");
        assert_eq!(std::fs::read_to_string(&kept).unwrap(), "mine");
        std::fs::remove_dir_all(&luaui).ok();
    }

    /// The ordinary install writes namespaced names nothing else uses, so
    /// nothing is set aside and the install has no backups cluttering it.
    #[test]
    fn a_safe_install_sets_nothing_aside() {
        let luaui = luaui_scratch("clean");
        let planned = vec![planned_file("Widgets/shiro_helk_thing.lua", "x")];
        let (_, backups) = write_planned(&luaui, &planned, &Manifest::default()).unwrap();
        assert!(backups.is_empty());
        std::fs::remove_dir_all(&luaui).ok();
    }

    /// An add-on installed before backups were recorded still removes cleanly.
    #[test]
    fn the_old_manifest_format_is_still_read() {
        let dir = luaui_scratch("manifest");
        std::fs::write(dir.join(MANIFEST), r#"["Widgets/shiro_a_x.lua"]"#).unwrap();
        let m = read_manifest(&dir);
        assert_eq!(m.files, vec!["Widgets/shiro_a_x.lua".to_string()]);
        assert!(m.backups.is_empty());

        write_manifest(&dir, &m).unwrap();
        assert_eq!(read_manifest(&dir).files, m.files);
        std::fs::remove_dir_all(&dir).ok();
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

    // ------------------------------------------------ bytes we did not write --

    /// The reported failure: `ZK_data.lua` on a real install did not decode as
    /// UTF-8 and every read of it errored.
    ///
    /// Reading it lossily would have been worse than the error, because the
    /// text is written back - so this asserts the bytes survive the round trip
    /// rather than merely that it does not fail.
    #[test]
    fn a_config_file_that_is_not_utf8_still_round_trips() {
        // 0xFF is not valid UTF-8 in any position.
        let raw: Vec<u8> = b"return {\n\t[\"Odd\"] = \"\xFF\xFE\",\n}\n".to_vec();
        assert!(String::from_utf8(raw.clone()).is_err(), "precondition");

        let text = decode(&raw);
        assert_eq!(encode(&text), raw, "the bytes came back changed");
    }

    /// And an edit to one line leaves every other byte alone, including the
    /// ones that are not text at all.
    #[test]
    fn editing_one_entry_preserves_undecodable_bytes_elsewhere() {
        let raw: Vec<u8> =
            b"-- Widget Order List  (0 disables a widget)\nreturn {\n\t[\"Odd\xFF\"] = 5,\n\tAllyCursors = 37,\n}\n".to_vec();
        let text = decode(&raw);
        let next = set_order(&text, "AllyCursors", 0).unwrap();
        let out = encode(&next);

        let has = |needle: &[u8]| out.windows(needle.len()).any(|w| w == needle);
        assert!(has(b"Odd\xFF"), "the undecodable key survived");
        assert!(has(b"AllyCursors = 0,"), "the edit landed");
        // Byte for byte, apart from the one value.
        assert_eq!(
            String::from_utf8_lossy(&out).replace("AllyCursors = 0,", "AllyCursors = 37,"),
            String::from_utf8_lossy(&raw)
        );
    }

    // ------------------------------------------------------------- reset ----

    /// Writing `false` does nothing - `cawidgets.lua:114` reads `x or true` -
    /// so turning raw widgets off means removing the table.
    #[test]
    fn turning_local_widgets_off_removes_the_table() {
        let on = "-- Widget Custom Data\nreturn {\n\t[\"Chili\"] = {},\n\t[\"Local Widgets Config\"] = {\n\t\tuseLocalWidgets = true,\n\t\tuseLocalWidgetsFirst = true,\n\t},\n\t[\"After\"] = 1,\n}\n";
        assert!(local_widgets_on(on));

        let off = disable_local_widgets(on);
        assert!(!local_widgets_on(&off), "still on: {off}");
        assert!(off.contains("[\"Chili\"] = {},"), "kept what was around it");
        assert!(off.contains("[\"After\"] = 1,"), "kept what came after it");
        assert!(!off.contains("useLocalWidgets"), "took the whole value: {off}");
    }

    #[test]
    fn turning_it_off_when_it_is_already_off_changes_nothing() {
        let off = "return {\n\t[\"Chili\"] = {},\n}\n";
        assert_eq!(disable_local_widgets(off), off);
    }

    /// On and off have to be inverses, or a reset followed by an install
    /// leaves the file growing a table each time.
    #[test]
    fn enabling_and_disabling_round_trip() {
        let base = "-- Widget Custom Data\nreturn {\n\t[\"Chili\"] = {},\n}\n";
        let on = enable_local_widgets(base).unwrap();
        assert!(local_widgets_on(&on));
        let off = disable_local_widgets(&on);
        assert_eq!(off, base, "did not get back to where it started");
    }

    /// The page reads these names off the object. Serde's default is the Rust
    /// field name, so a missing rename_all here is a silently empty message
    /// rather than a type error.
    #[test]
    fn the_reset_report_reaches_the_page_under_the_names_it_reads() {
        let json = serde_json::to_string(&ResetReport {
            moved_to: Some("Widgets.off-1".into()),
            widgets: 3,
            order_reset: true,
            local_widgets_off: true,
        })
        .unwrap();
        for key in ["movedTo", "widgets", "orderReset", "localWidgetsOff"] {
            assert!(json.contains(&format!("\"{key}\"")), "{key} missing from {json}");
        }
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
