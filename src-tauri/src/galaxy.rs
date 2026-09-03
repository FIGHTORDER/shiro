//! The galaxy campaign: what the player has done, and starting a mission.
//!
//! `campaignpack.rs` reads the content, `campaignscript.rs` turns one planet
//! into a start script, and this is the part that remembers - the save file,
//! and the commands the screens call.
//!
//! ## The save
//!
//! `api_campaign_data.lua` keeps 23 flat fields: maps of unlocked ids, lists of
//! ids, a few counters and one commander loadout. There is no graph and no
//! derived state, which is why the hardest-looking part of this port is
//! genuinely the easy one - it is a struct and a JSON file.
//!
//! Written to Shiro's own data directory, not into Zero-K's. A Chobby save and
//! a Shiro save are not interchangeable: the field names here are upstream's,
//! but the file is ours and nothing else reads it.
//!
//! ## What is deliberately not here
//!
//! Winning. The engine's exit code does not distinguish a victory from a
//! player quitting, and the campaign gadget writes its result into the game's
//! own save, not somewhere a lobby can see. `campaigns.rs` already settled this
//! for Splaunch missions - the player says whether they won - and the same
//! answer applies for the same reason.

use std::path::{Path, PathBuf};

use serde_json::Value as Json;
use tauri::{AppHandle, Manager, State};

use crate::campaignscript::{Commander, Context, Progression};
use crate::launch::Game;

/// The whole of a player's campaign.
///
/// The names are `api_campaign_data.lua`'s, so that anyone comparing this to
/// upstream is comparing like with like. `serde` defaults everywhere: a save
/// written before a field existed must load, because the alternative is a
/// player losing a campaign to a Shiro update.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Save {
    pub units_unlocked: Vec<String>,
    pub modules_unlocked: Vec<String>,
    pub abilities_unlocked: Vec<String>,
    pub codex_entries_unlocked: Vec<String>,
    pub codex_entry_read: Vec<String>,
    /// Planet id to the list of bonus objectives completed on it.
    pub bonus_objectives_complete: std::collections::BTreeMap<String, Vec<i64>>,
    /// Planet id to the difficulty it was beaten at.
    pub completion_difficulty: std::collections::BTreeMap<String, i64>,
    pub planets_captured: Vec<i64>,
    pub commander_experience: i64,
    /// 1 to 4. What the next mission is started at.
    pub difficulty_setting: i64,
    /// The easiest setting used so far, which is what upstream shows on a
    /// finished campaign - beating one planet on Easy marks the whole run.
    pub least_difficulty: i64,
    pub commander_level: i64,
    pub commander_name: String,
    pub commander_chassis: String,
    /// The modules fitted, by level. Passed through as the loadout screen
    /// leaves it.
    pub commander_loadout: Vec<String>,
    pub retinue: Option<Json>,
    pub total_play_frames: i64,
    pub victories: i64,
    pub initialization_complete: bool,
}

impl Default for Save {
    fn default() -> Self {
        Self {
            units_unlocked: Vec::new(),
            modules_unlocked: Vec::new(),
            abilities_unlocked: Vec::new(),
            codex_entries_unlocked: Vec::new(),
            codex_entry_read: Vec::new(),
            bonus_objectives_complete: Default::default(),
            completion_difficulty: Default::default(),
            planets_captured: Vec::new(),
            commander_experience: 0,
            // Normal. Upstream's own default, and the one a first mission is
            // balanced against.
            difficulty_setting: 2,
            least_difficulty: 4,
            commander_level: 1,
            commander_name: "Commander".into(),
            commander_chassis: "engineer".into(),
            commander_loadout: Vec::new(),
            retinue: None,
            total_play_frames: 0,
            victories: 0,
            initialization_complete: false,
        }
    }
}

impl Save {
    fn progression(&self) -> Progression {
        Progression {
            units_unlocked: self.units_unlocked.clone(),
            abilities_unlocked: self.abilities_unlocked.clone(),
            difficulty: self.difficulty_setting.clamp(1, 4),
            commander_level: self.commander_level.max(1),
            commander: Commander {
                name: self.commander_name.clone(),
                chassis: self.commander_chassis.clone(),
                decorations: Vec::new(),
                modules: self.commander_loadout.clone(),
            },
            retinue: self.retinue.clone(),
        }
    }
}

fn save_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no data directory: {e}"))?
        .join("campaign");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir.join("galaxy.json"))
}

/// Read the save, or start a new campaign.
///
/// A save that will not parse is replaced by a fresh one rather than refused.
/// The alternative is a campaign tab that shows an error and cannot be used at
/// all, which is a worse answer than a campaign that has forgotten - but the
/// unreadable file is moved aside first rather than left where it is. Every
/// command reads, changes and writes, so leaving it in place meant the next
/// difficulty change wrote a default save over the only copy and the campaign
/// was gone for good; set aside, it is still there to be looked at.
pub fn load(app: &AppHandle) -> Save {
    let Ok(path) = save_path(app) else { return Save::default() };
    let Ok(text) = std::fs::read_to_string(&path) else { return Save::default() };
    match serde_json::from_str(&text) {
        Ok(save) => save,
        Err(_) => {
            set_aside(&path);
            Save::default()
        }
    }
}

/// Move an unreadable save out of the way of the write that is about to happen.
///
/// Best effort: this runs on the path where the campaign is already in trouble,
/// and failing to rename is not a reason to refuse to open the tab. The
/// timestamp keeps a second bad save from overwriting the first.
fn set_aside(path: &Path) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let _ = std::fs::rename(path, path.with_extension(format!("json.bad-{stamp}")));
}

pub fn store(app: &AppHandle, save: &Save) -> Result<(), String> {
    let path = save_path(app)?;
    let text =
        serde_json::to_string_pretty(save).map_err(|e| format!("cannot write the save: {e}"))?;
    // Through a temporary file: a half-written save is a lost campaign, and
    // the window for one is exactly the moment a player closes the app.
    let temp = path.with_extension("json.part");
    std::fs::write(&temp, text).map_err(|e| format!("cannot write {}: {e}", temp.display()))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("cannot replace {}: {e}", path.display()))
}

// ------------------------------------------------------------- the commands ---

#[tauri::command]
pub async fn zks_galaxy_save(app: AppHandle) -> Save {
    load(&app)
}

/// Change the difficulty the next mission starts at.
#[tauri::command]
pub async fn zks_galaxy_set_difficulty(app: AppHandle, difficulty: i64) -> Result<Save, String> {
    let mut save = load(&app);
    save.difficulty_setting = difficulty.clamp(1, 4);
    store(&app, &save)?;
    Ok(save)
}

/// Record a finished mission.
///
/// The player says whether they won; see the module header. `bonus` is the
/// list of bonus objective indices they claim, which the screen offers from
/// the planet's own `bonusObjectiveConfig`.
#[tauri::command]
pub async fn zks_galaxy_finish(
    app: AppHandle,
    planet_id: i64,
    won: bool,
    bonus: Vec<i64>,
) -> Result<Save, String> {
    let mut save = load(&app);
    if !won {
        return Ok(save);
    }
    let key = planet_id.to_string();
    if !save.planets_captured.contains(&planet_id) {
        save.planets_captured.push(planet_id);
        save.planets_captured.sort_unstable();
        save.victories += 1;
    }
    let at = save.difficulty_setting.clamp(1, 4);
    // The best difficulty it has ever been beaten at, not the latest: replaying
    // a planet on Easy should not take away what beating it on Brutal earned.
    let best = save.completion_difficulty.entry(key.clone()).or_insert(at);
    *best = (*best).max(at);
    save.least_difficulty = save.least_difficulty.min(at);

    let done = save.bonus_objectives_complete.entry(key).or_default();
    for b in bonus {
        if !done.contains(&b) {
            done.push(b);
        }
    }
    done.sort_unstable();

    store(&app, &save)?;
    Ok(save)
}

/// Apply what a planet awards, once it has been captured.
///
/// `levels` is the experience curve the campaign reader hands the screen.
///
/// Kept apart from `zks_galaxy_finish` because the reward is the planet's data
/// and this module does not read the campaign - the screen has the planet in
/// hand and passes the lists, which is also what makes this testable without an
/// install.
#[tauri::command]
pub async fn zks_galaxy_unlock(
    app: AppHandle,
    units: Vec<String>,
    modules: Vec<String>,
    abilities: Vec<String>,
    codex: Vec<String>,
    experience: i64,
    levels: Vec<i64>,
) -> Result<Save, String> {
    let mut save = load(&app);
    add_new(&mut save.units_unlocked, units);
    add_new(&mut save.modules_unlocked, modules);
    add_new(&mut save.abilities_unlocked, abilities);
    add_new(&mut save.codex_entries_unlocked, codex);
    save.commander_experience += experience.max(0);
    save.commander_level = level_for(save.commander_experience, &levels).max(save.commander_level);
    store(&app, &save)?;
    Ok(save)
}

/// The level a commander with this much experience has reached.
///
/// `levels` is the campaign's own curve, level 1 first, straight out of
/// `commConfig.lua` - see `campaignpack::read_level_requirements`. Levels start
/// at 1 here and are written to a start script one lower, so an empty or
/// unreadable curve simply leaves the commander at 1 rather than guessing.
fn level_for(experience: i64, levels: &[i64]) -> i64 {
    1 + levels.iter().take_while(|&&need| experience >= need).count() as i64
}

/// Mark a codex entry as read.
#[tauri::command]
pub async fn zks_galaxy_read_codex(app: AppHandle, entry: String) -> Result<Save, String> {
    let mut save = load(&app);
    add_new(&mut save.codex_entry_read, vec![entry]);
    store(&app, &save)?;
    Ok(save)
}

/// Fit the commander. The loadout screen owns which modules are legal.
#[tauri::command]
pub async fn zks_galaxy_set_loadout(
    app: AppHandle,
    name: String,
    chassis: String,
    modules: Vec<String>,
    level: i64,
) -> Result<Save, String> {
    let mut save = load(&app);
    if !name.trim().is_empty() {
        save.commander_name = name.trim().to_string();
    }
    if !chassis.trim().is_empty() {
        save.commander_chassis = chassis.trim().to_string();
    }
    save.commander_loadout = modules;
    save.commander_level = level.max(1);
    store(&app, &save)?;
    Ok(save)
}

/// Throw the campaign away and start again.
#[tauri::command]
pub async fn zks_galaxy_restart(app: AppHandle) -> Result<Save, String> {
    let save = Save::default();
    store(&app, &save)?;
    Ok(save)
}

/// Add what is not already there, keeping the order things were earned in.
fn add_new(into: &mut Vec<String>, more: Vec<String>) {
    for item in more {
        if !into.contains(&item) {
            into.push(item);
        }
    }
}

/// Start a planet.
///
/// The whole chain: read the campaign, find the planet, check the map is
/// installed, build the script, hand it to the launcher.
#[tauri::command]
pub async fn zks_galaxy_play(
    app: AppHandle,
    game: State<'_, Game>,
    planet_id: i64,
    player: String,
    install_root: Option<String>,
) -> Result<u32, String> {
    let save = load(&app);
    let root = crate::install::detect_with(install_root.as_deref())?.root;

    let reading = root.clone();
    /* Resolved out here, where there is still an `AppHandle`: the blocking
       closure must not need one. */
    let bundled = crate::campaignpack::bundled_dir(&app);
    let (campaign, units) = tauri::async_runtime::spawn_blocking(move || {
        /* The same source the screen read from. Building a package source here
           instead is what made a planet refuse to start with "no campaign
           package installed" on a machine whose galaxy had just drawn. */
        /* `Some`, unlike the read path: starting a mission needs an engine and
           a game whatever the campaign came from, so this function has already
           refused without an install. */
        let source = crate::campaignpack::campaign_source(Some(&reading), bundled.as_deref())?;
        let campaign = crate::campaignpack::read_campaign_from(source.clone())?;
        // A missing roster is not fatal: it costs the AI its restrictions, and
        // a mission with an unrestricted enemy is still a mission. Said out
        // loud in the log rather than swallowed.
        let units = crate::campaignpack::read_unit_names(source).unwrap_or_else(|why| {
            eprintln!("campaign: no unit roster ({why}); AIs will not be restricted");
            Vec::new()
        });
        Ok::<_, String>((campaign, units))
    })
    .await
    .map_err(|e| format!("reading the campaign did not finish: {e}"))??;

    let planets = campaign
        .get("planets")
        .and_then(Json::as_array)
        .ok_or("the campaign has no planets")?;
    let index = usize::try_from(planet_id - 1).map_err(|_| "that is not a planet".to_string())?;
    let planet = planets.get(index).ok_or_else(|| format!("there is no planet {planet_id}"))?;

    let installed = crate::archives::installed(&root);
    let map_name = planet
        .pointer("/gameConfig/mapName")
        .and_then(Json::as_str)
        .ok_or_else(|| format!("planet {planet_id} names no map"))?;
    let map = installed.resolve(map_name).ok_or_else(|| {
        format!(
            "This mission needs the map {map_name}, which is not installed. \
             Play it once in a skirmish to download it, then try again."
        )
    })?;
    /* Whichever game this planet runs on, by the name the engine indexes it
       under: a start script naming anything else stops at an unknown game.
       Usually that is Zero-K, but a planet may name a mutator - and the name it
       writes is the one a person would say, not the archive's, which carries a
       version. Resolved here for the same reason and by the same rule as the
       map above; unresolved, the engine failed at start with nothing in the
       pre-flight to explain it. */
    let wanted_game = planet
        .pointer("/gameConfig/gameName")
        .and_then(Json::as_str)
        .unwrap_or("Zero-K");
    let zk = installed.resolve(wanted_game).ok_or_else(|| {
        if wanted_game.eq_ignore_ascii_case("Zero-K") {
            "No Zero-K is installed for the engine to run.".to_string()
        } else {
            format!(
                "This mission runs on {wanted_game}, which is not installed.                  It is a Zero-K mutator - play it once from the official lobby                  to download it, then try again."
            )
        }
    })?;

    let context = Context {
        player_name: player.trim().to_string(),
        game_name: zk,
        all_unit_names: units,
    };
    let mut script = crate::campaignscript::build(planet_id, planet, &save.progression(), &context)?;
    // The campaign names maps the way a person writes them; the engine wants
    // the archive's own name, which carries a version.
    script = script.replace(
        &format!("mapname = {map_name};"),
        &format!("mapname = {map};"),
    );

    let path = crate::launch::mission_script_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    std::fs::write(&path, script).map_err(|e| format!("could not write the mission: {e}"))?;
    crate::launch::launch_written_script(app.clone(), &game, &path, "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn experience_raises_the_commander_level() {
        /* The campaign's own curve, out of `commConfig.lua`. Nothing was
           raising the level: `zks_galaxy_unlock` banked the experience and only
           the loadout screen, which does not exist, ever wrote a level, so a
           commander stayed at 1 through the whole campaign. */
        let zk = [500, 1200, 2500, 5000, 8500, 12000];
        assert_eq!(level_for(0, &zk), 1);
        assert_eq!(level_for(499, &zk), 1, "one short is still level 1");
        assert_eq!(level_for(500, &zk), 2, "the threshold itself counts");
        assert_eq!(level_for(4999, &zk), 4);
        assert_eq!(level_for(12000, &zk), 7);
        assert_eq!(level_for(999_999, &zk), 7, "the curve ends");
    }

    #[test]
    fn an_unreadable_curve_leaves_the_level_alone() {
        // A package with no commConfig, rather than a guess at the numbers.
        assert_eq!(level_for(50_000, &[]), 1);
    }

    #[test]
    fn an_unreadable_save_is_moved_aside_rather_than_written_over() {
        /* Every command is read, change, write. Left in place, a save that will
           not parse was replaced by a default and then overwritten by the very
           next difficulty change - the campaign gone with no copy anywhere. */
        let dir = std::env::temp_dir().join("shiro-galaxy-bad");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp");
        let path = dir.join("galaxy.json");
        std::fs::write(&path, "{\"difficultySetting\": \"not a number\"}").expect("write");

        set_aside(&path);

        assert!(!path.exists(), "the bad save is still in the way of the next write");
        let kept: Vec<_> = std::fs::read_dir(&dir)
            .expect("read")
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(kept[0].starts_with("galaxy.json.bad-"), "{kept:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_campaign_starts_on_normal_with_nothing_unlocked() {
        let save = Save::default();
        assert_eq!(save.difficulty_setting, 2);
        assert_eq!(save.commander_level, 1);
        assert!(save.units_unlocked.is_empty());
        assert!(!save.initialization_complete);
    }

    #[test]
    fn the_progression_a_script_sees_is_the_save() {
        let mut save = Save::default();
        save.units_unlocked = vec!["cloakcon".into()];
        save.commander_level = 4;
        save.difficulty_setting = 3;
        save.commander_loadout = vec!["module_radarnet".into()];

        let prog = save.progression();
        assert_eq!(prog.units_unlocked, ["cloakcon"]);
        assert_eq!(prog.commander_level, 4);
        assert_eq!(prog.difficulty, 3);
        assert_eq!(prog.commander.modules, ["module_radarnet"]);
    }

    /// A hand-edited or out-of-range difficulty must not index off the end of
    /// the AI table, which is what `clamp` in `progression` is for.
    #[test]
    fn a_difficulty_out_of_range_is_brought_back_in() {
        let mut save = Save::default();
        save.difficulty_setting = 99;
        assert_eq!(save.progression().difficulty, 4);
        save.difficulty_setting = -3;
        assert_eq!(save.progression().difficulty, 1);
    }

    #[test]
    fn an_older_save_loads_with_the_fields_it_lacks_defaulted() {
        let save: Save = serde_json::from_str(r#"{"unitsUnlocked":["cloakcon"]}"#).expect("loads");
        assert_eq!(save.units_unlocked, ["cloakcon"]);
        assert_eq!(save.difficulty_setting, 2, "the default, not zero");
        assert_eq!(save.commander_chassis, "engineer");
    }

    #[test]
    fn a_save_survives_a_round_trip() {
        let mut save = Save::default();
        save.planets_captured = vec![1, 2];
        save.completion_difficulty.insert("1".into(), 3);
        let text = serde_json::to_string(&save).unwrap();
        let back: Save = serde_json::from_str(&text).unwrap();
        assert_eq!(back.planets_captured, [1, 2]);
        assert_eq!(back.completion_difficulty.get("1"), Some(&3));
    }

    #[test]
    fn adding_unlocks_keeps_the_order_and_does_not_duplicate() {
        let mut list = vec!["a".to_string()];
        add_new(&mut list, vec!["b".into(), "a".into(), "c".into()]);
        assert_eq!(list, ["a", "b", "c"]);
    }
}
