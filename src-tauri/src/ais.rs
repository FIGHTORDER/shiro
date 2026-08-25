//! Which AIs this install can actually run.
//!
//! Shiro used to add `CAI` and nothing else, which is one of nine AIs Zero-K
//! ships and none of the ones the engine brings. The reason a picker needs
//! reading rather than a constant is what `UpdateBotStatus` does with the
//! answer: `AiLib` is passed through the server unvalidated - `ServerBattle.cs`
//! never looks at it - and `ScriptGenerator.cs` splits it on `|` and writes it
//! into the start script as `ShortName`/`Version`. A name that is not installed
//! therefore produces an engine that fails at load, not a server error. So the
//! list has to be what is on disk.
//!
//! Two sources, because that is what the engine has, and Zero-K's own client
//! unions exactly these two through unitsync's `GetAis()`:
//!
//! 1. **The game's LuaAIs.** `LuaAI.lua` at the archive root declares them, and
//!    the wire string is the bare name - `CAI`, `Chicken: Hard`. Each entry
//!    carries a `desc` written for players, which is the difference between a
//!    picker and a dropdown of opaque strings.
//! 2. **The engine's skirmish AIs.** `AI/Skirmish/<ShortName>/<Version>/` with
//!    an `AIInfo.lua` in it, and the wire string is `ShortName|Version`. The
//!    names inside that file are preferred over the directory names, because
//!    the directory names are only a convention.
//!
//! AI *options* are deliberately absent: `UpdateBotStatus` carries four fields
//! and none of them is an option dictionary, and `ScriptGenerator` writes an
//! empty `[Options]` block for every bot. CircuitAI's difficulty and the custom
//! chicken settings cannot be sent over this message at all, so the picker does
//! not pretend otherwise - the chickens' difficulties are separate LuaAIs, and
//! those it can offer.
//!
//! **On the engine's AIs playing this game.** Nothing in `AIInfo.lua` says
//! which game an AI is for, and the engine installs all of them regardless: a
//! Zero-K install ships `BARb`, which is BAR's AI and cannot play Zero-K. A
//! denylist would fix today and rot, so the check is made against the install
//! instead. A skirmish AI's `config/factory.json` names the units it builds; if
//! none of those names is a unit in this game, it is not this game's AI. On the
//! live install that separates them completely - CircuitAI names 132 Zero-K
//! units, BARb names none - and it stays true when either side changes. Where
//! there is nothing to judge on (no `factory.json`, or a game whose archive
//! lists no units) the AI is offered: silence is not evidence.
//!
//! **The two halves come apart.** Only the game's half needs an archive. A
//! skirmish AI is a directory on disk, and whether it is installed is answered
//! by looking at it - so a data directory this cannot read the game out of
//! still gets its engine AIs read and offered, and says which half it guessed
//! at. Rapid is the only archive format here; a Steam-layout `.sdz` is not
//! opened, and that is a reason to fall back for the game's AIs, not a reason
//! to answer nothing.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::install;

/// One AI a person could add to a team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ai {
    /// Exactly what goes on the wire as `UpdateBotStatus.AiLib`.
    pub lib: String,
    /// What to call it on screen.
    pub name: String,
    /// The AI's own words, when it has any.
    pub desc: Option<String>,
    /// `game` for a LuaAI the game declares, `engine` for a skirmish AI.
    pub source: &'static str,
}

/// The answer, and what the reading could not cover.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiList {
    pub ais: Vec<Ai>,
    /// Why the list is short, in words a player can act on. Absent when the
    /// reading was complete. An empty `ais` with a note is the caller's cue to
    /// fall back rather than show an empty picker.
    pub note: Option<String>,
    /// Which archive the game's half of `ais` came out of: [`NAMED`],
    /// [`ANOTHER`] or [`NO_ARCHIVE`]. The engine's half is a reading of the
    /// disk whichever it says, so the caller can stand its built-in list in
    /// for one half without throwing the other away.
    pub game_archive: &'static str,
}

/// `game_archive`: the archive the room named - or, when the room named none,
/// the only reading there was to do. Nothing contradicts this list.
const NAMED: &str = "named";
/// `game_archive`: a different game's archive. The room named one, no archive
/// here spells it, and a data directory shared with another game had one to
/// read. These are real AIs, of the wrong game.
const ANOTHER: &str = "another";
/// `game_archive`: none could be read. The game's half of the list is missing
/// rather than short, and the caller's built-in list has to stand in for it.
const NO_ARCHIVE: &str = "none";

impl Default for AiList {
    /// Nothing read, which is what a list built out of nothing is.
    fn default() -> Self {
        Self { ais: Vec::new(), note: None, game_archive: NO_ARCHIVE }
    }
}

// ------------------------------------------------------------------- lua ---

/// One `key = "value"` found in a data-only Lua table literal.
#[derive(Debug, PartialEq, Eq)]
struct LuaPair {
    /// How many tables deep the assignment sits. The outer `return { ... }` is
    /// depth 1, so the entries in a list of tables are at depth 2.
    depth: usize,
    /// Which table it belongs to, so sibling entries stay apart.
    table: usize,
    key: String,
    value: String,
}

/// Read the string assignments out of a data-only Lua table literal.
///
/// A targeted scanner rather than a Lua runtime, because `LuaAI.lua` and
/// `AIInfo.lua` are both a `return` of a table of tables of strings and nothing
/// else. It has to be a scanner rather than a regex for one specific reason:
/// Zero-K's `LuaAI.lua` carries a commented-out `CAI2` entry, and a search for
/// `name = '...'` finds it. Comments are skipped - both `--` to end of line and
/// `--[[ ]]`, which is how `AIInfo.lua` opens - and strings are consumed whole,
/// so a `--` inside one is not mistaken for the start of a comment.
///
/// A value is any of Lua's three string forms: quoted, or a `[[long bracket]]`,
/// which is what somebody writes a description in the moment it wants a line
/// break in it. Dropping those would drop the entry silently, and an AI missing
/// from a picker is indistinguishable from one that is not installed.
fn lua_pairs(text: &str) -> Vec<LuaPair> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    let mut depth = 0usize;
    let mut tables = 0usize;
    // The table each open brace belongs to, so a close brace restores its parent.
    let mut stack: Vec<usize> = Vec::new();

    while i < b.len() {
        match b[i] {
            b'-' if b.get(i + 1) == Some(&b'-') => i = skip_gap(b, i),
            b'\'' | b'"' => i = end_of_string(b, i) + 1,
            b'[' => match long_bracket(b, i) {
                Some(long) => i = long.end,
                None => i += 1,
            },
            b'{' => {
                tables += 1;
                depth += 1;
                stack.push(tables);
                i += 1;
            }
            b'}' => {
                stack.pop();
                depth = depth.saturating_sub(1);
                i += 1;
            }
            c if c == b'_' || c.is_ascii_alphabetic() => {
                let start = i;
                while i < b.len() && (b[i] == b'_' || b[i].is_ascii_alphanumeric()) {
                    i += 1;
                }
                let key = &text[start..i];
                let j = skip_gap(b, i);
                // `==` is a comparison, not an assignment; nothing here writes
                // one, but consuming it as a value would swallow a brace.
                if b.get(j) != Some(&b'=') || b.get(j + 1) == Some(&b'=') {
                    continue;
                }
                let k = skip_gap(b, j + 1);
                let (value, next) = match b.get(k) {
                    Some(b'\'') | Some(b'"') => {
                        let close = end_of_string(b, k);
                        (unescape(&text[k + 1..close]), close + 1)
                    }
                    /* A long bracket takes its contents as written: Lua applies
                       no escapes inside one, so neither does this. */
                    Some(b'[') => match long_bracket(b, k) {
                        Some(long) => (text[long.text].to_string(), long.end),
                        None => {
                            i = j + 1;
                            continue;
                        }
                    },
                    // A number, a table, a function call - not a string, and
                    // nothing read here is anything else.
                    _ => {
                        i = j + 1;
                        continue;
                    }
                };
                if let Some(&table) = stack.last() {
                    out.push(LuaPair { depth, table, key: key.to_ascii_lowercase(), value });
                }
                i = next;
            }
            _ => i += 1,
        }
    }
    out
}

/// Past whitespace and comments, which Lua allows anywhere a space goes -
/// including between a key and its `=`, and between the `=` and its value.
/// Treating a comment there as the end of the assignment dropped the entry.
fn skip_gap(b: &[u8], mut i: usize) -> usize {
    loop {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if b.get(i) != Some(&b'-') || b.get(i + 1) != Some(&b'-') {
            return i;
        }
        i += 2;
        match long_bracket(b, i) {
            Some(long) => i = long.end,
            None => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
        }
    }
}

/// The index of the quote closing the string that opens at `at`, or the end of
/// the input if it never closes.
fn end_of_string(b: &[u8], at: usize) -> usize {
    let quote = b[at];
    let mut i = at + 1;
    while i < b.len() {
        if b[i] == b'\\' {
            i += 2;
            continue;
        }
        if b[i] == quote {
            return i;
        }
        i += 1;
    }
    b.len()
}

/// A `[[ ]]` or `[==[ ]==]` bracket: where its contents are, and where it ends.
struct LongBracket {
    /// The text between the brackets, as Lua would read it.
    text: std::ops::Range<usize>,
    /// Past the closing bracket.
    end: usize,
}

/// The `[[ ]]` or `[==[ ]==]` bracket starting at `at`, if that is what is
/// there.
fn long_bracket(b: &[u8], at: usize) -> Option<LongBracket> {
    if b.get(at) != Some(&b'[') {
        return None;
    }
    let mut level = 0;
    let mut i = at + 1;
    while b.get(i) == Some(&b'=') {
        level += 1;
        i += 1;
    }
    if b.get(i) != Some(&b'[') {
        return None;
    }
    let mut close = Vec::with_capacity(level + 2);
    close.push(b']');
    close.resize(level + 1, b'=');
    close.push(b']');
    // Lua drops a newline directly after the opening bracket, which is where
    // anybody writing a multi-line description puts one.
    let mut from = i + 1;
    if b.get(from) == Some(&b'\r') {
        from += 1;
    }
    if b.get(from) == Some(&b'\n') {
        from += 1;
    }
    for start in from..b.len() {
        if b[start..].starts_with(&close) {
            return Some(LongBracket { text: from..start, end: start + close.len() });
        }
    }
    Some(LongBracket { text: from..b.len(), end: b.len() })
}

/// Lua 5.1's escapes, which is the Lua these files are written for.
///
/// Mostly this is an apostrophe inside a single-quoted description and the
/// backslash protecting it. `\65` is here because the alternative was worse
/// than not decoding it: copying the digits through put the number 65 in the
/// middle of a sentence, where nothing marks it as a failure. Bytes are
/// assembled and decoded at the end rather than pushed as characters, because
/// a numeric escape names a byte and a character above 127 is several.
fn unescape(s: &str) -> String {
    if !s.contains('\\') {
        return s.to_string();
    }
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'\\' {
            out.push(b[i]);
            i += 1;
            continue;
        }
        i += 1;
        let Some(&c) = b.get(i) else {
            out.push(b'\\');
            break;
        };
        i += 1;
        match c {
            b'a' => out.push(0x07),
            b'b' => out.push(0x08),
            b'f' => out.push(0x0c),
            b'n' => out.push(b'\n'),
            b'r' => out.push(b'\r'),
            b't' => out.push(b'\t'),
            b'v' => out.push(0x0b),
            b'0'..=b'9' => {
                let mut value = u32::from(c - b'0');
                // Three digits at most, so `\1234` is a byte and then a `4`.
                for _ in 0..2 {
                    match b.get(i) {
                        Some(d @ b'0'..=b'9') => {
                            value = value * 10 + u32::from(d - b'0');
                            i += 1;
                        }
                        _ => break,
                    }
                }
                // Lua refuses anything past a byte; a file that writes one is
                // broken, and clamping keeps the rest of the string readable.
                out.push(value.min(255) as u8);
            }
            // A quote, a backslash, or an escape Lua 5.1 does not have - in
            // every case the character itself is what was meant.
            other => out.push(other),
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The entries of a list of tables: every table at depth 2, in file order, as
/// its own set of fields.
fn lua_entries(text: &str) -> Vec<HashMap<String, String>> {
    let mut order: Vec<usize> = Vec::new();
    let mut by_table: HashMap<usize, HashMap<String, String>> = HashMap::new();
    for pair in lua_pairs(text).into_iter().filter(|p| p.depth == 2) {
        let entry = by_table.entry(pair.table).or_insert_with(|| {
            order.push(pair.table);
            HashMap::new()
        });
        entry.entry(pair.key).or_insert(pair.value);
    }
    order.into_iter().filter_map(|t| by_table.remove(&t)).collect()
}

/// The fields of a single flat table, which is what `modinfo.lua` is.
fn lua_fields(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for pair in lua_pairs(text).into_iter().filter(|p| p.depth == 1) {
        out.entry(pair.key).or_insert(pair.value);
    }
    out
}

// -------------------------------------------------------------- the game ---

/// Everything about one rapid package that answers a question here.
///
/// A rapid `.sdp` is a gzipped index of `(name length, name, md5[16],
/// crc32[4], size[4])` records - the sizes are big-endian - with each file's
/// body sitting gzipped at `pool/<md5[..2]>/<md5[2..]>.gz`. Only three things
/// out of a Zero-K index's 8812 entries matter, so the walk keeps those and
/// drops the rest rather than building a map of the archive.
#[derive(Debug, Default)]
struct Package {
    /// Pool hash of `LuaAI.lua`. Its presence is what makes a package a game.
    lua_ai: Option<String>,
    modinfo: Option<String>,
    /// Every `units/<name>.lua`, by unit name - what the AIs are checked against.
    units: HashSet<String>,
}

/// A corrupt or hostile `.sdp` must not be decompressed without bound. Zero-K's
/// index is about 400 kB; this is room for an archive many times its size.
const MAX_INDEX: u64 = 64 * 1024 * 1024;

/// A `LuaAI.lua` or `modinfo.lua` is a couple of kilobytes.
const MAX_BODY: u64 = 4 * 1024 * 1024;

fn gunzip(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(file)
        .take(limit)
        .read_to_end(&mut out)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(out)
}

fn read_index(path: &Path) -> Result<Package, String> {
    let raw = gunzip(path, MAX_INDEX)?;
    let mut pkg = Package::default();
    let mut i = 0usize;
    while i < raw.len() {
        let len = raw[i] as usize;
        i += 1;
        // 16 bytes of md5, 4 of crc32, 4 of size. A truncated record means a
        // truncated file, and half an index is not an answer.
        let end = i + len + 24;
        if end > raw.len() {
            return Err(format!("{} ends inside a record", path.display()));
        }
        let name = String::from_utf8_lossy(&raw[i..i + len]).to_ascii_lowercase();
        let hash = hex(&raw[i + len..i + len + 16]);
        i = end;

        match name.as_str() {
            "luaai.lua" => pkg.lua_ai = Some(hash),
            "modinfo.lua" => pkg.modinfo = Some(hash),
            _ => {
                if let Some(unit) = name.strip_prefix("units/").and_then(|n| n.strip_suffix(".lua"))
                {
                    // Zero-K files units in subdirectories; the engine keys them
                    // by the file's own name either way.
                    pkg.units.insert(unit.rsplit('/').next().unwrap_or(unit).to_string());
                }
            }
        }
    }
    Ok(pkg)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Where the pool keeps one file's body.
fn pool_path(root: &Path, hash: &str) -> Option<PathBuf> {
    if hash.len() != 32 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(root.join("pool").join(&hash[..2]).join(format!("{}.gz", &hash[2..])))
}

fn pool_text(root: &Path, hash: &str) -> Option<String> {
    let path = pool_path(root, hash)?;
    let raw = gunzip(&path, MAX_BODY).ok()?;
    Some(String::from_utf8_lossy(&raw).into_owned())
}

/// The name a lobby would use for the archive this `modinfo.lua` describes.
///
/// The server says "Zero-K v1.14.8.0"; the archive says `name='Zero-K'` and
/// `version='v1.14.8.0'` separately, and the engine joins them unless the name
/// already carries the version.
fn archive_name(modinfo: &str) -> Option<String> {
    let fields = lua_fields(modinfo);
    let name = fields.get("name")?.trim().to_string();
    if name.is_empty() {
        return None;
    }
    match fields.get("version").map(|v| v.trim()).filter(|v| !v.is_empty()) {
        Some(v) if !name.contains(v) => Some(format!("{name} {v}")),
        _ => Some(name),
    }
}

/// Case and spacing are the only ways two spellings of one archive name differ.
fn fold(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// A rapid package, and whether it is the game that was asked for.
struct Chosen {
    pkg: Package,
    /// What the archive calls itself. Only looked up when the room named a
    /// game, because comparing against that name is the only thing it decides.
    name: Option<String>,
    /// False when the room named a game, no archive here spells it, and this
    /// is the newest one taken instead. What follows is then a real AI list,
    /// of a game nobody in the room is playing.
    matched: bool,
}

/// The rapid package that is this game.
///
/// A data directory holds one `.sdp` per rapid download, maps included, so the
/// candidates are the ones carrying a `LuaAI.lua`. Among those, the one whose
/// `modinfo.lua` spells the name the room gave; failing that the most recently
/// fetched, which is the version somebody is most likely playing - and which
/// is a guess, said so, because a Spring data directory is shared between games
/// and the newest archive in one can be a game of its own.
fn game_package(root: &Path, game: Option<&str>) -> Option<Chosen> {
    let wanted = game.map(fold).filter(|g| !g.is_empty());
    let mut newest: Option<(std::time::SystemTime, Package, Option<String>)> = None;

    let entries = std::fs::read_dir(root.join("packages")).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("sdp") {
            continue;
        }
        let Ok(pkg) = read_index(&path) else { continue };
        if pkg.lua_ai.is_none() {
            continue;
        }
        let named = wanted.as_ref().and_then(|_| {
            pkg.modinfo
                .as_deref()
                .and_then(|h| pool_text(root, h))
                .and_then(|t| archive_name(&t))
        });
        if let Some(want) = &wanted {
            if named.as_deref().map(fold) == Some(want.clone()) {
                return Some(Chosen { pkg, name: named, matched: true });
            }
        }
        let when = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        if newest.as_ref().map_or(true, |(seen, _, _)| when >= *seen) {
            newest = Some((when, pkg, named));
        }
    }
    newest.map(|(_, pkg, name)| Chosen { pkg, name, matched: wanted.is_none() })
}

// ----------------------------------------------------------- the engine ---

/// Every `AI/Skirmish/<name>/<version>/` with an `AIInfo.lua` in it.
fn skirmish_ais(engine_dir: &Path) -> Vec<(Ai, PathBuf)> {
    let mut out = Vec::new();
    let Ok(names) = std::fs::read_dir(engine_dir.join("AI").join("Skirmish")) else {
        return out;
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    for name in names.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        let Ok(versions) = std::fs::read_dir(&name) else { continue };
        dirs.extend(versions.flatten().map(|e| e.path()).filter(|p| p.is_dir()));
    }
    // Directory order is the filesystem's, which is not an order anyone chose.
    dirs.sort();

    for dir in dirs {
        let Ok(text) = std::fs::read_to_string(dir.join("AIInfo.lua")) else { continue };
        /* The file is a list of `{ key = ..., value = ... }` records rather
           than a table of fields, so the fields have to be rebuilt from it. */
        let mut fields: HashMap<String, String> = HashMap::new();
        for entry in lua_entries(&text) {
            if let (Some(k), Some(v)) = (entry.get("key"), entry.get("value")) {
                fields.entry(k.to_ascii_lowercase()).or_insert_with(|| v.clone());
            }
        }
        /* The directory names are a convention the engine follows, not the
           truth; `AIInfo.lua` holds what the engine actually loads by. Falling
           back to the directories keeps an AI with a malformed info file
           listed rather than silently absent. */
        let dir_name = |p: &Path| p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let short = fields.get("shortname").cloned().unwrap_or_else(|| {
            dir.parent().map(dir_name).unwrap_or_default()
        });
        let version = fields.get("version").cloned().unwrap_or_else(|| dir_name(&dir));
        /* `|` is the separator the server splits `AiLib` on, so one inside
           either half would be read as a different AI at a different version.
           Nothing that could not be launched belongs in the picker. */
        if short.trim().is_empty()
            || version.trim().is_empty()
            || short.contains('|')
            || version.contains('|')
        {
            continue;
        }
        out.push((
            Ai {
                lib: format!("{short}|{version}"),
                name: short,
                desc: fields.get("description").filter(|d| !d.trim().is_empty()).cloned(),
                source: "engine",
            },
            dir,
        ));
    }
    out
}

/// Does this skirmish AI know any of the game's units?
///
/// The one signal on disk that distinguishes an AI written for this game from
/// one the engine ships for another: `config/factory.json` names the factories
/// and units it builds, and those names are the game's, not the engine's.
/// Everything unprovable is allowed through - an AI with no config, or a game
/// whose archive lists no units - because the question this answers is "is
/// there evidence against it", not "is there evidence for it".
fn plays(dir: &Path, units: &HashSet<String>) -> bool {
    if units.is_empty() {
        return true;
    }
    let Ok(text) = std::fs::read_to_string(dir.join("config").join("factory.json")) else {
        return true;
    };
    let named = json_strings(&text);
    named.is_empty() || named.iter().any(|s| units.contains(s))
}

/// Every double-quoted token in a JSON file, lowercased.
///
/// These configs are JSON with `//` comments, so `serde_json` will not read
/// them, and the shape wanted here is flat anyway: which names appear at all,
/// not where. Comments are skipped so a stray quote in one cannot pair with a
/// real string's and shift every token after it.
fn json_strings(text: &str) -> Vec<String> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'/' if b.get(i + 1) == Some(&b'/') => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if b.get(i + 1) == Some(&b'*') => {
                i = text[i + 2..].find("*/").map(|at| i + 2 + at + 2).unwrap_or(b.len());
            }
            b'"' => {
                let close = end_of_string(b, i);
                out.push(text[i + 1..close].to_ascii_lowercase());
                i = close + 1;
            }
            _ => i += 1,
        }
    }
    out
}

// ------------------------------------------------------------ the answer ---

/// Everything this install can put in a team, for this game and engine.
///
/// Never an error. A picker that cannot read the install still has to offer
/// something, so the failures come back as a note beside an empty list and the
/// caller decides what to show instead - see `src/net/ais.ts`.
#[tauri::command]
pub async fn zks_list_ais(
    engine: String,
    game: Option<String>,
    install_root: Option<String>,
) -> AiList {
    /* Off the thread that draws the window, the way `zks_managed_state` is. A
       command declared without `async` runs on the main thread, and this one
       gunzips and walks every `.sdp` in the data directory: measured at 10 ms
       against an install holding one package and 380 ms against one holding
       forty, in a release build, every time the picker opens. */
    match tauri::async_runtime::spawn_blocking(move || {
        list_ais_blocking(&engine, game.as_deref(), install_root.as_deref())
    })
    .await
    {
        Ok(list) => list,
        /* Still not an error: the caller has nothing to do with one, and an
           empty list beside a note is exactly what it falls back on. */
        Err(e) => AiList {
            note: Some(format!("Reading this install did not finish: {e}")),
            ..AiList::default()
        },
    }
}

fn list_ais_blocking(engine: &str, game: Option<&str>, install_root: Option<&str>) -> AiList {
    match install::detect_with(install_root) {
        Ok(install) => list_in(&install.root, engine, game),
        Err(e) => AiList { note: Some(first_line(&e)), ..AiList::default() },
    }
}

/// A caption, out of a message written for a page.
///
/// `install::detect` answers with every directory it probed, one per line.
/// That is the right answer in Settings, where the search is the point, and
/// the wrong one under a picker, where the line breaks collapse and it reads
/// as a paragraph of paths. The first line carries the reason; Settings has
/// the rest.
fn first_line(message: &str) -> String {
    message.lines().next().unwrap_or(message).trim().to_string()
}

/// The reading itself, against a data directory rather than a detected install,
/// so a test can point it at one.
fn list_in(root: &Path, engine: &str, game: Option<&str>) -> AiList {
    let chosen = game_package(root, game);
    let mut ais = Vec::new();
    let mut notes: Vec<String> = Vec::new();

    /* The game's own first: these are the ones a Zero-K player is looking for,
       and CAI heading the list keeps the old one-click behaviour one click. */
    if let Some(text) =
        chosen.as_ref().and_then(|c| c.pkg.lua_ai.as_deref()).and_then(|h| pool_text(root, h))
    {
        for entry in lua_entries(&text) {
            /* A LuaAI is a bare name on the wire. One containing `|` would be
               split into ShortName/Version by the server and looked for among
               the engine's AIs instead, where it is not. */
            let Some(name) = entry
                .get("name")
                .map(|n| n.trim())
                .filter(|n| !n.is_empty() && !n.contains('|'))
            else {
                continue;
            };
            ais.push(Ai {
                lib: name.to_string(),
                name: name.to_string(),
                desc: entry.get("desc").filter(|d| !d.trim().is_empty()).cloned(),
                source: "game",
            });
        }
    }

    let game_archive = match &chosen {
        Some(c) if c.matched => NAMED,
        Some(c) => {
            notes.push(match (game, &c.name) {
                (Some(asked), Some(found)) => format!(
                    "{asked} is not installed here, so these are {found}'s AIs rather than \
                     a reading of the game this room is playing."
                ),
                _ => "The game this room is playing is not installed here, so these are \
                      another game's AIs."
                    .into(),
            });
            ANOTHER
        }
        /* No rapid package to read. A Steam-layout install keeps its game as
           an `.sdz` under `games/`, which this does not open - but the
           engine's skirmish AIs are directories sitting on disk, so they are
           still read below and offered. Only the game's half is missing. */
        None => {
            notes.push(format!(
                "Could not read a game archive under {}, so the game's own AIs here are \
                 Shiro's built-in list and the engine's are offered unchecked against it.",
                root.display()
            ));
            NO_ARCHIVE
        }
    };

    /* With no archive there are no units, and `plays` lets every skirmish AI
       through: silence is not evidence. */
    let no_units = HashSet::new();
    let units = chosen.as_ref().map_or(&no_units, |c| &c.pkg.units);

    if engine.trim().is_empty() {
        notes.push(
            "Shiro does not know the engine version yet, so the engine's own AIs are not listed."
                .into(),
        );
    } else {
        match install::find_engine(root, engine) {
            Ok(exe) => {
                let mut dir = exe.parent().unwrap_or(root).to_path_buf();
                // One of the layouts `install::engine_candidates` allows puts
                // the binaries in `bin/` with `AI/` beside it rather than under.
                if dir.file_name().and_then(|n| n.to_str()) == Some("bin") {
                    if let Some(up) = dir.parent() {
                        dir = up.to_path_buf();
                    }
                }
                for (ai, at) in skirmish_ais(&dir) {
                    if plays(&at, units) {
                        ais.push(ai);
                    }
                }
            }
            Err(_) => {
                notes.push(format!(
                    "Engine {engine} is not installed here, so the engine's own AIs are not listed."
                ));
            }
        }
    }

    /* One AI twice is two identical rows, and the caller keys its rows on
       `lib` - a repeat is a duplicate key in a list React is diffing. It takes
       nothing stranger than an engine directory left behind by an older
       install declaring the same `ShortName|Version` as the one beside it. */
    let mut seen = HashSet::new();
    ais.retain(|ai| seen.insert(ai.lib.clone()));

    if ais.is_empty() && notes.is_empty() {
        notes.push("The game archive declares no AIs, so this is Shiro's built-in list.".into());
    }
    AiList {
        ais,
        note: (!notes.is_empty()).then(|| notes.join(" ")),
        game_archive,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Zero-K's own, taken verbatim out of the rapid pool of a live install.
    const LUAAI: &str = include_str!("fixtures/luaai.lua");
    /// CircuitAI's, verbatim from `AI/Skirmish/CircuitAI/stable/`.
    const CIRCUIT: &str = include_str!("fixtures/aiinfo-circuit.lua");

    fn names(text: &str) -> Vec<String> {
        lua_entries(text).iter().filter_map(|e| e.get("name").cloned()).collect()
    }

    #[test]
    fn the_games_own_ai_list_reads_as_the_nine_it_declares() {
        let found = names(LUAAI);
        assert_eq!(
            found,
            vec![
                "CAI",
                "Chicken: Beginner",
                "Chicken: Very Easy",
                "Chicken: Easy",
                "Chicken: Normal",
                "Chicken: Hard",
                "Chicken: Suicidal",
                "Chicken: Custom",
                "Null AI",
            ]
        );
    }

    #[test]
    fn a_commented_out_entry_is_not_an_installed_ai() {
        /* Zero-K's LuaAI.lua carries `--{ name = 'CAI2' ... }`. Offering it
           would send an AiLib the server passes through unvalidated, and the
           engine would fail to load an AI that is not there. */
        assert!(!names(LUAAI).iter().any(|n| n == "CAI2"));
    }

    #[test]
    fn the_descriptions_come_across_because_they_are_the_point() {
        let entries = lua_entries(LUAAI);
        let desc = |name: &str| {
            entries
                .iter()
                .find(|e| e.get("name").map(String::as_str) == Some(name))
                .and_then(|e| e.get("desc"))
                .cloned()
        };
        assert_eq!(desc("CAI").as_deref(), Some("AI that plays regular Zero-K"));
        assert_eq!(desc("Chicken: Hard").as_deref(), Some("Will burn your ass"));
    }

    #[test]
    fn a_missing_space_around_the_equals_is_still_an_assignment() {
        // The last entry in Zero-K's file is written `name ='Null AI'`.
        assert!(names(LUAAI).iter().any(|n| n == "Null AI"));
    }

    #[test]
    fn an_ai_info_file_is_read_as_the_fields_it_encodes() {
        let mut fields = HashMap::new();
        for entry in lua_entries(CIRCUIT) {
            if let (Some(k), Some(v)) = (entry.get("key"), entry.get("value")) {
                fields.insert(k.to_ascii_lowercase(), v.clone());
            }
        }
        assert_eq!(fields.get("shortname").map(String::as_str), Some("CircuitAI"));
        assert_eq!(fields.get("version").map(String::as_str), Some("stable"));
        // Trailing `-- !This comment is used for parsing!` on the same line.
        assert_eq!(fields.get("interfaceshortname").map(String::as_str), Some("C"));
    }

    #[test]
    fn a_block_comment_header_does_not_swallow_the_file() {
        // NullAI's AIInfo.lua opens with `--[[ ... ]]`, which a line-comment
        // skip would read as one line and then parse the prose that follows.
        let text = "--[[\n  key: a thing\n  value: another\n]]\n\
                    local infos = {\n  { key = 'shortName', value = 'NullAI' },\n}\nreturn infos\n";
        let entries = lua_entries(text);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].get("value").map(String::as_str), Some("NullAI"));
    }

    #[test]
    fn a_comment_marker_inside_a_string_is_part_of_the_string() {
        let text = "return {\n  { name = 'A -- B', desc = \"it's fine\" },\n}\n";
        let entries = lua_entries(text);
        assert_eq!(entries[0].get("name").map(String::as_str), Some("A -- B"));
        assert_eq!(entries[0].get("desc").map(String::as_str), Some("it's fine"));
    }

    #[test]
    fn nested_tables_do_not_merge_into_their_parent_entry() {
        // Guards the depth rule: only fields written directly on an entry are
        // that entry's, so a future LuaAI.lua with options inside one does not
        // acquire a second name.
        let text = "return {\n  { name = 'A', opts = { name = 'not this' } },\n  { name = 'B' },\n}\n";
        assert_eq!(names(text), vec!["A", "B"]);
    }

    #[test]
    fn an_archive_name_is_the_one_a_room_would_say() {
        let modinfo = "return {\n  name='Zero-K',\n  version='v1.14.8.0',\n  shortname='ZK',\n}\n";
        assert_eq!(archive_name(modinfo).as_deref(), Some("Zero-K v1.14.8.0"));
        // A name that already carries its version is not given it twice.
        let doubled = "return { name='Zero-K v1.14.8.0', version='v1.14.8.0' }";
        assert_eq!(archive_name(doubled).as_deref(), Some("Zero-K v1.14.8.0"));
    }

    // ------------------------------------------------------------ rapid ---

    fn gz(bytes: &[u8]) -> Vec<u8> {
        use std::io::Write;
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        enc.write_all(bytes).unwrap();
        enc.finish().unwrap()
    }

    /// One index record in the shape pr-downloader writes.
    fn record(name: &str, hash: [u8; 16], size: u32) -> Vec<u8> {
        let mut out = vec![name.len() as u8];
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(&hash);
        out.extend_from_slice(&[0, 0, 0, 0]);
        out.extend_from_slice(&size.to_be_bytes());
        out
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shiro-ais-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Write a body into the pool where its hash says it belongs.
    fn pool_write(root: &Path, hash: [u8; 16], body: &str) {
        let path = pool_path(root, &hex(&hash)).unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, gz(body.as_bytes())).unwrap();
    }

    fn write_package(root: &Path, file: &str, records: &[Vec<u8>]) {
        let dir = root.join("packages");
        std::fs::create_dir_all(&dir).unwrap();
        let body: Vec<u8> = records.concat();
        std::fs::write(dir.join(file), gz(&body)).unwrap();
    }

    #[test]
    fn an_index_walk_finds_the_files_it_came_for() {
        let root = temp("index");
        let lua = [1u8; 16];
        let mod_ = [2u8; 16];
        write_package(
            &root,
            "a.sdp",
            &[
                record("units/factorycloak.lua", [3; 16], 100),
                record("luaai.lua", lua, 1306),
                record("units/cloak/cloakraid.lua", [4; 16], 100),
                record("modinfo.lua", mod_, 200),
                record("gamedata/alldefs.lua", [5; 16], 100),
            ],
        );
        let pkg = read_index(&root.join("packages").join("a.sdp")).unwrap();
        assert_eq!(pkg.lua_ai.as_deref(), Some(hex(&lua).as_str()));
        assert_eq!(pkg.modinfo.as_deref(), Some(hex(&mod_).as_str()));
        // Keyed by the file's own name, whatever directory it sits in.
        assert!(pkg.units.contains("factorycloak"));
        assert!(pkg.units.contains("cloakraid"));
        assert!(!pkg.units.contains("alldefs"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_truncated_index_is_refused_rather_than_half_read() {
        let root = temp("truncated");
        let mut body = record("luaai.lua", [1; 16], 10);
        body.truncate(body.len() - 6);
        write_package(&root, "a.sdp", &[body]);
        assert!(read_index(&root.join("packages").join("a.sdp")).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_package_with_luaai_in_it_is_the_game() {
        // The other .sdp here is a map, which is what most of them are.
        let root = temp("which");
        let lua = [7u8; 16];
        write_package(&root, "map.sdp", &[record("maps/comet.smf", [9; 16], 10)]);
        write_package(&root, "game.sdp", &[record("luaai.lua", lua, 10)]);
        let found = game_package(&root, None).expect("the game was not found");
        assert_eq!(found.pkg.lua_ai.as_deref(), Some(hex(&lua).as_str()));
        // Nothing was asked for, so nothing about it is a guess.
        assert!(found.matched);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_named_game_wins_over_the_newer_one() {
        /* Two Zero-K versions in one data directory is ordinary. The room says
           which one it is playing, and that is the archive whose AIs count. */
        let root = temp("named");
        let old_lua = [11u8; 16];
        let old_info = [12u8; 16];
        let new_lua = [13u8; 16];
        let new_info = [14u8; 16];
        pool_write(&root, old_info, "return { name='Zero-K', version='v1.14.8.0' }");
        pool_write(&root, new_info, "return { name='Zero-K', version='v1.15.0.0' }");
        pool_write(&root, old_lua, "return { { name = 'CAI' } }");
        pool_write(&root, new_lua, "return { { name = 'NewCAI' } }");
        write_package(&root, "old.sdp",
            &[record("luaai.lua", old_lua, 10), record("modinfo.lua", old_info, 10)]);
        write_package(&root, "new.sdp",
            &[record("luaai.lua", new_lua, 10), record("modinfo.lua", new_info, 10)]);

        let found = game_package(&root, Some("Zero-K v1.14.8.0")).unwrap();
        assert_eq!(found.pkg.lua_ai.as_deref(), Some(hex(&old_lua).as_str()));
        assert!(found.matched);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_archive_that_is_not_the_rooms_game_is_offered_as_the_guess_it_is() {
        /* A Spring data directory is shared between games, and the newest
           archive in one that has no Zero-K in it is not Zero-K. Handing back
           its AIs was defensible; handing them back indistinguishable from a
           reading of the room's own game was not - the caller marks a guess,
           and had nothing to mark. */
        let root = temp("elsewhere");
        let lua = [0x21u8; 16];
        let info = [0x22u8; 16];
        pool_write(&root, info, "return { name='Balanced Annihilation', version='v12.1' }");
        pool_write(&root, lua, "return { { name = 'Shard' } }");
        write_package(&root, "ba.sdp",
            &[record("luaai.lua", lua, 10), record("modinfo.lua", info, 10)]);

        let list = list_in(&root, "", Some("Zero-K v1.14.8.0"));
        assert_eq!(list.game_archive, ANOTHER);
        assert_eq!(list.ais.len(), 1, "the archive that was there is still read");
        let note = list.note.expect("a guess that does not say so is a claim");
        // Both names, because "this is a guess" is not actionable and
        // "these are Balanced Annihilation's AIs" is.
        assert!(note.contains("Zero-K v1.14.8.0"), "{note}");
        assert!(note.contains("Balanced Annihilation v12.1"), "{note}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_archive_the_room_named_is_not_a_guess() {
        let root = temp("exact");
        let lua = [0x23u8; 16];
        let info = [0x24u8; 16];
        pool_write(&root, info, "return { name='Zero-K', version='v1.14.8.0' }");
        pool_write(&root, lua, "return { { name = 'CAI' } }");
        write_package(&root, "zk.sdp",
            &[record("luaai.lua", lua, 10), record("modinfo.lua", info, 10)]);

        let list = list_in(&root, "", Some("Zero-K v1.14.8.0"));
        assert_eq!(list.game_archive, NAMED);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_body_is_read_back_out_of_the_pool() {
        let root = temp("pool");
        let hash = [0xab; 16];
        pool_write(&root, hash, "return { { name = 'CAI' } }");
        assert_eq!(
            pool_text(&root, &hex(&hash)).as_deref(),
            Some("return { { name = 'CAI' } }")
        );
        // And a hash that is not one addresses nothing.
        assert_eq!(pool_path(&root, "nonsense"), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    // ----------------------------------------------------- fit and shape ---

    #[test]
    fn an_ai_built_for_another_game_is_not_offered() {
        /* BARb ships with Zero-K's engine and cannot play Zero-K: its
           factory.json names armlab, armck, armpw, which are BAR's units.
           CircuitAI's names factorycloak and friends, which are Zero-K's. */
        let root = temp("fit");
        let zk: HashSet<String> =
            ["factorycloak", "cloakraid", "factorygunship"].iter().map(|s| s.to_string()).collect();

        let circuit = root.join("CircuitAI");
        std::fs::create_dir_all(circuit.join("config")).unwrap();
        std::fs::write(
            circuit.join("config").join("factory.json"),
            "// Mono-space font required\n{\n\"factory\": {\n\"factorycloak\": {\n\
             \"unit\": [\"cloakraid\"]\n}\n}\n}\n",
        )
        .unwrap();
        assert!(plays(&circuit, &zk));

        let barb = root.join("BARb");
        std::fs::create_dir_all(barb.join("config")).unwrap();
        std::fs::write(
            barb.join("config").join("factory.json"),
            "{\n\"factory\": {\n\"armlab\": {\n\"unit\": [\"armck\", \"armpw\"]\n}\n}\n}\n",
        )
        .unwrap();
        assert!(!plays(&barb, &zk));

        // No config to judge on, so it is offered: silence is not evidence.
        let bare = root.join("NullAI");
        std::fs::create_dir_all(&bare).unwrap();
        assert!(plays(&bare, &zk));
        // Neither is a game we could not read units for.
        assert!(plays(&barb, &HashSet::new()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_quote_inside_a_comment_does_not_shift_every_name_after_it() {
        let strings = json_strings("// he said \"no\"\n{ \"factory\": { \"armlab\": {} } }");
        assert_eq!(strings, vec!["factory", "armlab"]);
        let block = json_strings("/* \" */ { \"a\": 1 }");
        assert_eq!(block, vec!["a"]);
    }

    #[test]
    fn a_skirmish_ai_is_named_by_its_info_file_not_its_folder() {
        let root = temp("skirmish");
        // The folder says one thing and AIInfo.lua another; the engine loads
        // by the file, so the wire string has to come from the file.
        let dir = root.join("AI").join("Skirmish").join("circuit-ai").join("latest");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("AIInfo.lua"), CIRCUIT).unwrap();

        let found = skirmish_ais(&root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].0.lib, "CircuitAI|stable");
        assert_eq!(found[0].0.name, "CircuitAI");
        assert_eq!(found[0].0.source, "engine");
        assert!(found[0].0.desc.is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_name_carrying_the_wire_separator_is_not_offered() {
        /* `AiLib` is split on `|` by the server, so either half of a skirmish
           AI's name containing one names something else entirely - and a LuaAI
           containing one stops being a LuaAI at all. Neither could be launched,
           so neither belongs in a picker. */
        let root = temp("separator");
        let dir = root.join("AI").join("Skirmish").join("Odd").join("1");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("AIInfo.lua"),
            "return {\n  { key='shortName', value='Odd|AI' },\n  { key='version', value='1' },\n}\n",
        )
        .unwrap();
        assert!(skirmish_ais(&root).is_empty());

        let lua = [0x77; 16];
        pool_write(&root, lua, "return {\n  { name = 'A|B' },\n  { name = 'CAI' },\n}\n");
        write_package(&root, "zk.sdp", &[record("luaai.lua", lua, 10)]);
        let list = list_in(&root, "", None);
        assert_eq!(list.ais.len(), 1);
        assert_eq!(list.ais[0].lib, "CAI");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_folder_with_no_info_file_is_not_an_ai() {
        let root = temp("noinfo");
        std::fs::create_dir_all(root.join("AI").join("Skirmish").join("Empty").join("1")).unwrap();
        assert!(skirmish_ais(&root).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_unreadable_install_answers_with_a_note_rather_than_an_empty_list() {
        /* The caller reads "no AIs and a note" as "fall back to the built-in
           list", so the note is the whole contract. An empty picker is the one
           outcome that must not happen. */
        let root = temp("bare");
        let list = list_in(&root, "2025.06.21", Some("Zero-K v1.14.8.0"));
        assert!(list.ais.is_empty());
        assert!(list.note.is_some_and(|n| n.contains("built-in")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_games_ais_are_listed_even_with_no_engine_installed() {
        let root = temp("noengine");
        let lua = [0x5a; 16];
        pool_write(&root, lua, LUAAI);
        write_package(&root, "zk.sdp", &[record("luaai.lua", lua, 1306)]);

        let list = list_in(&root, "2025.06.21", None);
        assert_eq!(list.ais.len(), 9);
        assert_eq!(list.ais[0].lib, "CAI");
        assert!(list.ais.iter().all(|a| a.source == "game"));
        // And says why the engine's are missing rather than pretending.
        assert!(list.note.is_some_and(|n| n.contains("2025.06.21")));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Put a file where `install::find_engine` looks, so a test can have an
    /// engine tree on whichever platform it is running on.
    fn fake_engine(root: &Path, version: &str) -> PathBuf {
        let exe = install::engine_candidates(root, version).remove(0);
        let dir = exe.parent().expect("a candidate is always inside a directory").to_path_buf();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&exe, b"not an engine, but a file where one goes").unwrap();
        dir
    }

    fn put_skirmish_ai(engine_dir: &Path, name: &str, version: &str, info: &str) {
        let dir = engine_dir.join("AI").join("Skirmish").join(name).join(version);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("AIInfo.lua"), info).unwrap();
    }

    #[test]
    fn a_game_this_cannot_read_does_not_hide_the_engines_ais() {
        /* The one layout this module cannot open is the ordinary one for a
           Steam copy of Zero-K: the game is an `.sdz` under `games/` and there
           is no rapid package at all. That used to answer nothing, which meant
           CircuitAI - a directory sitting in the engine tree, needing no
           archive read to know it is installed - went unoffered on an install
           that has it. Only the game's half of the list is a guess. */
        let root = temp("steamish");
        std::fs::create_dir_all(root.join("games")).unwrap();
        std::fs::write(root.join("games").join("zk-v1.14.8.0.sdz"), b"PK").unwrap();
        let engine = fake_engine(&root, "2025.06.21");
        put_skirmish_ai(&engine, "CircuitAI", "stable", CIRCUIT);

        let list = list_in(&root, "2025.06.21", Some("Zero-K v1.14.8.0"));
        assert_eq!(list.game_archive, NO_ARCHIVE);
        assert_eq!(list.ais.len(), 1);
        assert_eq!(list.ais[0].lib, "CircuitAI|stable");
        assert_eq!(list.ais[0].source, "engine");
        // And the caller is told which half it has to stand in for.
        assert!(list.note.is_some_and(|n| n.contains("game archive")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn one_ai_declared_twice_is_one_row() {
        /* An engine directory left behind by an older install declares the
           same `ShortName|Version` as the one beside it, and a game archive
           can repeat a name. Two identical rows is the visible half; the
           caller keys its rows on `lib`, so the repeat is a duplicate key in a
           list being diffed, which is a bug with no symptom until it is one. */
        let root = temp("twice");
        let lua = [0x31u8; 16];
        pool_write(&root, lua, "return {\n  { name = 'CAI' },\n  { name = 'CAI' },\n}\n");
        write_package(&root, "zk.sdp", &[record("luaai.lua", lua, 10)]);
        let engine = fake_engine(&root, "2025.06.21");
        put_skirmish_ai(&engine, "CircuitAI", "stable", CIRCUIT);
        put_skirmish_ai(&engine, "circuit-ai", "old", CIRCUIT);

        let list = list_in(&root, "2025.06.21", None);
        assert_eq!(list.ais.iter().filter(|a| a.lib == "CAI").count(), 1);
        assert_eq!(list.ais.iter().filter(|a| a.lib == "CircuitAI|stable").count(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    // ------------------------------------------------------------- lua ---

    #[test]
    fn a_description_written_across_lines_is_still_a_description() {
        /* `[[ ]]` is how anybody writes a value with a line break in it, and
           an entry whose name was written that way used to vanish - which in a
           picker is indistinguishable from an AI that is not installed. */
        let text = "return {\n  { name = [[Long Name]], desc = [[\nfirst\nsecond]] },\n}\n";
        let entries = lua_entries(text);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].get("name").map(String::as_str), Some("Long Name"));
        // Lua drops the newline that opens the bracket and keeps the rest.
        assert_eq!(entries[0].get("desc").map(String::as_str), Some("first\nsecond"));
    }

    #[test]
    fn a_comment_between_a_key_and_its_value_is_not_the_end_of_the_entry() {
        let text = "return {\n  { name = --[[ which ]] 'CAI',\n    desc = -- why\n      'plays' },\n}\n";
        let entries = lua_entries(text);
        assert_eq!(entries[0].get("name").map(String::as_str), Some("CAI"));
        assert_eq!(entries[0].get("desc").map(String::as_str), Some("plays"));
    }

    #[test]
    fn a_numeric_escape_is_the_byte_it_names() {
        // `\65` is A. Copying the digits through put a number in a sentence.
        assert_eq!(unescape(r"\65\66\67"), "ABC");
        // Three digits at most, so the 4 here is a 4.
        assert_eq!(unescape(r"\0654"), "A4");
        assert_eq!(unescape(r"it\'s \\ fine\nhere"), "it's \\ fine\nhere");
        // Bytes, not characters: a two-byte character written as its bytes
        // has to come back out as that character.
        assert_eq!(unescape(r"\195\169"), "é");
    }

    #[test]
    fn a_note_is_one_line_because_it_sits_under_a_picker() {
        /* `install::detect` lists every directory it probed, one per line. In
           the caption under the picker those breaks collapse and it becomes a
           paragraph of paths. */
        assert_eq!(
            first_line("No Zero-K installation found.\nLooked in:\n  C:\\a\n  D:\\b"),
            "No Zero-K installation found."
        );
        let already = "D:\\games is not a Zero-K installation - no engine/ beside it.";
        assert_eq!(first_line(already), already);
    }
}
