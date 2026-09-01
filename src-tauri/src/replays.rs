//! Reading the replays the engine has already written.
//!
//! The Zero-K client's replay list is filenames: the battle name, the date, and
//! nothing else, because it never opens the files. The website is much better -
//! result, players, duration, graphs - and that is a database the website owns.
//!
//! It does not have to be. **Every field the website's list shows is inside the
//! file on disk.** A `.sdfz` is a gzipped Spring demo, and the first few
//! kilobytes carry a fixed header and the whole start script: map, game, engine,
//! date, duration, every player with their team, clan, country and Elo, and one
//! byte naming the ally team that won. Reading it needs no server and no
//! account.
//!
//! ## The file
//!
//! Gunzipped, the layout is five runs, each sized by the header:
//!
//! ```text
//!   header        352 bytes, fixed, `headerSize` says so
//!   start script  `scriptSize`     - the same text the engine was handed
//!   demo stream   `demoStreamSize` - every packet of the game. Not read here.
//!   player stats  `playerStatSize`
//!   winners       `winningAllyTeamsSize` bytes, one ally team per byte
//!   team stats    `teamStatSize`   - the graphs
//! ```
//!
//! **The winners come before the team statistics, not at the end of the file.**
//! Reading the last byte instead appears to work - it is usually 0, and ally
//! team 0 is a common winner - which is the kind of wrong that survives a
//! demonstration. It is the byte at `playerStats + playerStatSize`.
//!
//! ## Only the prefix is decompressed
//!
//! Listing wants the header and the script, which together are around 20 KB,
//! while the demo stream behind them is megabytes. Gzip cannot be seeked, but it
//! can be *streamed*, so `read_prefix` inflates until it has enough and stops.
//! Against a real folder that is the difference between reading 26 MB and
//! reading about 1.
//!
//! ## What is deliberately not read
//!
//! The demo stream. Chat, commands and unit events all live in it, and parsing
//! it is a different project with a much larger surface. Nothing the list or the
//! summary shows needs it.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use serde::Serialize;

use crate::install;

/// Every demo the engine writes lands here, under the data directory.
const DEMO_DIR: &str = "demos";

/// Enough for the header plus a start script. Scripts run about 17 KB for a
/// large team game; this leaves room and still reads a fraction of the file.
const PREFIX_MAX: usize = 256 * 1024;

/// `spring demofile\0`, and a file that does not begin with it is not one.
const MAGIC: &[u8] = b"spring demofile\0";

/// The engine's simulation rate. Statistics are stamped in frames and shown in
/// seconds, and this is the only place the two meet.
const FRAMES_PER_SECOND: i32 = 30;

// ------------------------------------------------------------------ header ---

#[derive(Debug, Clone, Copy)]
struct Header {
    header_size: usize,
    script_size: usize,
    demo_stream_size: usize,
    game_time: i32,
    wallclock_time: i32,
    player_stat_size: usize,
    num_teams: usize,
    team_stat_size: usize,
    team_stat_elem_size: usize,
    team_stat_period: i32,
    winners_size: usize,
}

fn i32_at(b: &[u8], at: usize) -> i32 {
    i32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn f32_at(b: &[u8], at: usize) -> f32 {
    f32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

/// The fixed header, or `None` when this is not a Spring demo.
///
/// Sizes are read as `i32` because that is what the engine writes, and a
/// negative one means a corrupt file rather than a very large section - so they
/// are rejected here instead of wrapping into a huge `usize` further down.
fn header(b: &[u8]) -> Option<Header> {
    if b.len() < 352 || !b.starts_with(MAGIC) {
        return None;
    }
    let size = |at: usize| -> Option<usize> {
        let v = i32_at(b, at);
        if v < 0 { None } else { Some(v as usize) }
    };
    // 16 magic, 4 version, 4 headerSize, 256 version string, 16 gameID, 8 time.
    let after_id = 16 + 4 + 4 + 256 + 16 + 8;
    Some(Header {
        header_size: size(20)?,
        script_size: size(after_id)?,
        demo_stream_size: size(after_id + 4)?,
        game_time: i32_at(b, after_id + 8),
        wallclock_time: i32_at(b, after_id + 12),
        player_stat_size: size(after_id + 20)?,
        num_teams: size(after_id + 28)?,
        team_stat_size: size(after_id + 32)?,
        team_stat_elem_size: size(after_id + 36)?,
        team_stat_period: i32_at(b, after_id + 40),
        winners_size: size(after_id + 44)?,
    })
}

/// The engine version string, which is a fixed 256-byte field.
fn engine_version(b: &[u8]) -> String {
    let field = &b[24..24 + 256];
    let end = field.iter().position(|&c| c == 0).unwrap_or(field.len());
    String::from_utf8_lossy(&field[..end]).trim().to_string()
}

/// When the game was played, as seconds since the epoch.
fn played_at(b: &[u8]) -> i64 {
    let at = 16 + 4 + 4 + 256 + 16;
    let mut v = [0u8; 8];
    v.copy_from_slice(&b[at..at + 8]);
    u64::from_le_bytes(v) as i64
}

// ------------------------------------------------------------------ script ---

/// One `key=value;` out of a start script, searched inside `within`.
fn field(within: &str, key: &str) -> Option<String> {
    for line in within.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_suffix(';') else { continue };
        let Some((k, v)) = rest.split_once('=') else { continue };
        if k.trim().eq_ignore_ascii_case(key) {
            return Some(v.trim().to_string());
        }
    }
    None
}

/// The body of `[name]{ ... }`, non-nested, which is all a start script uses.
fn section<'a>(script: &'a str, name: &str) -> Option<&'a str> {
    let head = format!("[{name}]");
    let at = script.to_ascii_lowercase().find(&head.to_ascii_lowercase())?;
    let open = script[at..].find('{')? + at;
    let close = script[open..].find('}')? + open;
    Some(&script[open + 1..close])
}

/// Every `[<prefix>N]` section, in the order they appear, with N.
fn sections<'a>(script: &'a str, prefix: &str) -> Vec<(usize, &'a str)> {
    let lower = script.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut from = 0usize;
    let head = format!("[{}", prefix.to_ascii_lowercase());
    while let Some(rel) = lower[from..].find(&head) {
        let at = from + rel;
        let Some(bracket) = lower[at..].find(']') else { break };
        let n: usize = match lower[at + head.len()..at + bracket].parse() {
            Ok(n) => n,
            Err(_) => {
                from = at + 1;
                continue;
            }
        };
        let Some(open) = script[at..].find('{') else { break };
        let open = open + at;
        let Some(close) = script[open..].find('}') else { break };
        let close = close + open;
        out.push((n, &script[open + 1..close]));
        from = close;
    }
    out
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplayPlayer {
    pub name: String,
    /// Absent for a spectator, who has no team.
    pub team: Option<usize>,
    /// The ally team the player's team belongs to. This is what "side" means.
    pub ally: Option<usize>,
    pub spectator: bool,
    pub elo: Option<i32>,
    pub rank: Option<i32>,
    pub clan: Option<String>,
    pub country: Option<String>,
    /// `Machines`, `Hegemony`, `Rising` - the start script carries it, and the
    /// interface marks each player with it.
    pub faction: Option<String>,
    /// A bot rather than a person. Skirmish AIs are listed separately upstream
    /// but read the same way here.
    pub bot: bool,
}

// ----------------------------------------------------------------- summary ---

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Replay {
    pub path: String,
    pub file: String,
    pub bytes: u64,

    pub map: Option<String>,
    pub game: Option<String>,
    pub engine: String,
    /// Seconds since the epoch, which the interface formats.
    pub played_at: i64,
    /// Length of the match in seconds, from the simulation clock.
    pub duration: i32,

    pub players: Vec<ReplayPlayer>,
    /// The ally teams that won. Empty means the game ended without one - a
    /// crash, a resign before anything was decided, or a replay of a game still
    /// in progress.
    pub winners: Vec<usize>,
    /// Whether the statistics block is present and readable, so the interface
    /// knows whether a breakdown is worth offering before opening the file.
    pub has_stats: bool,
}

impl Replay {
    /// Which ally team a player is on, by name. The caller knows who "me" is;
    /// this file does not.
    pub fn ally_of(&self, name: &str) -> Option<usize> {
        self.players
            .iter()
            .find(|p| !p.spectator && p.name.eq_ignore_ascii_case(name))
            .and_then(|p| p.ally)
    }
}

/// Inflate at most `want` bytes, stopping early rather than reading the rest.
///
/// A demo is one gzip member, so there is no seeking to the statistics without
/// walking the stream. Listing does not need them, and this is what keeps
/// listing proportional to the number of files rather than to their size.
fn read_prefix(path: &Path, want: usize) -> std::io::Result<Vec<u8>> {
    let mut out = vec![0u8; want];
    let mut dec = GzDecoder::new(File::open(path)?);
    let mut filled = 0usize;
    while filled < want {
        match dec.read(&mut out[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            /* A truncated demo - the engine was killed mid-game - inflates
               partway and then fails. What came out before that is still a
               valid header and script, so it is kept rather than discarded. */
            Err(_) => break,
        }
    }
    out.truncate(filled);
    Ok(out)
}

/// One replay, read from its prefix. `None` when the file is not a demo.
///
/// A zero-byte file is the common case for this returning `None`: a game that
/// crashed before the engine wrote anything leaves one behind, and a real
/// folder has plenty.
pub fn read(path: &Path) -> Option<Replay> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() == 0 {
        return None;
    }
    let buf = read_prefix(path, PREFIX_MAX).ok()?;
    let h = header(&buf)?;

    let script_end = h.header_size.saturating_add(h.script_size).min(buf.len());
    let script = String::from_utf8_lossy(&buf[h.header_size.min(buf.len())..script_end]);

    let game_section = section(&script, "game").unwrap_or(&script);
    // Both spellings occur; the engine writes lowercase, editors write neither.
    let map = field(game_section, "mapname").or_else(|| field(&script, "mapname"));
    let game = field(game_section, "gametype").or_else(|| field(&script, "gametype"));

    /* A team names the ally team it belongs to, and a player names a team, so
       the ally team of a player is one hop through this. */
    let mut ally_of_team = std::collections::HashMap::new();
    for (n, body) in sections(&script, "team") {
        if let Some(a) = field(body, "allyteam").and_then(|v| v.parse::<usize>().ok()) {
            ally_of_team.insert(n, a);
        }
    }

    let mut players = Vec::new();
    for (prefix, bot) in [("player", false), ("ai", true)] {
        for (_, body) in sections(&script, prefix) {
            let Some(name) = field(body, "name") else { continue };
            let team = field(body, "team").and_then(|v| v.parse::<usize>().ok());
            let spectator = field(body, "spectator").as_deref() == Some("1");
            players.push(ReplayPlayer {
                name,
                team,
                ally: team.and_then(|t| ally_of_team.get(&t).copied()),
                spectator,
                elo: field(body, "elo").and_then(|v| v.parse::<f32>().ok()).map(|v| v as i32),
                rank: field(body, "level").and_then(|v| v.parse::<i32>().ok()),
                clan: field(body, "clan").filter(|c| !c.is_empty()),
                country: field(body, "countrycode").filter(|c| !c.is_empty()),
                faction: field(body, "faction").filter(|c| !c.is_empty()),
                bot,
            });
        }
    }

    /* The winners sit between the player statistics and the team statistics.
       Their offset is past the demo stream, so it is only inside the prefix for
       a very short game - normally this reads the file again at that offset
       rather than inflating the megabytes in between for one byte. */
    let winners_at = h
        .header_size
        .saturating_add(h.script_size)
        .saturating_add(h.demo_stream_size)
        .saturating_add(h.player_stat_size);
    let winners = read_winners(path, winners_at, h.winners_size, &buf);

    Some(Replay {
        path: path.to_string_lossy().to_string(),
        file: path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
        bytes: meta.len(),
        map,
        game,
        engine: engine_version(&buf),
        played_at: played_at(&buf),
        /* The simulation clock, not the wall clock. They differ whenever the
           game was paused or run at anything other than normal speed, and the
           length of the *match* is the one a player means. */
        duration: if h.game_time > 0 { h.game_time } else { h.wallclock_time },
        players,
        winners,
        has_stats: h.team_stat_size > 0 && h.num_teams > 0,
    })
}

/// The winning ally teams, from the prefix when it reaches, or by inflating to
/// the offset when it does not.
fn read_winners(path: &Path, at: usize, size: usize, prefix: &[u8]) -> Vec<usize> {
    if size == 0 {
        return Vec::new();
    }
    if at + size <= prefix.len() {
        return prefix[at..at + size].iter().map(|&b| b as usize).collect();
    }
    match read_prefix(path, at + size) {
        Ok(buf) if buf.len() >= at + size => {
            buf[at..at + size].iter().map(|&b| b as usize).collect()
        }
        _ => Vec::new(),
    }
}

// -------------------------------------------------------------- statistics ---

/// One team's series, as the engine sampled it.
///
/// The element is twenty 4-byte slots: a frame number, twelve floats and seven
/// counts. Verified against a real demo - slot 0 steps by exactly
/// `teamStatPeriod * 30`, which is what identifies it as a frame rather than a
/// measurement.
///
/// The names below cover the slots this shows. The remaining resource slots are
/// deliberately not given names here: their order between metal and energy was
/// not confirmed against the engine, and a wrong label on a chart is worse than
/// no chart. They are carried through as `other` so the interface can show what
/// is certain and a later change can name the rest without a format change.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TeamSeries {
    pub team: usize,
    /// Seconds from the start of the match, one per sample.
    pub at: Vec<i32>,
    pub damage_dealt: Vec<f32>,
    pub damage_received: Vec<f32>,
    pub units_produced: Vec<i32>,
    pub units_died: Vec<i32>,
    pub units_killed: Vec<i32>,
    /// The twelve float slots as they appear, for anything not named above.
    pub other: Vec<Vec<f32>>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplayStats {
    pub period: i32,
    pub teams: Vec<TeamSeries>,
}

/// The statistics block. Reads the whole file, so it is for opening one replay
/// rather than for listing.
pub fn stats(path: &Path) -> Option<ReplayStats> {
    let mut raw = Vec::new();
    GzDecoder::new(File::open(path).ok()?).read_to_end(&mut raw).ok()?;
    let h = header(&raw)?;
    if h.team_stat_elem_size < 80 || h.num_teams == 0 {
        return None;
    }

    let mut at = h.header_size
        + h.script_size
        + h.demo_stream_size
        + h.player_stat_size
        + h.winners_size;
    /* Each team's sample count comes first, all of them, then the samples. */
    let mut counts = Vec::with_capacity(h.num_teams);
    for _ in 0..h.num_teams {
        if at + 4 > raw.len() {
            return None;
        }
        let c = i32_at(&raw, at);
        if c < 0 {
            return None;
        }
        counts.push(c as usize);
        at += 4;
    }

    let mut teams = Vec::with_capacity(h.num_teams);
    for (team, &count) in counts.iter().enumerate() {
        let mut s = TeamSeries { team, other: vec![Vec::new(); 12], ..Default::default() };
        for i in 0..count {
            let base = at + i * h.team_stat_elem_size;
            if base + h.team_stat_elem_size > raw.len() {
                break;
            }
            s.at.push(i32_at(&raw, base) / FRAMES_PER_SECOND);
            for slot in 0..12 {
                s.other[slot].push(f32_at(&raw, base + 4 + slot * 4));
            }
            // Slots 11 and 12 of the element; the last two floats.
            s.damage_dealt.push(f32_at(&raw, base + 4 + 10 * 4));
            s.damage_received.push(f32_at(&raw, base + 4 + 11 * 4));
            let ints = base + 4 + 12 * 4;
            s.units_produced.push(i32_at(&raw, ints));
            s.units_died.push(i32_at(&raw, ints + 4));
            s.units_killed.push(i32_at(&raw, ints + 6 * 4));
        }
        teams.push(s);
        at += count * h.team_stat_elem_size;
    }

    Some(ReplayStats { period: h.team_stat_period, teams })
}

// ------------------------------------------------------------------ folder ---

/// Where the engine writes demos, for an install.
pub fn demo_dir(root: &Path) -> PathBuf {
    root.join(DEMO_DIR)
}

/// Every readable replay in a folder, newest first.
pub fn scan(dir: &Path) -> Vec<Replay> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<Replay> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .map(|x| x.eq_ignore_ascii_case("sdfz") || x.eq_ignore_ascii_case("sdf"))
                .unwrap_or(false)
        })
        .filter_map(|p| read(&p))
        .collect();
    out.sort_by(|a, b| b.played_at.cmp(&a.played_at));
    out
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplayList {
    pub replays: Vec<Replay>,
    /// The newest engine installed here, so the screen can say which replays
    /// need one that is not. The replay names the engine it was recorded on and
    /// the engine will not play somebody else's.
    pub engine: Option<String>,
    /// Said rather than hidden: a folder that is not there and a folder with
    /// nothing in it look identical in the interface otherwise, and only one of
    /// them means "you have not played yet".
    pub note: Option<String>,
    pub dir: Option<String>,
}

// ---------------------------------------------------------------- commands ---

#[tauri::command]
pub async fn zks_list_replays(install_root: Option<String>) -> ReplayList {
    match tauri::async_runtime::spawn_blocking(move || list_blocking(install_root.as_deref())).await
    {
        Ok(list) => list,
        Err(e) => ReplayList {
            note: Some(format!("Reading replays did not finish: {e}")),
            ..ReplayList::default()
        },
    }
}

fn list_blocking(install_root: Option<&str>) -> ReplayList {
    let install = match install::detect_with(install_root) {
        Ok(i) => i,
        Err(e) => {
            return ReplayList {
                note: Some(e.lines().next().unwrap_or(&e).trim().to_string()),
                ..ReplayList::default()
            }
        }
    };
    let dir = demo_dir(&install.root);
    if !dir.is_dir() {
        return ReplayList {
            note: Some("No replays yet - Zero-K writes one for every game you play.".into()),
            dir: Some(dir.to_string_lossy().to_string()),
            ..ReplayList::default()
        };
    }
    ReplayList {
        replays: scan(&dir),
        engine: crate::launch::newest_engine(&install.root),
        note: None,
        dir: Some(dir.to_string_lossy().to_string()),
    }
}

/// Extensions the engine will open as a replay.
const DEMO_EXTENSIONS: [&str; 2] = ["sdfz", "sdf"];

/// The path, if it is a replay that is still there.
///
/// Checked rather than trusted even though the path came from our own listing:
/// this hands a file to a subprocess, and a command that will open anything is
/// a worse primitive than one that opens replays. A file that has been deleted
/// since the list was built is the ordinary case, not an attack, and it gets a
/// sentence rather than a failed launch.
fn playable(path: &str) -> Result<PathBuf, String> {
    let file = PathBuf::from(path);
    let extension = file
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !DEMO_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("{path} is not a replay."));
    }
    if !file.is_file() {
        return Err(format!("That replay is no longer at {path}."));
    }
    Ok(file)
}

/// Watch a replay.
///
/// The engine takes a demo exactly where it takes a start script - the last
/// argument - so this is the ordinary launch path with a different file, and it
/// inherits everything that goes with it: the one-game-at-a-time lock, the
/// window restore afterwards, and the supervisor that reports how it ended.
///
/// **The engine version is the replay's own, not the newest installed.** A demo
/// is a stream of orders replayed against a specific build; a different one
/// desynchronises or refuses to load. `find_engine` validates the version
/// before it becomes a path and says plainly when that engine is not here,
/// which is the honest answer - Shiro does not silently substitute one.
#[tauri::command]
pub fn zks_watch_replay(
    app: tauri::AppHandle,
    game: tauri::State<'_, crate::launch::Game>,
    path: String,
    engine: Option<String>,
) -> Result<u32, String> {
    let file = playable(&path)?;
    crate::launch::launch_written_script(app, &game, &file, engine.as_deref().unwrap_or(""))
}

#[tauri::command]
pub async fn zks_replay_stats(path: String) -> Option<ReplayStats> {
    tauri::async_runtime::spawn_blocking(move || stats(Path::new(&path)))
        .await
        .ok()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCRIPT: &str = "[game]\n{\nmapname=Canis River v1.4;\ngametype=Zero-K v1.14.8.0;\n\
        [team0]\n{\nallyteam=0;\nteamleader=0;\n}\n\
        [team1]\n{\nallyteam=1;\n}\n\
        [player0]\n{\nname=mankarse;\nteam=0;\nspectator=0;\nelo=2548;\nclan=RSN;\ncountrycode=AU;\nlevel=123;\n}\n\
        [player1]\n{\nname=Aquanim;\nteam=1;\nspectator=0;\nelo=3032;\nclan=;\ncountrycode=AU;\n}\n\
        [player2]\n{\nname=watcher;\nspectator=1;\n}\n}\n";

    #[test]
    fn a_field_is_read_out_of_its_own_section() {
        let g = section(SCRIPT, "game").expect("game section");
        assert_eq!(field(g, "mapname").as_deref(), Some("Canis River v1.4"));
        // Case does not matter: the engine writes lowercase, the server does not.
        assert_eq!(field(g, "MapName").as_deref(), Some("Canis River v1.4"));
        assert_eq!(field(g, "nothing"), None);
    }

    #[test]
    fn a_player_reaches_an_ally_team_through_its_team() {
        /* This is the hop that makes a result mean anything: the winner is an
           ally team, and a player only names a team. */
        let teams: std::collections::HashMap<_, _> = sections(SCRIPT, "team")
            .into_iter()
            .filter_map(|(n, b)| field(b, "allyteam")?.parse::<usize>().ok().map(|a| (n, a)))
            .collect();
        assert_eq!(teams.get(&0), Some(&0));
        assert_eq!(teams.get(&1), Some(&1));
    }

    #[test]
    fn sections_are_found_by_number_not_by_order() {
        let players = sections(SCRIPT, "player");
        assert_eq!(players.len(), 3);
        assert_eq!(players[0].0, 0);
        assert_eq!(field(players[2].1, "name").as_deref(), Some("watcher"));
    }

    #[test]
    fn a_file_that_is_not_a_demo_is_not_read_as_one() {
        assert!(header(b"not a demo at all").is_none());
        let mut nearly = vec![0u8; 400];
        nearly[..MAGIC.len()].copy_from_slice(MAGIC);
        // Magic alone is not enough - a negative size is a corrupt file.
        nearly[20..24].copy_from_slice(&(-1i32).to_le_bytes());
        assert!(header(&nearly).is_none());
    }

    #[test]
    fn only_a_replay_that_is_there_is_playable() {
        assert!(playable("C:/nope/game.txt").is_err(), "not a replay extension");
        assert!(playable("C:/nope/game.exe").is_err());
        assert!(playable("C:/nope/missing.sdfz").is_err(), "gone since the list was built");

        let dir = std::env::temp_dir().join("shiro-playable-test");
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("a.SDFZ");
        std::fs::write(&file, b"x").unwrap();
        // The extension is compared without case: the site and the engine
        // disagree about it often enough to matter.
        assert!(playable(file.to_str().unwrap()).is_ok());
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn a_header_with_room_for_nothing_is_rejected() {
        assert!(header(&[0u8; 8]).is_none());
    }

    /// Against the demos on this machine, which is the only place the real file
    /// format exists. Ignored by default: CI has no Zero-K install, and a test
    /// that silently passes on an empty folder is worse than one that is
    /// obviously not run.
    ///
    ///   cargo test --lib replays -- --ignored --nocapture
    #[test]
    #[ignore]
    fn reads_the_demos_on_this_machine() {
        let Some(root) = std::env::var_os("APPDATA").map(PathBuf::from) else { return };
        let dir = root.join("info.zero-k.shiro").join("zk").join("demos");
        if !dir.is_dir() {
            eprintln!("no demo folder at {}", dir.display());
            return;
        }
        let files = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).count();
        let replays = scan(&dir);
        println!("{} files, {} readable", files, replays.len());
        assert!(!replays.is_empty(), "no demo in {} could be read", dir.display());

        for r in &replays {
            assert!(!r.engine.is_empty(), "{} has no engine version", r.file);
            assert!(r.played_at > 1_600_000_000, "{} has an implausible date", r.file);
            for w in &r.winners {
                assert!(*w < 32, "{} names ally team {} as a winner", r.file, w);
            }
        }

        let decided = replays.iter().filter(|r| !r.winners.is_empty()).count();
        let with_players = replays.iter().filter(|r| !r.players.is_empty()).count();
        println!("{} have a result, {} name players", decided, with_players);
        let r = replays.iter().max_by_key(|r| r.duration).unwrap();
        println!(
            "longest: {} on {} - {}m, winners {:?}, {} players",
            r.file,
            r.map.as_deref().unwrap_or("?"),
            r.duration / 60,
            r.winners,
            r.players.len()
        );
        for p in r.players.iter().filter(|p| !p.spectator).take(4) {
            println!("   {} ally {:?} elo {:?}", p.name, p.ally, p.elo);
        }
        if r.has_stats {
            let st = stats(Path::new(&r.path)).expect("statistics");
            let t = &st.teams[0];
            println!("stats: {} teams, {} samples every {}s", st.teams.len(), t.at.len(), st.period);
            assert_eq!(t.at.len(), t.damage_dealt.len());
            /* The sample clock must line up with the match length, which is what
               catches an element size or an offset being wrong: a misread walks
               off into noise rather than landing on the duration. */
            let span = *t.at.last().unwrap();
            assert!(
                (span - r.duration).abs() < st.period * 2,
                "samples span {span}s but the match was {}s",
                r.duration
            );
        }
    }
}
