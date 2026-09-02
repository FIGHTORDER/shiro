//! Reading Zero-K's galaxy campaign out of the `zkmenu` rapid package.
//!
//! The campaign is 73 planets of Lua, and the only honest way to read a Lua
//! table is to run Lua. So this module embeds an interpreter, executes the
//! planet files, and converts what they return to JSON. Everything after that
//! is ordinary data.
//!
//! ## Why the content is read and not generated
//!
//! Generating this at build time would be cheaper - run Lua once in CI, commit
//! the JSON, the way `gen-codex.mjs` does for units - and it is deliberately
//! not done, for two reasons that outlive the licensing question below.
//!
//! The player's own install is the newer copy. Zero-K ships campaign changes in
//! the `zkmenu` rapid package on its own schedule, and a player who has the new
//! planets should play the new planets rather than whatever CI last saw. Baking
//! the JSON in would pin the campaign to Shiro's release cadence.
//!
//! It is also not one campaign. The reader takes any package with this shape,
//! which is what lets a third-party campaign be read at all; a committed JSON
//! would only ever be Zero-K's.
//!
//! ## On shipping a copy
//!
//! An earlier version of this note said the content could not be bundled
//! because Chobby declares no licence. That was checked with Zero-K's
//! developers and is wrong: content in the Zero-K and infrastructure
//! repositories is open source, and Chobby has been shared and forked for long
//! enough that Zero-K itself builds on it. So a copy does ship, under
//! `src-tauri/resources/campaign`, and `tauri.conf.json` bundles it.
//!
//! It is a fallback, not the source: `campaign_source` prefers the player's
//! install and reaches for the bundled copy only when there is nothing to read.
//! That way a machine with no Zero-K still has a campaign to look at, and a
//! machine with Zero-K reads the version it actually has.
//!
//! ## The sandbox
//!
//! These files arrive over the network. They are data as far as Shiro is
//! concerned, but Lua cannot tell the difference between data and a program, so
//! the interpreter is stripped of everything that reaches outside itself before
//! any of it is loaded - no filesystem, no processes, no further loading. The
//! planet files need none of it: they set `LUA_DIRNAME` and touch `math`, and
//! nothing else.
//!
//! An unknown global is an error rather than `nil`. A planet that reaches for
//! `VFS` or `Spring` should stop the read and say so, because the alternative
//! is a field that silently becomes nothing and a mission that loads wrong.
//!
//! ## Threading
//!
//! `mlua::Lua` is not `Send`, and Tauri's async commands are. The way out is
//! not to fight it: **Lua runs once, inside one `spawn_blocking`, produces
//! JSON, and the interpreter is dropped before anything is returned.** No Lua
//! value is ever held across an await, stored in Tauri state, or shared between
//! threads. This is the same shape as `zks_list_replays`.

use std::cell::Cell;
use std::path::Path;
use std::rc::Rc;
use std::time::{Duration, Instant};

use mlua::{HookTriggers, Lua, Table, Value, VmState};
use serde_json::{Map, Value as Json};

use crate::install;
use crate::rapid;

/// What makes a package the campaign menu rather than the game.
///
/// The campaign's own loader, which is also `ENTRY`. There is no
/// `campaigndata.lua` - the directory holds `planetDefs`, `planetUtilities`,
/// `codex`, `unlocksList` and the rest - so a marker guessed from the name
/// would match nothing and report every install as having no campaign.
pub const MARKER: &str = ENTRY;

/// The file that builds the campaign.
///
/// `campaign/sample` is not a sample. It is the shipped Zero-K campaign and the
/// name is historical, which is worth writing down because the obvious reading
/// sends you looking for the real one somewhere else. There isn't one:
/// `ZeroK-RTS/Zero-K-Campaign` is an unrelated Ren'Py project.
///
/// This is upstream's own loader, run rather than reimplemented. It reads
///
/// ```lua
/// local planetUtilities = VFS.Include("campaign/sample/planetUtilities.lua")
/// for i = 1, N_PLANETS do
///     planets[i] = VFS.Include(".../planets/planet" .. i .. ".lua")(planetUtilities, i)
/// end
/// ```
///
/// which is the thing worth knowing about this format and the reason the first
/// attempt here failed: **a planet file returns a function, not a table.** It
/// has to be called with the utilities table and its own index, because a
/// planet reads its map position out of `planetUtilities.planetPositions[id]`.
/// Loading the files individually and expecting tables gets 71 planets that all
/// "did not return a table", and reimplementing the loop would mean owning a
/// copy of upstream's indexing rules forever.
///
/// Running `planetDefs.lua` instead also yields `planetAdjacency`,
/// `planetEdgeList`, `initialPlanets` and `startingPlanetMaps` - the galaxy
/// graph the map screen needs - which the per-planet loop would not.
const ENTRY: &str = "campaign/sample/planetdefs.lua";

/// The globals a planet file must not be able to reach.
const REMOVED: [&str; 8] =
    ["io", "os", "package", "require", "dofile", "loadfile", "load", "loadstring"];

/// How long a whole campaign read may take before it is abandoned.
///
/// The real package takes about half a second, so this is generous by twenty
/// times over. It is a wall clock rather than an instruction count because what
/// goes wrong is measured in wall clock: the tab spins and never stops.
const DEADLINE: Duration = Duration::from_secs(10);

/// How often the deadline is checked, in Lua instructions.
///
/// Small enough that a tight empty loop is caught in milliseconds, large enough
/// that the check is not the cost of the read.
const CHECK_EVERY: u32 = 100_000;

/// The most memory one read may hold.
///
/// `("x"):rep(2^30)` asks for a gigabyte in one call and gets an error here
/// instead of the host's allocator.
const MEMORY: usize = 256 * 1024 * 1024;

/// A fresh interpreter with the escape hatches removed.
///
/// `LUA_DIRNAME` is set because Chobby's own files read it to build paths, and
/// a nil there is a concatenation error rather than a missing feature.
///
/// The time and memory limits are here because this content arrives over the
/// network: it is fetched by rapid from a package the player's own install
/// pulled down, so it is not ours and it is not reviewed. Nothing it can do
/// reaches outside the interpreter, but `while true do end` costs nothing to
/// write and, unbounded, ends the read forever - the blocking thread never
/// returns, the campaign tab never stops spinning, and every retry pins another
/// thread. A refusal with a reason is the honest outcome.
fn sandbox() -> Result<Lua, String> {
    sandbox_until(Instant::now() + DEADLINE)
}

/// `sandbox`, with the deadline named, so a test can use a short one.
fn sandbox_until(until: Instant) -> Result<Lua, String> {
    let lua = Lua::new();
    lua.set_memory_limit(MEMORY).map_err(|e| e.to_string())?;

    lua.set_hook(HookTriggers::new().every_nth_instruction(CHECK_EVERY), move |_, _| {
        if Instant::now() >= until {
            return Err(mlua::Error::RuntimeError(format!(
                "the campaign took longer than {}s to read and was stopped",
                DEADLINE.as_secs()
            )));
        }
        Ok(VmState::Continue)
    })
    .map_err(|e| e.to_string())?;

    let globals = lua.globals();
    for gone in REMOVED {
        globals.set(gone, Value::Nil).map_err(|e| e.to_string())?;
    }
    globals.set("LUA_DIRNAME", "LuaMenu/").map_err(|e| e.to_string())?;
    Ok(lua)
}

/// Refuse an unknown global rather than handing back `nil`.
///
/// Without this a planet that expects `VFS` gets `nil`, indexes it, and either
/// errors somewhere confusing or - worse - takes a branch that quietly produces
/// an incomplete table. Failing at the name is the difference between "this
/// planet needs an engine global we do not provide" and a mission that loads
/// with no objectives.
fn strict_globals(lua: &Lua) -> Result<(), String> {
    let globals = lua.globals();
    let meta = lua.create_table().map_err(|e| e.to_string())?;
    let index = lua
        .create_function(|_, (_, key): (Table, String)| -> mlua::Result<Value> {
            Err(mlua::Error::RuntimeError(format!("unknown global `{key}`")))
        })
        .map_err(|e| e.to_string())?;
    meta.set("__index", index).map_err(|e| e.to_string())?;
    globals.set_metatable(Some(meta)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Is this table a Lua array?
///
/// Lua has one table type and uses it for both a record and a list, so nothing
/// in the value itself says which this is - `serde` cannot guess, which is why
/// `mlua`'s own serializer refuses a planet outright with *invalid type:
/// integer `3`, expected a string key*. The rule below is the one every Lua
/// serialiser settles on: keys `1..n` with nothing else means a list.
///
/// An empty table is a list. It has to be one or the other and `[]` survives a
/// round trip through JSON into either, where `{}` does not.
fn is_array(t: &Table) -> bool {
    let mut count = 0usize;
    for pair in t.clone().pairs::<Value, Value>() {
        let Ok((k, _)) = pair else { return false };
        match k {
            Value::Integer(i) if i >= 1 => count += 1,
            // A float key that is a whole number is how Lua 5.1 hands back an
            // integer written as `1.0`; treated the same.
            Value::Number(n) if n >= 1.0 && n.fract() == 0.0 => count += 1,
            _ => return false,
        }
    }
    // Consecutive from 1: the length operator agrees with the count only when
    // there are no holes, and a table with a hole is a map with integer keys.
    t.raw_len() == count
}

/// Lua value to JSON.
///
/// Functions are dropped. They appear inside `gameConfig` and they are
/// behaviour, not content - a screen has no use for one, and there is nothing
/// to put in the JSON that would be more honest than leaving the key out.
fn to_json(value: &Value, depth: usize) -> Result<Option<Json>, String> {
    // A table that contains itself is legal Lua and would otherwise recurse
    // until the stack ends. Nothing in the campaign is anywhere near this deep.
    if depth > 64 {
        return Err("nested deeper than 64 tables".into());
    }
    Ok(match value {
        Value::Nil => None,
        Value::Boolean(b) => Some(Json::Bool(*b)),
        Value::Integer(i) => Some(Json::from(*i)),
        Value::Number(n) => serde_json::Number::from_f64(*n).map(Json::Number),
        Value::String(s) => Some(Json::String(s.to_string_lossy())),
        Value::Table(t) => Some(table_to_json(t, depth)?),
        // Functions, threads, userdata: behaviour, not content.
        _ => None,
    })
}

fn table_to_json(t: &Table, depth: usize) -> Result<Json, String> {
    if is_array(t) {
        let mut out = Vec::new();
        for item in t.clone().sequence_values::<Value>() {
            let item = item.map_err(|e| e.to_string())?;
            // A nil inside a sequence cannot happen - it would end it - so this
            // only drops a function, and dropping one from a list would shift
            // every index after it. Null keeps the positions honest.
            out.push(to_json(&item, depth + 1)?.unwrap_or(Json::Null));
        }
        return Ok(Json::Array(out));
    }
    let mut out = Map::new();
    for pair in t.clone().pairs::<Value, Value>() {
        let (k, v) = pair.map_err(|e| e.to_string())?;
        let key = match &k {
            Value::String(s) => s.to_string_lossy(),
            Value::Integer(i) => i.to_string(),
            Value::Number(n) => n.to_string(),
            // A table or a function as a key has no JSON spelling and no
            // meaning to a screen.
            _ => continue,
        };
        if let Some(v) = to_json(&v, depth + 1)? {
            out.insert(key, v);
        }
    }
    Ok(Json::Object(out))
}

/// Where a campaign's files come from.
///
/// A closure rather than a path, because the same loader has to run over a
/// rapid package - where a file is a pool hash, not a file - and over a plain
/// directory, which is the only way to test this against real content that
/// must not live in this repository.
pub type Source = Rc<dyn Fn(&str) -> Option<String>>;

/// A campaign package on disk, addressed by name.
pub fn package_source(root: &Path, index: rapid::Index) -> Source {
    let root = root.to_path_buf();
    Rc::new(move |name: &str| rapid::file_text(&root, &index, name))
}

/// A plain directory rather than a package.
///
/// This is how the bundled campaign is read, and how the real-content test
/// reads a Chobby checkout. It was written as the hook for exactly this.
///
/// Case-insensitive, because the rapid index is folded and this has to answer
/// the same questions the same way. It matters: upstream writes
/// `planetDefs.lua` with a capital D and asks for it through a path this module
/// has already lowercased, so a literal read finds nothing on Linux and
/// everything on Windows - a difference that would show up as "no campaign in
/// this package" on exactly one of the two CI runners.
pub fn dir_source(dir: &Path) -> Source {
    let dir = dir.to_path_buf();
    Rc::new(move |name: &str| {
        // The names come from upstream's own `VFS.Include` calls, not from a
        // player, but they still end up joined onto a path - so a name that
        // climbs out of the campaign directory is refused rather than read.
        if name.split(['/', '\\']).any(|part| part == ".." || part.contains(':')) {
            return None;
        }
        let mut at = dir.clone();
        for part in name.split('/').filter(|p| !p.is_empty()) {
            at = fold_into(&at, part)?;
        }
        std::fs::read_to_string(at).ok()
    })
}

/// One path component, matched without regard to case.
fn fold_into(dir: &Path, want: &str) -> Option<std::path::PathBuf> {
    let exact = dir.join(want);
    if exact.exists() {
        return Some(exact);
    }
    let want = want.to_ascii_lowercase();
    std::fs::read_dir(dir).ok()?.flatten().find_map(|e| {
        (e.file_name().to_string_lossy().to_ascii_lowercase() == want).then(|| e.path())
    })
}

/// How deep `VFS.Include` may nest.
///
/// `planetDefs.lua` includes `planetUtilities.lua` and 71 planets, all at depth
/// one. Anything recursing past this is a file including itself.
const MAX_INCLUDE_DEPTH: usize = 8;

/// Give the sandbox the one capability the campaign actually needs.
///
/// `VFS.Include` is how every Chobby file loads another, and it is the reason
/// `require` and `dofile` can stay removed: this reaches only into the package,
/// resolves nothing from the filesystem, and cannot be pointed anywhere else.
///
/// Not memoised. Upstream includes `planetUtilities.lua` once and each planet
/// once, so a cache would buy nothing and would add a question - whether two
/// includes of one file are the same table - that nothing here depends on.
fn install_vfs(lua: &Lua, source: Source) -> Result<(), String> {
    let depth = Rc::new(Cell::new(0usize));
    let vfs = lua.create_table().map_err(|e| e.to_string())?;

    let include = lua
        .create_function(move |lua, (name, _env): (String, Option<Table>)| {
            if depth.get() >= MAX_INCLUDE_DEPTH {
                return Err(mlua::Error::RuntimeError(format!(
                    "VFS.Include nested deeper than {MAX_INCLUDE_DEPTH} at `{name}`"
                )));
            }
            let Some(text) = source(&name.to_ascii_lowercase()) else {
                // Loudly. A missing include that returned nil would become a
                // planet with no utilities and a screen with no positions.
                return Err(mlua::Error::RuntimeError(format!("no `{name}` in the package")));
            };
            depth.set(depth.get() + 1);
            let result: mlua::Result<Value> = lua.load(&text).set_name(&name).eval();
            depth.set(depth.get() - 1);
            result
        })
        .map_err(|e| e.to_string())?;

    vfs.set("Include", include).map_err(|e| e.to_string())?;
    lua.globals().set("VFS", vfs).map_err(|e| e.to_string())?;
    Ok(())
}

/// The one piece of Chobby the campaign content reaches for while it loads.
///
/// `planet12.lua` builds a field out of it:
///
/// ```lua
/// addPlayerUnlocks = (not WG.Chobby.Configuration:IsCurrentVersionNewerThan(105, 2000)) and { ... }
/// ```
///
/// which is a compatibility shim for engines older than 105.2000 - on an old
/// engine that planet hands the player a list of vehicles it otherwise does
/// not. So this is not decoration: leaving `WG` out changes what a planet
/// contains, and stubbing it wrongly gives one planet the wrong unlocks.
///
/// **Answering `true` means "the engine is newer than 105.2000".** Shiro does
/// not launch anything remotely that old, so `addPlayerUnlocks` is correctly
/// absent. If Shiro ever has to run a pre-105.2000 engine, this is the line
/// that has to learn about it.
///
/// Deliberately the only stub. `planet69.lua` also touches `WG`, but inside a
/// `completionFunction` that never runs while loading - and every other file
/// reaches for nothing, which is why `Spring` is still absent and still an
/// error. A blanket set of empty tables would turn the next global upstream
/// adds into a silent nil instead of a failure someone reads.
fn install_chobby_stub(lua: &Lua) -> Result<(), String> {
    let newer = lua
        .create_function(|_, (_self, _major, _minor): (Value, i64, i64)| Ok(true))
        .map_err(|e| e.to_string())?;

    let configuration = lua.create_table().map_err(|e| e.to_string())?;
    configuration.set("IsCurrentVersionNewerThan", newer).map_err(|e| e.to_string())?;
    let chobby = lua.create_table().map_err(|e| e.to_string())?;
    chobby.set("Configuration", configuration).map_err(|e| e.to_string())?;
    let wg = lua.create_table().map_err(|e| e.to_string())?;
    wg.set("Chobby", chobby).map_err(|e| e.to_string())?;
    lua.globals().set("WG", wg).map_err(|e| e.to_string())?;
    Ok(())
}

/// Read a whole campaign through upstream's own loader.
///
/// One interpreter for the whole read, not one per file: `planetDefs.lua` hands
/// the same `planetUtilities` table to all 71 planets, so they have to share a
/// state. They already do inside the game.
///
/// Blocking, and meant to be called inside `spawn_blocking`. The interpreter is
/// created and dropped entirely within this call - see the module header.
pub fn read_campaign_from(source: Source) -> Result<Json, String> {
    let lua = sandbox()?;
    install_vfs(&lua, source.clone())?;
    install_chobby_stub(&lua)?;
    strict_globals(&lua)?;

    let Some(text) = source(ENTRY) else {
        return Err("no campaign in this package".into());
    };
    let value: Value = lua
        .load(&text)
        .set_name(ENTRY)
        .eval()
        .map_err(|e| first_line(&e.to_string()))?;
    let Value::Table(_) = &value else {
        return Err("the campaign loader did not return a table".into());
    };
    let json = to_json(&value, 0)?.ok_or_else(|| "the campaign is empty".to_string())?;

    // The interpreter dies here, before anything is returned. Nothing below
    // this line is a Lua value.
    drop(lua);

    let count = json.get("planets").and_then(Json::as_array).map_or(0, Vec::len);
    if count == 0 {
        return Err("the campaign loaded but has no planets".into());
    }

    /* Carried alongside the planets so the interface can work out a commander
       level from experience without a second round trip. Absent rather than
       fatal: a campaign with no commander configuration still has planets to
       play, and the level simply stays where it is. */
    let mut json = json;
    if let (Some(obj), Ok(levels)) = (json.as_object_mut(), read_level_requirements(source)) {
        obj.insert("levelRequirement".into(), Json::from(levels));
    }
    Ok(json)
}

/// Where the game's full unit roster lives inside the package.
///
/// `LUA_DIRNAME` is `LuaMenu/`, so this is the path upstream's own
/// `VFS.Include` builds for `gameUnitInformation.lua`.
const UNIT_INFO: &str = "luamenu/configs/gameconfig/zk/gameunitinformation.lua";

/// Every unit name the game knows, in the order the menu lists them.
///
/// Needed to build a start script: CircuitAI takes a list of units to
/// *disable*, so naming the handful an AI may build means naming the several
/// hundred it may not. Without this the AI gets no restriction at all.
///
/// Read rather than derived from `codex.json`: the codex is generated from the
/// game archive at build time and lists what a player is shown, while this is
/// the list upstream itself diffs against. They are not guaranteed to be the
/// same set, and being wrong here shows up as an AI that can build something
/// the mission meant to withhold.
/// The campaign's commander configuration.
const COMM_CONFIG: &str = "campaign/sample/commconfig.lua";

/// Experience needed for each commander level, level 1 first.
///
/// The table is a local in `commConfig.lua` and only reachable through the
/// `GetLevelRequirement` function it returns, so this calls that function
/// rather than reading a field - a function is exactly what `to_json` drops.
///
/// Level 0 is free and is not in the list. The campaign's own curve is
/// 500 / 1200 / 2500 / 5000 / 8500 / 12000, and it is read rather than written
/// down here because it is campaign data: another campaign may pace it
/// differently, and a number copied into Rust would quietly stop matching.
pub fn read_level_requirements(source: Source) -> Result<Vec<i64>, String> {
    let lua = sandbox()?;
    install_vfs(&lua, source.clone())?;
    install_chobby_stub(&lua)?;
    strict_globals(&lua)?;

    let Some(text) = source(COMM_CONFIG) else {
        return Err("the package has no commConfig.lua".into());
    };
    let value: Value =
        lua.load(&text).set_name(COMM_CONFIG).eval().map_err(|e| first_line(&e.to_string()))?;
    let Value::Table(config) = value else {
        return Err("commConfig.lua did not return a table".into());
    };
    let get: mlua::Function = config
        .get("GetLevelRequirement")
        .map_err(|_| "commConfig.lua has no GetLevelRequirement".to_string())?;

    let mut out = Vec::new();
    /* Upwards until the campaign stops naming one. Bounded because this asks a
       function from the package how far to go, and a package should not be able
       to decide how long we loop. */
    for level in 1..=64i64 {
        match get.call::<Option<i64>>(level) {
            Ok(Some(need)) => out.push(need),
            _ => break,
        }
    }
    drop(lua);

    if out.is_empty() {
        return Err("commConfig.lua names no level requirements".into());
    }
    Ok(out)
}

pub fn read_unit_names(source: Source) -> Result<Vec<String>, String> {
    let lua = sandbox()?;
    install_vfs(&lua, source.clone())?;
    install_chobby_stub(&lua)?;
    strict_globals(&lua)?;

    let Some(text) = source(UNIT_INFO) else {
        return Err("the package has no gameUnitInformation.lua".into());
    };
    let value: Value =
        lua.load(&text).set_name(UNIT_INFO).eval().map_err(|e| first_line(&e.to_string()))?;
    let json = to_json(&value, 0)?.ok_or_else(|| "unit information is empty".to_string())?;
    drop(lua);

    let names: Vec<String> = json
        .get("nameList")
        .and_then(Json::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    if names.is_empty() {
        return Err("gameUnitInformation.lua lists no units".into());
    }
    Ok(names)
}

/// Read the campaign out of the newest installed `zkmenu` package under `root`.
pub fn read_campaign(root: &Path) -> Result<Json, String> {
    let Some((_, index)) = rapid::newest_with(root, MARKER) else {
        return Err("no campaign package installed".into());
    };
    read_campaign_from(package_source(root, index))
}

/// Where the copy that ships with Shiro lives, under the resource directory.
pub const BUNDLED: &str = "resources/campaign";

/// The campaign, from the player's own `zkmenu` if there is one, otherwise the
/// copy Shiro ships.
///
/// **The installed package wins.** Somebody running the Zero-K client has a
/// `zkmenu` that moves with the game, and theirs is newer than ours the day
/// after a release. Ours is the floor, not the ceiling: it exists so the tab is
/// there at all on a machine that has only ever run Shiro.
///
/// A failure to read an installed package is not swallowed - if their copy is
/// broken, that is worth saying rather than quietly showing different content
/// than the game will use.
pub fn read_campaign_or_bundled(root: &Path, bundled: Option<&Path>) -> Result<Json, String> {
    read_campaign_from(campaign_source(root, bundled)?)
}

/// Where the campaign is read from: their package if they have one, ours if not.
///
/// **Every caller goes through this.** Reading it and launching a mission both
/// need the files, and when launching built its own package source it errored
/// with "no campaign package installed" on a machine where the screen had just
/// finished drawing seventy-one planets out of the bundled copy. Two routes to
/// the same content is one route too many.
pub fn campaign_source(root: &Path, bundled: Option<&Path>) -> Result<Source, String> {
    if let Some((_, index)) = rapid::newest_with(root, MARKER) {
        return Ok(package_source(root, index));
    }
    match bundled.filter(|d| d.is_dir()) {
        Some(dir) => Ok(dir_source(dir)),
        None => Err("no campaign package installed".into()),
    }
}

/// The bundled campaign's directory, if this build carries one.
pub fn bundled_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    tauri::Manager::path(app)
        .resolve(BUNDLED, tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|d| d.is_dir())
}

/// Run one file and convert what it returns.
///
/// The converter's own entry point, exercised directly by the tests: the
/// list-versus-map rule is the part most likely to be quietly wrong, and
/// testing it through a whole campaign would hide which table went astray.
#[cfg(test)]
pub fn read_table(source_text: &str, chunk_name: &str) -> Result<Json, String> {
    let lua = sandbox()?;
    strict_globals(&lua)?;
    let value: Value = lua
        .load(source_text)
        .set_name(chunk_name)
        .eval()
        .map_err(|e| first_line(&e.to_string()))?;
    match &value {
        Value::Table(_) => to_json(&value, 0)?.ok_or_else(|| "returned nothing".to_string()),
        _ => Err("did not return a table".into()),
    }
}

/// Lua errors carry a traceback. The first line is the part a person reads.
fn first_line(message: &str) -> String {
    message.lines().next().unwrap_or(message).trim().to_string()
}

// ------------------------------------------------------------- the command ---

/// The campaign, once read, kept for the life of the process.
///
/// 1.4 MB of JSON and about half a second of Lua. The galaxy map asks for it on
/// every visit, and re-running an interpreter over 71 files to answer a screen
/// that has not changed would be the kind of slow that gets blamed on the map.
///
/// Not invalidated. The campaign changes when the player downloads a new
/// `zkmenu`, which they cannot do without restarting into it - and a stale
/// answer here would be a stale answer about content the running game is not
/// using either.
static CACHE: std::sync::OnceLock<std::sync::Mutex<Option<(std::path::PathBuf, Json)>>> =
    std::sync::OnceLock::new();

fn cache() -> &'static std::sync::Mutex<Option<(std::path::PathBuf, Json)>> {
    CACHE.get_or_init(|| std::sync::Mutex::new(None))
}

/// Read the galaxy campaign out of the installed `zkmenu` package.
///
/// Blocking work off the UI thread and plain data back, the same shape as
/// `zks_list_replays`. The interpreter lives and dies inside the blocking call
/// - see the module header for why that is the whole threading story.
#[tauri::command]
pub async fn zks_read_campaign(
    app: tauri::AppHandle,
    install_root: Option<String>,
) -> Result<Json, String> {
    // The detector's own message says where it looked, which is a better
    // answer than "no campaign" when the real problem is no Zero-K.
    let root = install::detect_with(install_root.as_deref())?.root;

    if let Ok(guard) = cache().lock() {
        if let Some((at, json)) = guard.as_ref() {
            if at == &root {
                return Ok(json.clone());
            }
        }
    }

    let reading = root.clone();
    /* Resolved out here: `AppHandle` is not `Send` on every platform and the
       blocking closure must not need one. */
    let bundled = bundled_dir(&app);
    let json = tauri::async_runtime::spawn_blocking(move || {
        read_campaign_or_bundled(&reading, bundled.as_deref())
    })
        .await
        .map_err(|e| format!("reading the campaign did not finish: {e}"))??;

    if let Ok(mut guard) = cache().lock() {
        *guard = Some((root, json.clone()));
    }
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_record_with_a_list_in_it_survives_the_round_trip() {
        // The shape the spec found: a planet is a map, its `tips` is an array,
        // and both are Lua tables. This is what mlua's own serializer refuses.
        let json = read_table(
            r#"return {
                 name = "Im Jaleth",
                 radius = 6550,
                 tips = { "one", "two", "three" },
                 mapDisplay = { x = 0.25, y = 0.75 },
               }"#,
            "planet1.lua",
        )
        .expect("reads");

        assert_eq!(json["name"], "Im Jaleth");
        assert_eq!(json["radius"], 6550);
        assert_eq!(json["tips"].as_array().expect("tips is a list").len(), 3);
        assert_eq!(json["tips"][2], "three");
        assert!(json["mapDisplay"].is_object(), "a record stays a record");
    }

    #[test]
    fn an_empty_table_becomes_a_list() {
        let json = read_table("return { tips = {} }", "t.lua").expect("reads");
        assert!(json["tips"].is_array());
    }

    #[test]
    fn a_table_with_a_hole_is_a_map_not_a_list() {
        // `{[1]="a",[3]="c"}` has no meaningful length. Calling it a list would
        // silently drop `c`.
        let json = read_table(r#"return { t = {[1]="a",[3]="c"} }"#, "t.lua").expect("reads");
        assert!(json["t"].is_object());
        assert_eq!(json["t"]["3"], "c");
    }

    #[test]
    fn functions_are_dropped_and_the_rest_of_the_table_is_kept() {
        let json = read_table(
            r#"return { gameConfig = { mapName = "Iced Coffee", onLoad = function() return 1 end } }"#,
            "t.lua",
        )
        .expect("reads");

        assert_eq!(json["gameConfig"]["mapName"], "Iced Coffee");
        assert!(json["gameConfig"].get("onLoad").is_none(), "behaviour, not content");
    }

    #[test]
    fn a_function_inside_a_list_keeps_the_positions() {
        let json = read_table(r#"return { t = {"a", function() end, "c"} }"#, "t.lua")
            .expect("reads");
        let list = json["t"].as_array().expect("a list");
        assert_eq!(list.len(), 3, "dropping it would shift `c` down one");
        assert_eq!(list[2], "c");
    }

    // ------------------------------------------------------- the sandbox ---

    #[test]
    fn the_filesystem_is_not_reachable() {
        for attempt in [
            r#"return { x = io.open("/etc/passwd") }"#,
            r#"return { x = os.getenv("HOME") }"#,
            r#"return { x = dofile("/etc/passwd") }"#,
            r#"return { x = require("os") }"#,
            r#"return { x = loadstring("return 1")() }"#,
        ] {
            let err = read_table(attempt, "hostile.lua").expect_err("must not run");
            assert!(
                err.contains("unknown global"),
                "{attempt} gave {err:?}, which is not a refusal"
            );
        }
    }

    #[test]
    fn an_unknown_global_stops_the_read_rather_than_becoming_nil() {
        let err = read_table(r#"return { x = VFS.LoadFile("x") }"#, "p.lua")
            .expect_err("must not be nil");
        assert!(err.contains("VFS"), "the message has to name it: {err}");
    }

    #[test]
    fn what_the_planets_actually_use_still_works() {
        // The two things the real files touch. If the sandbox took these away
        // it would be too tight to read the campaign at all.
        let json = read_table(
            r#"return { dir = LUA_DIRNAME, n = math.floor(1.5), s = string.upper("a") }"#,
            "p.lua",
        )
        .expect("reads");
        assert_eq!(json["dir"], "LuaMenu/");
        assert_eq!(json["n"], 1);
        assert_eq!(json["s"], "A");
    }

    #[test]
    fn a_file_that_is_not_a_table_is_an_error_with_a_readable_reason() {
        assert!(read_table("return 5", "p.lua").unwrap_err().contains("table"));
        assert!(read_table("this is not lua", "p.lua").is_err());
    }

    #[test]
    fn a_table_that_contains_itself_does_not_end_the_stack() {
        let err = read_table("local t = {} t.self = t return t", "p.lua")
            .expect_err("must be refused");
        assert!(err.contains("64"), "{err}");
    }

    // ---------------------------------------------------------- the names ---

    /// The copy that ships with Shiro, read the way the app reads it.
    ///
    /// Not ignored: the files are in this repository, so this runs everywhere
    /// including CI. That is the point - it is what catches a file left out of
    /// the bundle, and it catches it on Linux too, where a name whose case does
    /// not match is a different file rather than the same one.
    #[test]
    fn the_bundled_campaign_reads() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(BUNDLED);
        assert!(dir.is_dir(), "the bundled campaign is missing from {}", dir.display());

        let json = read_campaign_from(dir_source(&dir)).expect("the bundled campaign reads");
        let planets = json["planets"].as_array().expect("a list of planets");
        assert!(planets.len() >= 70, "expected the whole campaign, got {}", planets.len());

        // The fields every screen is built on, on every planet rather than the
        // first: a partial bundle reads fine until somebody scrolls.
        for (i, p) in planets.iter().enumerate() {
            assert!(p["name"].is_string(), "planet {} has no name", i + 1);
            assert!(p["mapDisplay"]["x"].is_number(), "planet {} has no position", i + 1);
            assert!(p["gameConfig"]["mapName"].is_string(), "planet {} names no map", i + 1);
        }

        /* Distinct positions. Every planet falls back to the same coordinate
           when `planetUtilities.planetPositions` is missing, so a bundle short
           of that one file still loads, still passes every other check, and
           draws the whole galaxy stacked on one point - which reads as an empty
           map rather than as an error. */
        let mut spots: Vec<String> = planets
            .iter()
            .map(|p| format!("{},{}", p["mapDisplay"]["x"], p["mapDisplay"]["y"]))
            .collect();
        println!("first five positions: {:?}", &spots[..5.min(spots.len())]);
        spots.sort();
        spots.dedup();
        assert!(
            spots.len() > planets.len() / 2,
            "only {} distinct positions for {} planets - they would draw on top of each other",
            spots.len(),
            planets.len()
        );

        /* The commander's experience curve, read out of `commConfig.lua` by
           calling its own function. Without it the interface cannot turn
           experience into a level, and the commander stays at 0 forever. */
        let levels: Vec<i64> = json["levelRequirement"]
            .as_array()
            .expect("no level requirements")
            .iter()
            .filter_map(serde_json::Value::as_i64)
            .collect();
        println!("level requirements: {levels:?}");
        assert!(levels.len() >= 5, "only {} levels", levels.len());
        assert!(levels.windows(2).all(|w| w[0] < w[1]), "the curve has to increase");
        assert_eq!(levels[0], 500, "the campaign's first level costs 500");

        /* The graph, which is what `planetDefs` is run for rather than read.
           Not `initialPlanets`: no planet file sets `startingPlanetCaptured`,
           so upstream leaves that empty and asserting on it tests this test
           rather than the campaign. */
        let edges = json["planetEdgeList"].as_array().expect("no galaxy graph");
        assert!(!edges.is_empty(), "the galaxy has no links between planets");
        let maps = json["startingPlanetMaps"].as_array().expect("no map list");
        assert!(!maps.is_empty(), "no planet names a map to fetch ahead of time");
    }

    #[test]
    fn the_source_falls_back_to_the_bundle_for_every_caller() {
        /* Reading the campaign and launching a planet both need the files.
           Launching used to resolve them separately and refused with "no
           campaign package installed" on a machine whose galaxy had just drawn
           seventy-one planets. One helper now, so they cannot disagree. */
        let empty = std::env::temp_dir().join("shiro-campaign-source");
        let _ = std::fs::remove_dir_all(&empty);
        std::fs::create_dir_all(&empty).unwrap();
        let bundled = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(BUNDLED);

        let source = campaign_source(&empty, Some(&bundled)).expect("the bundle answers");
        assert!(source(ENTRY).is_some(), "the source cannot reach the campaign");

        /* And with nothing anywhere, the message names the missing package.
           Matched rather than unwrapped: a `Source` is a boxed closure and has
           no `Debug`, which `unwrap_err` would require. */
        match campaign_source(&empty, None) {
            Ok(_) => panic!("a campaign appeared from nowhere"),
            Err(e) => assert!(e.contains("no campaign package"), "{e}"),
        }
        let _ = std::fs::remove_dir_all(&empty);
    }

    #[test]
    fn the_players_own_package_is_preferred_over_the_bundled_one() {
        /* Ours is the floor, not the ceiling. Somebody running the Zero-K
           client has a `zkmenu` that moves with their game, and theirs is
           newer than ours the day after a release. */
        let empty = std::env::temp_dir().join("shiro-campaign-no-package");
        let _ = std::fs::remove_dir_all(&empty);
        std::fs::create_dir_all(&empty).unwrap();
        let bundled = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(BUNDLED);

        // No package installed: the bundled copy answers.
        let json = read_campaign_or_bundled(&empty, Some(&bundled)).expect("the bundle answers");
        assert!(json["planets"].as_array().unwrap().len() >= 70);

        // And with neither, the message is about the package rather than us.
        let e = read_campaign_or_bundled(&empty, None).unwrap_err();
        assert!(e.contains("no campaign package"), "{e}");
        let _ = std::fs::remove_dir_all(&empty);
    }

    /// The real campaign, when someone points this at a checkout.
    ///
    /// Ignored by default: the campaign is not in this repository and must not
    /// be - see the module header. Run it with
    ///
    /// ```text
    /// SHIRO_CHOBBY=/path/to/Chobby cargo test --lib real_campaign -- --ignored --nocapture
    /// ```
    ///
    /// It is here rather than in a scratch directory because the sandbox is the
    /// kind of thing that passes every synthetic test and then meets a real
    /// planet that wants one more global. It did: the first version of this
    /// module expected each planet file to return a table, and all 71 returned
    /// a function instead.
    #[test]
    #[ignore = "needs a Chobby checkout; set SHIRO_CHOBBY"]
    fn real_campaign_loads() {
        let Ok(root) = std::env::var("SHIRO_CHOBBY") else { return };
        let json = read_campaign_from(dir_source(std::path::Path::new(&root)))
            .expect("the campaign reads");

        let planets = json["planets"].as_array().expect("a list of planets");
        println!("read {} planets", planets.len());
        println!("top level: {:?}", json.as_object().map(|o| o.keys().collect::<Vec<_>>()));
        println!("whole campaign as JSON: {} bytes", serde_json::to_vec(&json).unwrap().len());
        println!("planet 1 keys: {:?}", planets[0].as_object().map(|o| o.keys().collect::<Vec<_>>()));
        println!("planet 1 gameConfig: {:?}", planets[0]["gameConfig"].as_object().map(|o| o.keys().collect::<Vec<_>>()));
        assert!(planets.len() >= 70, "expected the whole campaign, got {}", planets.len());

        // Every planet has the fields the screens are built on.
        for (i, p) in planets.iter().enumerate() {
            assert!(p["name"].is_string(), "planet {} has no name", i + 1);
            assert!(p["mapDisplay"]["x"].is_number(), "planet {} has no position", i + 1);
            assert!(p["gameConfig"].is_object(), "planet {} has no gameConfig", i + 1);
        }

        // The galaxy graph, which is the reason for running planetDefs rather
        // than the planet files.
        assert!(json["planetEdgeList"].as_array().is_some_and(|e| !e.is_empty()));
        assert!(json["initialPlanets"].is_array() || json["initialPlanets"].is_object());

        // The spec's own finding, confirmed against the content: the script is
        // built from gameConfig, so "just use the provided startscript" is a
        // dead end. If this ever stops holding, the builder can be simpler.
        let provided = planets
            .iter()
            .filter(|p| p["gameConfig"]["missionStartscript"].as_str().is_some_and(|s| !s.is_empty()))
            .count();
        println!("planets shipping a startscript: {provided}");

        // Somewhere to look at it. The shape of `gameConfig` is what the start
        // script is built from, and reading it in a terminal beats guessing.
        if let Ok(to) = std::env::var("SHIRO_CAMPAIGN_DUMP") {
            std::fs::write(&to, serde_json::to_vec_pretty(&json).unwrap()).expect("dump");
            println!("dumped to {to}");
        }
    }

    #[test]
    fn a_planet_that_never_finishes_is_stopped() {
        /* The campaign is Lua fetched by rapid out of a package the player's
           own install pulled down - not ours, not reviewed. `while true do end`
           used to end the read permanently: the blocking thread never returned,
           the tab spun forever, and every retry pinned another thread. */
        let started = Instant::now();
        let lua = sandbox_until(started + Duration::from_millis(200)).expect("sandbox");
        let err = lua.load("while true do end").exec().expect_err("must not run forever");
        assert!(err.to_string().contains("was stopped"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(5), "the hook did not fire promptly");
    }

    #[test]
    fn a_planet_cannot_eat_the_hosts_memory() {
        // `("x"):rep(2^30)` asks for a gigabyte in one call.
        let lua = sandbox().expect("sandbox");
        let err = lua
            .load("local s = ('x'):rep(2 ^ 30)")
            .exec()
            .expect_err("must not be allowed to grow without bound");
        assert!(
            matches!(err, mlua::Error::MemoryError(_)) || err.to_string().contains("memory"),
            "{err}"
        );
    }

    #[test]
    fn an_include_cannot_climb_out_of_the_campaign_directory() {
        let source = dir_source(std::path::Path::new("/nowhere"));
        assert!(source("../../etc/passwd").is_none());
        assert!(source("campaign/sample/../../../etc/passwd").is_none());
    }

    #[test]
    fn a_missing_include_is_loud_rather_than_nil() {
        let empty: Source = Rc::new(|_| None);
        let err = read_campaign_from(empty).expect_err("must not be an empty campaign");
        assert!(err.contains("no campaign"), "{err}");
    }

    #[test]
    fn the_loader_runs_upstreams_own_shape() {
        // A miniature of planetDefs.lua: include a utilities file, call each
        // planet file with it, return the collection. If this passes and the
        // real one does not, the difference is content, not mechanism.
        let source: Source = Rc::new(|name: &str| match name {
            "campaign/sample/planetdefs.lua" => Some(
                r#"local u = VFS.Include("campaign/sample/planetUtilities.lua")
                   local planets = {}
                   for i = 1, 2 do
                     planets[i] = VFS.Include("campaign/sample/planets/planet" .. i .. ".lua")(u, i)
                   end
                   return { planets = planets, planetEdgeList = {{1, 2}} }"#
                    .into(),
            ),
            "campaign/sample/planetutilities.lua" => {
                Some("return { positions = {{0.1, 0.2}, {0.3, 0.4}} }".into())
            }
            n if n.starts_with("campaign/sample/planets/planet") => Some(
                r#"return function(u, id)
                     return { name = "Planet " .. id, x = u.positions[id][1] }
                   end"#
                    .into(),
            ),
            _ => None,
        });

        let json = read_campaign_from(source).expect("loads");
        let planets = json["planets"].as_array().expect("a list");
        assert_eq!(planets.len(), 2);
        assert_eq!(planets[0]["name"], "Planet 1");
        assert_eq!(planets[1]["x"], 0.3);
        assert_eq!(json["planetEdgeList"][0][1], 2);
    }

    #[test]
    fn an_include_that_includes_itself_stops() {
        let source: Source = Rc::new(|_: &str| {
            Some(r#"return VFS.Include("campaign/sample/planetdefs.lua")"#.into())
        });
        let err = read_campaign_from(source).expect_err("must stop");
        assert!(err.contains("nested"), "{err}");
    }
}
