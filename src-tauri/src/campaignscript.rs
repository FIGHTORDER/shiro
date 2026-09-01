//! Turning one campaign planet into a Zero-K start script.
//!
//! A port of Chobby's `api_planet_battle_handler.lua` (`StartBattleForReal`),
//! plus the script writer in `liblobby/lobby/interface_skirmish.lua`. The
//! planets do not ship a script - `missionStartscript` is false on all 71 of
//! them - so there is nothing to use instead of building one.
//!
//! ## Why this is the risky part
//!
//! The mission runtime is a gadget that is already in every install:
//! `mission_galaxy_campaign_battle.lua` reads its whole configuration out of
//! modoptions. It does not validate them. A key that is missing, misspelled or
//! encoded wrongly produces a mission that *loads* and is quietly wrong - no
//! objectives, the wrong unlocks, an enemy with nothing disabled - rather than
//! an error anybody sees. So the fidelity of this module is the fidelity of the
//! feature, and everything below is written against upstream's source rather
//! than inferred from a working example.
//!
//! ## What the gadget is given
//!
//! Two kinds of value:
//!
//! - plain modoptions: `singleplayercampaignbattleid`, `planetmissiondifficulty`
//! - structured ones, which go through `customkey.rs`: the objective and defeat
//!   configs, the commander definitions, the unlock lists, the terraform.
//!
//! Per team, the gadget also reads `campaignunlocks`, `campaignabilities`,
//! `commanderparameters`, `midgameunits`, `extrastartunits_N`,
//! `retinuestartunits` and `typevictorylocation`.

use serde_json::{Map, Value as Json};

use crate::customkey::custom_key;

/// Start units are split into blocks of this many per key.
///
/// `extrastartunits_1`, `_2`, and so on. A start script value has a length
/// limit the engine will not tell you about, and one planet's opening base is
/// comfortably past it, so upstream chunks the list and the gadget reassembles
/// it. The number has to match: the gadget stops at the first missing block.
const START_UNITS_BLOCK_SIZE: usize = 40;

/// What the player has earned so far.
///
/// `api_campaign_data.lua` keeps 23 flat fields; these are the ones a start
/// script actually reads. The rest - codex entries read, play time, victories -
/// never leave the lobby, so they live in the save file and not here.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progression {
    pub units_unlocked: Vec<String>,
    pub abilities_unlocked: Vec<String>,
    /// 1 to 4. Indexes the AI difficulty table and is passed to the gadget,
    /// which uses it for `difficultyAtLeast` on start units.
    pub difficulty: i64,
    /// Shown 1-indexed, written 0-indexed. See `static_level` below.
    pub commander_level: i64,
    pub commander: Commander,
    /// Units that follow the commander between missions. Passed through as the
    /// campaign shapes it.
    pub retinue: Option<Json>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct Commander {
    pub name: String,
    pub chassis: String,
    #[serde(default)]
    pub decorations: Vec<String>,
    #[serde(default)]
    pub modules: Vec<String>,
}

/// The things that come from the installation rather than the campaign.
#[derive(Debug, Clone, Default)]
pub struct Context {
    pub player_name: String,
    /// The archive name the engine indexes Zero-K under, e.g. `Zero-K v1.14.8.0`.
    /// A script naming anything else stops at an unknown game.
    pub game_name: String,
    /// Every unit in the game, for `disabledunits`. Empty means the AI gets
    /// nothing disabled - see `circuit_disable_string`.
    pub all_unit_names: Vec<String>,
}

// ------------------------------------------------------------ the AI name ---

/// The engine-version prefix Zero-K's AI shortnames carry.
///
/// `aiPrefixFunc.lua` picks between three, by engine version. Shiro launches
/// nothing older than 105.2188, which is the same assumption `campaignpack`'s
/// `WG` stub makes, and both would have to change together.
const AI_PREFIX: &str = "1052188";

/// `circuitDifficulties` from the campaign's own `aiConfig.lua`.
const CIRCUIT: [&str; 4] = ["CircuitAIEasy", "CircuitAINormal", "CircuitAIHard", "CircuitAIBrutal"];

/// `circuitDifficultiesAlly`: an allied AI is a notch harder than an enemy one
/// at the same setting, because it is fighting alongside you rather than at you.
const CIRCUIT_ALLY: [&str; 4] =
    ["CircuitAINormal", "CircuitAIHard", "CircuitAIHard", "CircuitAIBrutal"];

/// Resolve `aiLib` the way `CampaignData.GetAI` does.
///
/// Two names are functions of the difficulty; everything else is already the
/// shortname and is passed through untouched, which is what upstream's
/// `or aiLibName` fallback does.
fn resolve_ai(ai_lib: &str, difficulty: i64) -> String {
    let pick = |table: &[&str; 4]| {
        let i = difficulty.clamp(1, 4) as usize - 1;
        format!("{AI_PREFIX}{}", table[i])
    };
    match ai_lib {
        "Circuit_difficulty_autofill" => pick(&CIRCUIT),
        "Circuit_difficulty_autofill_ally" => pick(&CIRCUIT_ALLY),
        other => other.to_string(),
    }
}

/// Everything the AI is *not* allowed to build, `+`-separated.
///
/// CircuitAI takes a disable list, not an enable list, so a mission that gives
/// an AI three units has to name the other several hundred. That is why the
/// full unit roster is needed here at all.
///
/// An empty roster returns `None` and the key is left out, matching upstream's
/// early `return nil` when the unit list is missing: an AI with nothing
/// disabled is wrong, but an AI with *everything* disabled cannot play at all.
fn circuit_disable_string(all_units: &[String], unlocked: &[String]) -> Option<String> {
    if all_units.is_empty() {
        return None;
    }
    let allowed: std::collections::HashSet<&str> = unlocked.iter().map(String::as_str).collect();
    let disabled: Vec<&str> =
        all_units.iter().map(String::as_str).filter(|u| !allowed.contains(u)).collect();
    if disabled.is_empty() {
        return None;
    }
    Some(disabled.join("+"))
}

// -------------------------------------------------------------- the script ---

/// A start script is sections and scalars, in the order they were added.
#[derive(Debug, Default, Clone)]
pub struct Section {
    entries: Vec<(String, Entry)>,
}

#[derive(Debug, Clone)]
enum Entry {
    Value(String),
    Table(Section),
}

impl Section {
    fn set(&mut self, key: &str, value: impl Into<String>) {
        self.entries.push((key.to_string(), Entry::Value(value.into())));
    }

    /// Set only if there is something to set.
    ///
    /// This is the shape of every optional key in the script, and it matters
    /// more than it looks: upstream writes `nil`, which makes the key vanish,
    /// and a key present-but-empty is a different thing to the gadget than a
    /// key that is absent.
    fn maybe(&mut self, key: &str, value: Option<String>) {
        if let Some(v) = value {
            self.set(key, v);
        }
    }

    fn table(&mut self, key: &str, section: Section) {
        self.entries.push((key.to_string(), Entry::Table(section)));
    }

    fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// Render, exactly as `InterfaceSkirmish:MakeScriptTXT` does.
///
/// Tables first and scalars after - upstream says "purely for aesthetics", and
/// it is kept because a script that differs from the one the game writes is a
/// script nobody can diff against a working one.
pub fn render(root: &Section) -> String {
    let mut out = String::from("[Game]\n{\n\n");
    for (key, entry) in &root.entries {
        if let Entry::Table(section) = entry {
            write_table(&mut out, key, section);
        }
    }
    for (key, entry) in &root.entries {
        if let Entry::Value(value) = entry {
            out.push('\t');
            out.push_str(key);
            out.push_str(" = ");
            out.push_str(value);
            out.push_str(";\n");
        }
    }
    out.push('}');
    fix_script(&out)
}

/// Nested tables are written at the same indent as their parent, because that
/// is what upstream's `WriteTable` does - it recurses without deepening the
/// tabs. The engine's parser counts braces, not whitespace.
fn write_table(out: &mut String, key: &str, section: &Section) {
    out.push_str("\t[");
    out.push_str(key);
    out.push_str("]\n\t{\n");
    for (k, entry) in &section.entries {
        match entry {
            Entry::Table(inner) => write_table(out, k, inner),
            Entry::Value(v) => {
                out.push_str("\t\t");
                out.push_str(k);
                out.push_str(" = ");
                out.push_str(v);
                out.push_str(";\n");
            }
        }
    }
    out.push_str("\t}\n\n");
}

/// `InterfaceSkirmish:FixScript`: collapse any run of `]]` down to one `]`.
///
/// A defensive scrub upstream applies to the whole script, because a stray
/// `]]` closes a section early and the engine then reads the rest of the file
/// as garbage. Nothing this module writes can contain one - the custom keys are
/// base64, whose alphabet has no brackets - but it is replicated because the
/// point of this module is to produce what the game produces.
fn fix_script(s: &str) -> String {
    let mut out = s.to_string();
    while out.contains("]]") {
        out = out.replace("]]", "]");
    }
    out
}

// --------------------------------------------------------------- building ---

fn strings(value: Option<&Json>) -> Vec<String> {
    value
        .and_then(Json::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// A commander as the `commandertypes` modoption wants it.
///
/// `modules` is wrapped in `{[0] = ...}`: the game keys modules by commander
/// level, and everything a start script defines is level zero.
fn commander_type(name: &str, chassis: &str, decorations: &[String], modules: &[String]) -> Json {
    let mut modules_by_level = Map::new();
    modules_by_level.insert("0".into(), Json::from(modules.to_vec()));
    let mut out = Map::new();
    out.insert("name".into(), Json::from(name));
    out.insert("chassis".into(), Json::from(chassis));
    out.insert("decorations".into(), Json::from(decorations.to_vec()));
    out.insert("modules".into(), Json::Object(modules_by_level));
    Json::Object(out)
}

/// `AddStartUnits`: chunk a unit list into numbered custom keys.
fn add_start_units(into: &mut Section, units: Option<&Json>, prefix: &str) {
    let Some(list) = units.and_then(Json::as_array) else { return };
    if list.is_empty() {
        return;
    }
    for (block, chunk) in list.chunks(START_UNITS_BLOCK_SIZE).enumerate() {
        let value = Json::Array(chunk.to_vec());
        into.maybe(&format!("{prefix}{}", block + 1), custom_key(&value));
    }
}

/// Build the start script for one planet.
///
/// `planet` is a planet as `campaignpack` produces it, and `planet_id` is its
/// 1-based index - the same number the gadget is told, and the one the campaign
/// uses to identify a mission.
pub fn build(
    planet_id: i64,
    planet: &Json,
    prog: &Progression,
    ctx: &Context,
) -> Result<String, String> {
    let game_config = planet
        .get("gameConfig")
        .and_then(Json::as_object)
        .ok_or_else(|| format!("planet {planet_id} has no gameConfig"))?;
    let player_config = game_config
        .get("playerConfig")
        .and_then(Json::as_object)
        .ok_or_else(|| format!("planet {planet_id} has no playerConfig"))?;
    let map_name = game_config
        .get("mapName")
        .and_then(Json::as_str)
        .ok_or_else(|| format!("planet {planet_id} names no map"))?;

    let difficulty = prog.difficulty.clamp(1, 4);
    let mut commander_types = Map::new();
    let mut root = Section::default();
    let mut ai_count = 0usize;
    let mut team_count = 0usize;
    let mut ally_teams: std::collections::BTreeSet<i64> = Default::default();

    // ------------------------------------------------------------ player ---

    let mut player = Section::default();
    player.set("Name", &*ctx.player_name);
    player.set("Team", "0");
    player.set("IsFromDemo", "0");
    player.set("rank", "0");
    root.table("player0", player);

    commander_types.insert(
        "player_commander".into(),
        commander_type(
            &prog.commander.name,
            &prog.commander.chassis,
            &prog.commander.decorations,
            &prog.commander.modules,
        ),
    );

    // What the player may build: everything unlocked so far, plus this
    // planet's extras, then narrowed by the planet's own lists. The whitelist
    // is applied before the blacklist, matching upstream's order - a unit in
    // both is excluded.
    let mut unlocks = prog.units_unlocked.clone();
    for extra in strings(player_config.get("extraUnlocks")) {
        if !unlocks.contains(&extra) {
            unlocks.push(extra);
        }
    }
    if let Some(white) = player_config.get("unitWhitelist").and_then(Json::as_object) {
        unlocks.retain(|u| white.contains_key(u));
    }
    if let Some(black) = player_config.get("unitBlacklist").and_then(Json::as_object) {
        unlocks.retain(|u| !black.contains_key(u));
    }
    let mut abilities = prog.abilities_unlocked.clone();
    for extra in strings(player_config.get("extraAbilities")) {
        if !abilities.contains(&extra) {
            abilities.push(extra);
        }
    }

    let player_ally = player_config.get("allyTeam").and_then(Json::as_i64).unwrap_or(0);
    ally_teams.insert(player_ally);

    let mut team = Section::default();
    team.set("TeamLeader", "0");
    team.set("AllyTeam", player_ally.to_string());
    team.set("rgbcolor", "0 0 0");
    team.maybe("start_x", number_of(player_config.get("startX")));
    team.maybe("start_z", number_of(player_config.get("startZ")));
    team.maybe("start_metal", number_of(player_config.get("startMetal")));
    team.maybe("start_energy", number_of(player_config.get("startEnergy")));
    team.set("staticcomm", "player_commander");
    // Shown 1-indexed on the loadout screen, written 0-indexed here.
    team.set("static_level", (prog.commander_level - 1).max(0).to_string());
    team.maybe("campaignunlocks", custom_key(&Json::from(unlocks.clone())));
    team.maybe("campaignabilities", custom_key(&Json::from(abilities)));
    team.maybe("campaignunitwhitelist", opt_key(player_config.get("unitWhitelist")));
    team.maybe("campaignunitblacklist", opt_key(player_config.get("unitBlacklist")));
    team.maybe("commanderparameters", opt_key(player_config.get("commanderParameters")));
    team.maybe("midgameunits", opt_key(player_config.get("midgameUnits")));
    team.maybe("retinuestartunits", prog.retinue.as_ref().and_then(custom_key));
    team.maybe("typevictorylocation", opt_key(player_config.get("typeVictoryAtLocation")));
    add_start_units(&mut team, player_config.get("startUnits"), "extrastartunits_");
    root.table("team0", team);
    team_count += 1;

    // --------------------------------------------------------------- AIs ---

    let ai_config = game_config.get("aiConfig").and_then(Json::as_array).cloned().unwrap_or_default();
    for ai_data in &ai_config {
        let Some(ai) = ai_data.as_object() else { continue };
        let ai_lib = ai.get("aiLib").and_then(Json::as_str).unwrap_or_default();
        let short_name = resolve_ai(ai_lib, difficulty);
        // `bitDependant` used to choose between a 32- and a 64-bit build.
        // Everything Shiro can launch is 64-bit, so the suffix is constant.
        let short_name = if ai.get("bitDependant").and_then(Json::as_bool).unwrap_or(false) {
            format!("{short_name}64")
        } else {
            short_name
        };

        // The AI's buildable set: its own unlocks, plus what this difficulty
        // adds, plus any of the player's unlocks it is told to mirror.
        let mut available = strings(ai.get("unlocks"));
        if let Some(extra) = ai
            .get("difficultyDependantUnlocks")
            .and_then(Json::as_object)
            .and_then(|m| m.get(&difficulty.to_string()))
        {
            available.extend(strings(Some(extra)));
        }
        for mirrored in strings(ai.get("addPlayerUnlocks")) {
            if unlocks.contains(&mirrored) {
                available.push(mirrored);
            }
        }

        let mut ai_section = Section::default();
        ai_section.maybe(
            "Name",
            ai.get("humanName").and_then(Json::as_str).map(str::to_string),
        );
        ai_section.set("Team", team_count.to_string());
        ai_section.set("IsFromDemo", "0");
        ai_section.set("ShortName", &*short_name);
        ai_section.set("comm_merge", "0");
        ai_section.set("version", "stable");
        ai_section.set("Host", "0");
        let mut options = Section::default();
        options.set("comm_merge", "0");
        options.maybe("disabledunits", circuit_disable_string(&ctx.all_unit_names, &available));
        ai_section.table("Options", options);
        root.table(&format!("ai{ai_count}"), ai_section);
        ai_count += 1;

        let mut commander_name = None;
        if let Some(commander) = ai.get("commander").and_then(Json::as_object) {
            let named = format!("ai_commander_{ai_count}");
            commander_types.insert(
                named.clone(),
                commander_type(
                    commander.get("name").and_then(Json::as_str).unwrap_or_default(),
                    commander.get("chassis").and_then(Json::as_str).unwrap_or_default(),
                    &strings(commander.get("decorations")),
                    &strings(commander.get("modules")),
                ),
            );
            commander_name = Some(named);
        }

        let ally = ai.get("allyTeam").and_then(Json::as_i64).unwrap_or(1);
        ally_teams.insert(ally);

        let mut ai_team = Section::default();
        ai_team.set("TeamLeader", "0");
        ai_team.set("AllyTeam", ally.to_string());
        ai_team.set("rgbcolor", "0 0 0");
        ai_team.maybe("start_x", number_of(ai.get("startX")));
        ai_team.maybe("start_z", number_of(ai.get("startZ")));
        match &commander_name {
            Some(name) => ai_team.set("staticcomm", &**name),
            // `commander = false` on an AI means it fields none at all.
            None => ai_team.set("nocommander", "1"),
        }
        ai_team.maybe("start_metal", number_of(ai.get("startMetal")));
        ai_team.maybe("start_energy", number_of(ai.get("startEnergy")));
        let level = ai.get("commanderLevel").and_then(Json::as_i64).unwrap_or(1);
        ai_team.set("static_level", (level - 1).max(0).to_string());
        ai_team.maybe("commanderparameters", opt_key(ai.get("commanderParameters")));
        ai_team.maybe("midgameunits", opt_key(ai.get("midgameUnits")));
        ai_team.maybe("typevictorylocation", opt_key(ai.get("typeVictoryAtLocation")));
        add_start_units(&mut ai_team, ai.get("startUnits"), "extrastartunits_");
        root.table(&format!("team{team_count}"), ai_team);
        team_count += 1;
    }

    for ally in &ally_teams {
        let mut section = Section::default();
        section.set("numallies", "0");
        root.table(&format!("allyTeam{ally}"), section);
    }

    // --------------------------------------------------------- modoptions ---

    let mut modoptions = Section::default();
    modoptions.maybe("commandertypes", custom_key(&Json::Object(commander_types)));
    modoptions.maybe("defeatconditionconfig", opt_key(game_config.get("defeatConditionConfig")));
    modoptions.maybe("objectiveconfig", opt_key(game_config.get("objectiveConfig")));
    modoptions.maybe("bonusobjectiveconfig", opt_key(game_config.get("bonusObjectiveConfig")));
    modoptions.maybe("featurestospawn", opt_key(game_config.get("initialWrecks")));
    modoptions.maybe("planetmissioninformationtext", custom_key(&briefing(planet)));
    modoptions
        .maybe("planetmissionnewtonfirezones", opt_key(player_config.get("newtonFirezones")));
    modoptions.set("fixedstartpos", "1");
    modoptions.set(
        "init_terra_save_fix",
        if game_config.get("initTerraSaveFix").and_then(Json::as_bool).unwrap_or(false) {
            "1"
        } else {
            "0"
        },
    );
    modoptions.set("planetmissiondifficulty", difficulty.to_string());
    modoptions.set("singleplayercampaignbattleid", planet_id.to_string());
    modoptions.maybe("initalterraform", opt_key(game_config.get("terraform")));
    modoptions.maybe("planetmissionmapmarkers", opt_key(game_config.get("mapMarkers")));
    add_start_units(&mut modoptions, game_config.get("neutralUnits"), "neutralstartunits_");

    // The planet's own modoptions win over everything above, and a table one
    // is encoded on the way in.
    for (key, value) in game_config.get("modoptions").and_then(Json::as_object).into_iter().flatten()
    {
        modoptions.maybe(key, scalar_or_key(value));
    }
    // Then the difficulty-specific ones, which win over those.
    if let Some(by_difficulty) = game_config
        .get("modoptionDifficulties")
        .and_then(Json::as_object)
        .and_then(|m| m.get(&difficulty.to_string()))
        .and_then(Json::as_object)
    {
        for (key, value) in by_difficulty {
            modoptions.maybe(key, scalar_or_key(value));
        }
    }
    if !modoptions.is_empty() {
        root.table("modoptions", modoptions);
    }

    // ------------------------------------------------------------- scalars ---

    let game_type =
        game_config.get("gameName").and_then(Json::as_str).unwrap_or(&ctx.game_name).to_string();
    root.set("gametype", game_type);
    root.set("mapname", map_name);
    root.set("myplayername", &*ctx.player_name);
    root.set("nohelperais", "0");
    root.set("numplayers", "1");
    root.set("numusers", (1 + ai_count).to_string());
    // "Choose" - required, or a map with no defined start positions crashes.
    root.set("startpostype", "2");
    root.set("GameStartDelay", "0");
    // Added by `StartGameFromLuaScript` on the way to the engine, not by the
    // battle handler. Shiro writes a file instead of calling Spring.Reload, so
    // they have to be put in here.
    root.set("hostip", "127.0.0.1");
    root.set("hostport", "0");
    root.set("ishost", "1");

    Ok(render(&root))
}

/// The briefing the loading screen shows.
fn briefing(planet: &Json) -> Json {
    let info = planet.get("infoDisplay");
    let mut out = Map::new();
    if let Some(name) = planet.get("name") {
        out.insert("name".into(), name.clone());
    }
    // `extendedText` when the planet has one, the short text otherwise.
    let description = info
        .and_then(|i| i.get("extendedText"))
        .or_else(|| info.and_then(|i| i.get("text")));
    if let Some(d) = description {
        out.insert("description".into(), d.clone());
    }
    if let Some(tips) = planet.get("tips") {
        out.insert("tips".into(), tips.clone());
    }
    Json::Object(out)
}

/// `UsefulTableToCustomKey` on something that may not be there.
fn opt_key(value: Option<&Json>) -> Option<String> {
    value.and_then(custom_key)
}

/// A modoption is written as-is when it is a scalar and encoded when it is a
/// table, which is upstream's rule for the planet's own `modoptions` block.
fn scalar_or_key(value: &Json) -> Option<String> {
    match value {
        Json::Null => None,
        Json::String(s) => Some(s.clone()),
        Json::Number(n) => Some(n.to_string()),
        // The script writer concatenates values into text, so a Lua boolean
        // would have been an error there. Upstream's modoptions are 0/1.
        Json::Bool(b) => Some(if *b { "1".into() } else { "0".into() }),
        table => custom_key(table),
    }
}

/// A number as the script should spell it, or nothing.
fn number_of(value: Option<&Json>) -> Option<String> {
    value.and_then(Json::as_f64).map(|f| {
        if f.fract() == 0.0 { format!("{}", f as i64) } else { f.to_string() }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ctx() -> Context {
        Context {
            player_name: "Sam".into(),
            game_name: "Zero-K v1.14.8.0".into(),
            all_unit_names: ["cloakcon", "staticmex", "energysolar", "turretlaser"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        }
    }

    fn prog() -> Progression {
        Progression {
            units_unlocked: vec!["cloakcon".into(), "staticmex".into()],
            abilities_unlocked: vec!["ability_teleport".into()],
            difficulty: 2,
            commander_level: 3,
            commander: Commander {
                name: "Sam".into(),
                chassis: "engineer".into(),
                decorations: vec![],
                modules: vec!["commweapon_lparticlebeam".into()],
            },
            retinue: None,
        }
    }

    fn planet() -> Json {
        json!({
            "name": "Im Jaleth",
            "tips": ["Build metal extractors."],
            "infoDisplay": { "text": "A short brief.", "extendedText": "A longer brief." },
            "gameConfig": {
                "mapName": "Iced Coffee",
                "missionStartscript": false,
                "playerConfig": {
                    "allyTeam": 0, "startX": 100, "startZ": 200,
                    "startMetal": 500, "startEnergy": 500,
                    "commanderParameters": { "facplop": true },
                    "extraUnlocks": ["energysolar"],
                },
                "aiConfig": [{
                    "aiLib": "Circuit_difficulty_autofill",
                    "bitDependant": true,
                    "allyTeam": 1,
                    "humanName": "Enemy",
                    "startX": 4000, "startZ": 75,
                    "startMetal": 0, "startEnergy": 100,
                    "commanderLevel": 2,
                    "commander": { "name": "Foe", "chassis": "engineer",
                                   "decorations": ["skin_support_dark"], "modules": [] },
                    "unlocks": ["cloakcon"],
                    "difficultyDependantUnlocks": { "2": ["staticmex"] },
                    "startUnits": [{ "name": "staticmex", "x": 1, "z": 2, "facing": 0 }],
                }],
                "defeatConditionConfig": [{ "vitalCommanders": true }],
                "objectiveConfig": [{ "description": "Win." }],
            },
        })
    }

    /// Parse the script back into sections, so the tests assert on structure
    /// rather than on whitespace.
    fn parse(script: &str) -> std::collections::HashMap<String, Vec<(String, String)>> {
        let mut out: std::collections::HashMap<String, Vec<(String, String)>> = Default::default();
        let mut stack: Vec<String> = vec!["".into()];
        for line in script.lines() {
            let line = line.trim();
            if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
                stack.push(name.to_string());
            } else if line == "}" {
                stack.pop();
            } else if let Some((k, v)) = line.trim_end_matches(';').split_once(" = ") {
                let here = stack.last().cloned().unwrap_or_default();
                out.entry(here).or_default().push((k.trim().into(), v.trim().into()));
            }
        }
        out
    }

    /// A key out of one section. The root scalars live inside `[Game]`, so
    /// that is the section they are asked for by name.
    fn get(script: &str, section: &str, key: &str) -> Option<String> {
        parse(script)
            .get(section)?
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
    }

    #[test]
    fn the_gadget_is_told_which_mission_and_how_hard() {
        let s = build(12, &planet(), &prog(), &ctx()).expect("builds");
        assert_eq!(get(&s, "modoptions", "singleplayercampaignbattleid").as_deref(), Some("12"));
        assert_eq!(get(&s, "modoptions", "planetmissiondifficulty").as_deref(), Some("2"));
        assert_eq!(get(&s, "modoptions", "fixedstartpos").as_deref(), Some("1"));
        assert_eq!(get(&s, "Game", "mapname").as_deref(), Some("Iced Coffee"));
        assert_eq!(get(&s, "Game", "gametype").as_deref(), Some("Zero-K v1.14.8.0"));
        assert_eq!(get(&s, "Game", "startpostype").as_deref(), Some("2"));
        assert_eq!(get(&s, "Game", "myplayername").as_deref(), Some("Sam"));
        assert_eq!(get(&s, "Game", "ishost").as_deref(), Some("1"));
    }

    #[test]
    fn the_structured_configs_decode_back_to_what_went_in() {
        let s = build(1, &planet(), &prog(), &ctx()).expect("builds");
        let decode = |key: &str| {
            let raw = get(&s, "modoptions", key).expect(key);
            let bytes = base64::Engine::decode(
                &base64::engine::general_purpose::URL_SAFE,
                raw,
            )
            .expect("url-safe base64");
            crate::campaignpack::read_table(
                &format!("return {}", String::from_utf8(bytes).unwrap()),
                key,
            )
            .expect("parses as Lua")
        };
        assert_eq!(decode("defeatconditionconfig"), json!([{ "vitalCommanders": true }]));
        assert_eq!(decode("objectiveconfig"), json!([{ "description": "Win." }]));
        assert_eq!(
            decode("planetmissioninformationtext"),
            json!({ "name": "Im Jaleth", "description": "A longer brief.",
                    "tips": ["Build metal extractors."] })
        );
    }

    #[test]
    fn the_player_gets_what_they_have_unlocked_plus_the_planets_extras() {
        let s = build(1, &planet(), &prog(), &ctx()).expect("builds");
        let raw = get(&s, "team0", "campaignunlocks").expect("campaignunlocks");
        let bytes =
            base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE, raw).unwrap();
        let list = crate::campaignpack::read_table(
            &format!("return {}", String::from_utf8(bytes).unwrap()),
            "unlocks",
        )
        .unwrap();
        assert_eq!(list, json!(["cloakcon", "staticmex", "energysolar"]));
    }

    #[test]
    fn the_commander_level_is_written_zero_indexed() {
        let s = build(1, &planet(), &prog(), &ctx()).expect("builds");
        // Level 3 on the loadout screen is static_level 2 in the script.
        assert_eq!(get(&s, "team0", "static_level").as_deref(), Some("2"));
        // And the AI's level 2 is 1.
        assert_eq!(get(&s, "team1", "static_level").as_deref(), Some("1"));
    }

    #[test]
    fn the_ai_name_is_resolved_from_the_difficulty_and_the_bit_suffix() {
        let s = build(1, &planet(), &prog(), &ctx()).expect("builds");
        // difficulty 2 -> CircuitAINormal, prefixed, and bitDependant -> 64.
        assert_eq!(get(&s, "ai0", "ShortName").as_deref(), Some("1052188CircuitAINormal64"));

        let mut harder = prog();
        harder.difficulty = 4;
        let s = build(1, &planet(), &harder, &ctx()).expect("builds");
        assert_eq!(get(&s, "ai0", "ShortName").as_deref(), Some("1052188CircuitAIBrutal64"));
    }

    #[test]
    fn an_ai_lib_that_is_already_a_shortname_is_left_alone() {
        assert_eq!(resolve_ai("Null AI", 2), "Null AI");
        assert_eq!(resolve_ai("Circuit_difficulty_autofill_ally", 1), "1052188CircuitAINormal");
    }

    /// CircuitAI takes a disable list, so what the AI *can* build is the
    /// complement. Getting this backwards gives an enemy that cannot move.
    #[test]
    fn the_ai_is_disabled_from_everything_it_was_not_given() {
        let s = build(1, &planet(), &prog(), &ctx()).expect("builds");
        let disabled = get(&s, "Options", "disabledunits").expect("disabledunits");
        let set: std::collections::HashSet<&str> = disabled.split('+').collect();
        // Its own unlock plus the difficulty-2 extra are allowed.
        assert!(!set.contains("cloakcon"), "its own unlock");
        assert!(!set.contains("staticmex"), "the difficulty-2 unlock");
        // Everything else in the game is not.
        assert!(set.contains("energysolar") && set.contains("turretlaser"));
    }

    #[test]
    fn without_a_unit_roster_nothing_is_disabled_rather_than_everything() {
        let mut bare = ctx();
        bare.all_unit_names.clear();
        let s = build(1, &planet(), &prog(), &bare).expect("builds");
        assert_eq!(get(&s, "Options", "disabledunits"), None);
    }

    #[test]
    fn start_units_are_chunked_the_way_the_gadget_reassembles_them() {
        let many: Vec<Json> = (0..85).map(|i| json!({ "name": "staticmex", "x": i })).collect();
        let mut p = planet();
        p["gameConfig"]["playerConfig"]["startUnits"] = Json::Array(many);
        let s = build(1, &p, &prog(), &ctx()).expect("builds");

        assert!(get(&s, "team0", "extrastartunits_1").is_some());
        assert!(get(&s, "team0", "extrastartunits_2").is_some());
        assert!(get(&s, "team0", "extrastartunits_3").is_some(), "85 units is three blocks");
        assert!(get(&s, "team0", "extrastartunits_4").is_none());
    }

    #[test]
    fn an_ai_with_no_commander_is_told_so_rather_than_given_a_missing_one() {
        let mut p = planet();
        p["gameConfig"]["aiConfig"][0]["commander"] = json!(false);
        let s = build(1, &p, &prog(), &ctx()).expect("builds");
        assert_eq!(get(&s, "team1", "nocommander").as_deref(), Some("1"));
        assert_eq!(get(&s, "team1", "staticcomm"), None);
    }

    #[test]
    fn every_ally_team_in_play_gets_a_section() {
        let s = build(1, &planet(), &prog(), &ctx()).expect("builds");
        let parsed = parse(&s);
        assert!(parsed.contains_key("allyTeam0"), "the player's");
        assert!(parsed.contains_key("allyTeam1"), "the enemy's");
    }

    #[test]
    fn a_planets_own_modoptions_win_and_a_table_one_is_encoded() {
        let mut p = planet();
        p["gameConfig"]["modoptions"] =
            json!({ "fixedstartpos": "0", "zkmap": { "a": 1 } });
        let s = build(1, &p, &prog(), &ctx()).expect("builds");
        // Written after the default, so the planet's value is the one that
        // survives a last-wins read of the script.
        let all = parse(&s);
        let fixed: Vec<&String> = all["modoptions"]
            .iter()
            .filter(|(k, _)| k == "fixedstartpos")
            .map(|(_, v)| v)
            .collect();
        assert_eq!(fixed.last().map(|s| s.as_str()), Some("0"));
        assert!(get(&s, "modoptions", "zkmap").is_some(), "a table is encoded");
    }

    #[test]
    fn the_script_is_shaped_the_way_the_engine_reads_one() {
        let s = build(1, &planet(), &prog(), &ctx()).expect("builds");
        assert!(s.starts_with("[Game]\n{\n\n"));
        assert!(s.ends_with('}'));
        assert_eq!(s.matches('{').count(), s.matches('}').count(), "balanced");
        assert!(!s.contains("]]"), "FixScript collapses these");
    }

    /// Every real planet, through the real reader, into a real script.
    ///
    /// The synthetic planet above is a planet I wrote, which means it exercises
    /// the fields I remembered. This one exercises the campaign. Run it with
    ///
    /// ```text
    /// SHIRO_CHOBBY=/path/to/Chobby cargo test --lib real_scripts -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "needs a Chobby checkout; set SHIRO_CHOBBY"]
    fn real_scripts_build_for_every_planet() {
        let Ok(root) = std::env::var("SHIRO_CHOBBY") else { return };
        let source = crate::campaignpack::dir_source(std::path::Path::new(&root));
        let campaign =
            crate::campaignpack::read_campaign_from(source.clone()).expect("the campaign reads");
        let units = crate::campaignpack::read_unit_names(source).expect("the unit roster reads");
        println!("{} units in the roster", units.len());

        let context = Context {
            player_name: "Sam".into(),
            game_name: "Zero-K v1.14.8.0".into(),
            all_unit_names: units,
        };
        let planets = campaign["planets"].as_array().expect("planets");

        let mut built = 0usize;
        let mut failed = Vec::new();
        let mut biggest = 0usize;
        for (i, planet) in planets.iter().enumerate() {
            let id = i as i64 + 1;
            // Every difficulty, because the difficulty picks the AI name, the
            // difficulty-dependent unlocks and the difficulty modoptions - so
            // one setting exercises a quarter of the branches.
            for difficulty in 1..=4 {
                let mut p = prog();
                p.difficulty = difficulty;
                match build(id, planet, &p, &context) {
                    Ok(script) => {
                        built += 1;
                        biggest = biggest.max(script.len());
                        assert!(script.starts_with("[Game]\n{\n\n"), "planet {id}");
                        assert_eq!(
                            script.matches('{').count(),
                            script.matches('}').count(),
                            "planet {id} at difficulty {difficulty} is unbalanced"
                        );
                        assert!(
                            script.contains(&format!("singleplayercampaignbattleid = {id};")),
                            "planet {id} is not identified to the gadget"
                        );
                    }
                    Err(why) => failed.push(format!("planet {id} d{difficulty}: {why}")),
                }
            }
        }
        println!("built {built} scripts, biggest {biggest} bytes, {} failed", failed.len());
        for f in failed.iter().take(10) {
            println!("  {f}");
        }
        assert!(failed.is_empty(), "{} scripts did not build", failed.len());
        assert_eq!(built, planets.len() * 4);

        if let Ok(to) = std::env::var("SHIRO_SCRIPT_DUMP") {
            let mut p = prog();
            p.difficulty = 2;
            std::fs::write(&to, build(1, &planets[0], &p, &context).unwrap()).expect("dump");
            println!("planet 1 script written to {to}");
        }
    }

    #[test]
    fn a_planet_without_the_parts_a_script_needs_is_an_error_not_a_bad_script() {
        assert!(build(1, &json!({}), &prog(), &ctx()).is_err());
        assert!(build(1, &json!({ "gameConfig": {} }), &prog(), &ctx()).is_err());
        assert!(
            build(1, &json!({ "gameConfig": { "playerConfig": {} } }), &prog(), &ctx()).is_err(),
            "no map"
        );
    }
}
