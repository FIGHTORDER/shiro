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

use crate::install;

/// Every widget filename Zero-K ships, from `tools/gen-stock-widgets.mjs`.
const STOCK: &str = include_str!("stock_widgets.txt");

/// Ours, so removal can never take a file we did not put there.
const PREFIX: &str = "shiro_";

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

/// Whether Zero-K ships a widget under this filename.
///
/// Filenames are namespaced on install, so a raw file can never actually
/// shadow a packaged one. The check earns its place for the opposite reason: an
/// add-on shipping `unit_healthbars.lua` means to *replace* the stock widget,
/// and namespacing silently turns that into a second healthbar widget running
/// beside the first. Refusing is more honest than half-installing it.
pub fn is_stock(basename: &str) -> bool {
    let want = basename.trim().to_ascii_lowercase();
    STOCK.lines().any(|line| {
        let l = line.trim();
        !l.is_empty()
            && (l.eq_ignore_ascii_case(&want)
                // Stock paths may sit in a subdirectory; the filename is what collides.
                || l.rsplit('/').next().map(str::to_ascii_lowercase) == Some(want.clone()))
    })
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

/// The name a widget file is installed under.
///
/// Namespaced by add-on so ownership is never ambiguous, and so a file can
/// never take the place of a packaged widget by accident.
pub fn installed_name(addon: &str, original: &str) -> String {
    let stem = original.rsplit('/').next().unwrap_or(original);
    format!("{PREFIX}{addon}_{stem}")
}

/// Whether a filename in the widget directory is one of ours.
pub fn ours(file: &str) -> bool {
    file.starts_with(PREFIX)
}

/// Why a file cannot be installed, or `None` if it can.
pub fn refuse(path: &str, body: &str) -> Option<String> {
    let rel = path.replace('\\', "/");
    let base = rel.rsplit('/').next().unwrap_or(&rel);

    if rel.contains("../") || rel.starts_with('/') || rel.contains(':') {
        return Some(format!("{base}: the archive tried to escape its directory"));
    }
    // The config files carry the player's own settings and keybinds. An add-on
    // shipping them means to replace both wholesale, which is never something
    // an install should do on somebody's behalf.
    if rel.starts_with("LuaUI/Config/") || rel.starts_with("LuaUI/Configs/") {
        return Some(format!(
            "{base}: add-ons may not replace your widget settings or keybinds"
        ));
    }
    if !base.to_ascii_lowercase().ends_with(".lua") {
        return Some(format!("{base}: not a widget"));
    }
    if is_stock(base) {
        return Some(format!("{base}: Zero-K ships a widget by this name"));
    }
    if parse_get_info(body).is_none() {
        return Some(format!("{base}: no readable GetInfo() name"));
    }
    None
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

/// What installing an add-on would write, or why it may not be installed.
///
/// The whole add-on is refused rather than the acceptable half of it: a pack
/// silently missing a file it expected is a harder thing to diagnose than one
/// that plainly did not install.
pub fn plan_install(
    addon: &str,
    files: &BTreeMap<String, String>,
) -> Result<Vec<(String, String)>, String> {
    if addon.is_empty() || !addon.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("{addon} is not a usable add-on id"));
    }
    let refused: Vec<String> = files
        .iter()
        .filter_map(|(path, body)| refuse(path, body))
        .collect();
    if !refused.is_empty() {
        return Err(refused.join("; "));
    }
    Ok(files
        .iter()
        .map(|(path, body)| (installed_name(addon, path), body.clone()))
        .collect())
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

/// Every `.lua` under an unpacked add-on, as path relative to it to body.
fn read_addon(dir: &Path) -> Result<BTreeMap<String, String>, String> {
    fn walk(base: &Path, at: &Path, out: &mut BTreeMap<String, String>) -> Result<(), String> {
        let entries = match std::fs::read_dir(at) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(format!("could not read {}: {e}", at.display())),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(base, &path, out)?;
            } else if path.extension().and_then(|e| e.to_str()) == Some("lua") {
                let rel = path
                    .strip_prefix(base)
                    .map_err(|_| "a file escaped the add-on directory".to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                // Unreadable as text is a refusal, not a crash: a widget is
                // source, and something that is not is not installable.
                if let Ok(body) = std::fs::read_to_string(&path) {
                    out.insert(rel, body);
                }
            }
        }
        Ok(())
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out)?;
    Ok(out)
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
    install_root: Option<String>,
) -> Result<Vec<String>, String> {
    let source = addon_dir(&app, &addon)?;
    let files = read_addon(&source)?;
    if files.is_empty() {
        return Err(format!("{addon} contains no widgets"));
    }

    let planned = plan_install(&addon, &files)?;

    let found = install::detect_with(install_root.as_deref())?;
    let dir = zk_path(&found.root, WIDGET_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "could not create {} - a Zero-K install outside Steam is often read-only: {e}",
            dir.display()
        )
    })?;

    let mut written = Vec::new();
    for (name, body) in &planned {
        let target = dir.join(name);
        std::fs::write(&target, body)
            .map_err(|e| format!("could not write {}: {e}", target.display()))?;
        written.push(name.clone());
    }

    // Raw widgets have to be switched on at all, or none of the above loads.
    let data = read_or(&found.root, DATA_FILE, empty_data)?;
    let next = enable_local_widgets(&data)?;
    if next != data {
        write_config(&found.root, DATA_FILE, &next)?;
    }

    // Only widgets that ship disabled need an order entry; the rest load on
    // their own declaration, which is what the game would do without us.
    let mut order = read_or(&found.root, ORDER_FILE, empty_order)?;
    let mut touched = false;
    for body in files.values() {
        if let Some(info) = parse_get_info(body) {
            let recorded = order_of(&order, &info.name);
            if !info.enabled && recorded.is_none() || recorded == Some(0) {
                order = set_order(&order, &info.name, BACK_OF_THE_PACK)?;
                touched = true;
            }
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
    let dir = zk_path(&found.root, WIDGET_DIR);
    let want = format!("{PREFIX}{addon}_");

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("could not read {}: {e}", dir.display())),
    };

    let mut removed = Vec::new();
    for entry in entries.flatten() {
        let file = entry.file_name().to_string_lossy().into_owned();
        if !file.starts_with(&want) {
            continue;
        }
        std::fs::remove_file(entry.path())
            .map_err(|e| format!("could not remove {file}: {e}"))?;
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

    #[test]
    fn a_plain_widget_is_accepted() {
        assert_eq!(refuse("LuaUI/Widgets/my_thing.lua", &ok_widget("My Thing")), None);
    }

    /// The one that matters. 39 of Hel-K's 98 files share a name with a stock
    /// widget, and RAW_FIRST means a raw file replaces the packaged one.
    #[test]
    fn a_file_named_after_a_stock_widget_is_refused() {
        for stock in ["unit_healthbars.lua", "api_chili.lua", "gui_epicmenu.lua"] {
            let why = refuse(&format!("LuaUI/Widgets/{stock}"), &ok_widget("X"))
                .unwrap_or_else(|| panic!("{stock} was allowed"));
            assert!(why.contains("Zero-K ships"), "{why}");
        }
    }

    #[test]
    fn an_addon_may_not_replace_the_players_settings_or_keybinds() {
        for path in ["LuaUI/Config/ZK_data.lua", "LuaUI/Config/ZK_order.lua"] {
            let why = refuse(path, "return {}").unwrap();
            assert!(why.contains("settings or keybinds"), "{why}");
        }
    }

    #[test]
    fn nothing_escapes_the_widget_directory() {
        for path in ["../../evil.lua", "/etc/evil.lua", "C:/evil.lua"] {
            assert!(refuse(path, &ok_widget("X")).is_some(), "{path} was allowed");
        }
    }

    #[test]
    fn a_file_that_is_not_a_widget_is_refused() {
        assert!(refuse("LuaUI/Widgets/notes.txt", "hello").is_some());
        assert!(refuse("LuaUI/Widgets/mystery.lua", "-- nothing here").is_some());
    }

    // ------------------------------------------------------------ naming ----

    #[test]
    fn an_installed_file_says_who_owns_it() {
        let n = installed_name("helk", "LuaUI/Widgets/thing.lua");
        assert_eq!(n, "shiro_helk_thing.lua");
        assert!(ours(&n));
        assert!(!ours("unit_healthbars.lua"));
    }

    /// Runs the real refusal logic over a real add-on tree and reports what
    /// would happen. Ignored because it needs an unpacked add-on on disk:
    ///
    ///   SHIRO_ADDON_TREE=<dir> cargo test widgets:: -- --ignored --nocapture
    #[test]
    #[ignore]
    fn what_a_real_addon_would_do() {
        let root = std::env::var("SHIRO_ADDON_TREE")
            .expect("set SHIRO_ADDON_TREE to an unpacked add-on directory");
        let files = read_addon(std::path::Path::new(&root)).unwrap();
        println!("{} lua files in the add-on", files.len());

        let mut shadow = Vec::new();
        let mut other = Vec::new();
        for (path, body) in &files {
            if let Some(why) = refuse(path, body) {
                if why.contains("Zero-K ships") {
                    shadow.push(path.clone());
                } else {
                    other.push((path.clone(), why));
                }
            }
        }
        println!("would shadow a stock widget: {}", shadow.len());
        for p in shadow.iter().take(8) {
            println!("    {p}");
        }
        if shadow.len() > 8 {
            println!("    ... and {} more", shadow.len() - 8);
        }
        println!("refused for other reasons: {}", other.len());
        for (p, why) in other.iter().take(8) {
            println!("    {p}  --  {why}");
        }
        match plan_install("helk", &files) {
            Ok(planned) => println!("VERDICT: would install {} files", planned.len()),
            Err(_) => println!(
                "VERDICT: refused - {} of {} files are blocked",
                shadow.len() + other.len(),
                files.len()
            ),
        }
    }

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
            let body = match std::fs::read_to_string(&path) {
                Ok(b) => b,
                // A handful in the wild are not UTF-8; unreadable is a refusal,
                // not a parser failure.
                Err(_) => continue,
            };
            match parse_get_info(&body) {
                Some(info) => {
                    assert!(!info.name.trim().is_empty());
                    ok += 1;
                }
                None => failed.push(entry.file_name().to_string_lossy().into_owned()),
            }
        }
        println!("parsed {ok}, could not read a name from {}", failed.len());
        for f in &failed {
            println!("  {f}");
        }
        assert!(ok > 0, "corpus had no widgets in it");
    }

    fn addon_of(pairs: &[(&str, String)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(p, b)| (p.to_string(), b.clone())).collect()
    }

    #[test]
    fn a_clean_addon_plans_namespaced_files() {
        let files = addon_of(&[
            ("LuaUI/Widgets/mark_spots.lua", ok_widget("Mark Spots")),
            ("LuaUI/Widgets/lag_handler.lua", ok_widget("Lag Handler")),
        ]);
        let planned = plan_install("helk", &files).unwrap();
        let names: Vec<&str> = planned.iter().map(|(n, _)| n.as_str()).collect();
        assert!(names.contains(&"shiro_helk_mark_spots.lua"));
        assert!(names.contains(&"shiro_helk_lag_handler.lua"));
        assert!(names.iter().all(|n| ours(n)));
    }

    /// One bad file stops the whole pack. Hel-K is the case in mind: 39 of its
    /// 98 files are named after stock widgets, so a partial install would leave
    /// a pack that half works and looks like Shiro broke the game.
    #[test]
    fn one_refused_file_refuses_the_whole_addon() {
        let files = addon_of(&[
            ("LuaUI/Widgets/fine.lua", ok_widget("Fine")),
            ("LuaUI/Widgets/unit_healthbars.lua", ok_widget("Health Bars")),
        ]);
        let why = plan_install("helk", &files).unwrap_err();
        assert!(why.contains("Zero-K ships"), "{why}");
    }

    #[test]
    fn an_addon_carrying_config_files_is_refused_entirely() {
        let files = addon_of(&[
            ("LuaUI/Widgets/fine.lua", ok_widget("Fine")),
            ("LuaUI/Config/ZK_order.lua", "return {}".to_string()),
        ]);
        assert!(plan_install("helk", &files).is_err());
    }

    #[test]
    fn an_addon_id_cannot_walk_out_of_its_directory() {
        let files = addon_of(&[("LuaUI/Widgets/fine.lua", ok_widget("Fine"))]);
        for bad in ["..", "../evil", "a/b", ""] {
            assert!(plan_install(bad, &files).is_err(), "{bad} was allowed");
        }
    }

    #[test]
    fn the_stock_list_actually_loaded() {
        assert!(STOCK.lines().count() > 300, "generated list looks short");
        assert!(is_stock("unit_shapes.lua"));
        assert!(!is_stock("shiro_helk_thing.lua"));
    }
}
