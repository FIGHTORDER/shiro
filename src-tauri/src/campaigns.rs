//! Community campaigns: missions built in Splaunch, installed and run here.
//!
//! A campaign is a zip holding a `campaign.json` and, per mission, a compiled
//! start script beside the scenario it came from. Shiro installs it into its own
//! data directory, decides which missions are unlocked, binds a mission to this
//! machine's Zero-K, and starts the engine on it.
//!
//! **Nothing is installed into the game.** A mission arms Zero-K's own campaign
//! gadget through `singleplayercampaignbattleid`, a free-form modoption read
//! straight off `Spring.GetModOptions()` and declared nowhere, so stock
//! unmodified Zero-K runs this with no archive added and no file in the install
//! touched. The server is not involved either: a mission is a local skirmish.
//!
//! ## Why there is no scenario compiler here
//!
//! A start script has exactly three fields that cannot travel between machines:
//! the map's archive name, the local Zero-K's archive name, and the player.
//! Everything else, including every base64 payload carrying units, objectives,
//! features and the briefing, is identical everywhere. So missions ship
//! compiled, with those three written as markers, and this substitutes three
//! strings.
//!
//! The alternative was a second copy of Splaunch's compiler. Its encoder works
//! around two faults in Zero-K's own decoder, and two implementations of that
//! would drift; the drift would show up as a mission that silently places
//! nothing, which is the one failure this format cannot afford, because a
//! broken payload is broken for everybody who downloads it rather than for one
//! machine.
//!
//! ## What is trusted
//!
//! A campaign is data, not code. Nothing in it is executed here. The scripts it
//! carries are handed to the engine, which is the same thing that happens to a
//! script the lobby server sends, and the payloads inside them are read by
//! Zero-K's own gadget through `loadstring` - which is what the game's campaign
//! already does to its own planets. That is worth knowing and worth saying in
//! the interface, and it is why the catalogue is compiled in and hashed rather
//! than fetched, exactly as `APPS.md` §8 requires.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::launch::Game;

/// The marker a compiled mission carries where the map's name belongs.
const HOLE_MAP: &str = "__SHIRO_MAP__";
/// And the local Zero-K.
const HOLE_GAME: &str = "__SHIRO_GAME__";
/// And whoever is playing.
const HOLE_PLAYER: &str = "__SHIRO_PLAYER__";

/// Missions are text. Anything this size is not a campaign.
const MAX_CAMPAIGN: u64 = 32 * 1024 * 1024;

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const TOTAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

// ------------------------------------------------------------- format -----

/// One mission, as the campaign lists it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignMission {
    pub id: String,
    pub name: String,
    /// Named outside the script so this can say "you are missing two maps"
    /// before launching rather than leaving the engine to fail at the whistle.
    pub map: String,
    #[serde(default)]
    pub requires: Vec<String>,
    #[serde(default)]
    pub summary: Option<String>,
}

/// A campaign, as its `campaign.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Campaign {
    #[serde(default)]
    pub format_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// The Zero-K it was compiled against, when it says.
    #[serde(default)]
    pub built_against: Option<String>,
    pub missions: Vec<CampaignMission>,
}

/// One mission and what this machine can do with it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionStatus {
    pub id: String,
    pub name: String,
    pub map: String,
    pub summary: Option<String>,
    /// Every mission it requires has been finished.
    pub unlocked: bool,
    pub done: bool,
    /// The map resolved against this install. `None` is the reason it cannot
    /// be played yet, and the interface should say which map rather than
    /// offering a button that fails.
    pub map_archive: Option<String>,
}

/// An installed campaign, with this machine's answers filled in.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledCampaign {
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub description: String,
    /// Set when the campaign names a Zero-K other than the one installed.
    ///
    /// Not a refusal. Unit names are stable in Zero-K and the campaign gadget
    /// ignores types it cannot resolve, so a mismatch usually runs fine - but
    /// when it does not, it fails by placing nothing and saying nothing, and
    /// somebody should have been told the versions differed.
    pub built_against: Option<String>,
    pub missions: Vec<MissionStatus>,
}

/// A campaign Shiro knows how to fetch.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueCampaign {
    pub id: &'static str,
    pub name: &'static str,
    pub author: &'static str,
    pub summary: &'static str,
    pub download: &'static str,
    pub sha256: &'static str,
    pub version: &'static str,
}

/// Compiled in, never fetched.
///
/// `APPS.md` §8: the catalogue does not come from an unsigned URL. A campaign
/// carries missions the engine will run, so the list of them ships with the
/// launcher and every entry is pinned to a hash. Adding one is a release.
static CATALOGUE: &[CatalogueCampaign] = &[];

// ------------------------------------------------------------ on disk -----

fn campaigns_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    let dir = base.join("campaigns");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not make {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Whether an id is safe to use as a file name.
///
/// Ids come out of a downloaded `campaign.json`, and every one of them becomes
/// a path. Anything outside this set is refused rather than sanitised, because
/// a campaign whose ids need rewriting is one whose scripts would then be
/// looked up under names it does not use.
fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn read_manifest(dir: &Path) -> Result<Campaign, String> {
    let text = std::fs::read_to_string(dir.join("campaign.json"))
        .map_err(|e| format!("could not read the campaign: {e}"))?;
    let campaign: Campaign =
        serde_json::from_str(&text).map_err(|e| format!("that is not a campaign: {e}"))?;
    check(&campaign)?;
    Ok(campaign)
}

/// What would make a campaign unusable, checked once on the way in.
fn check(campaign: &Campaign) -> Result<(), String> {
    if !safe_id(&campaign.id) {
        return Err(format!("{:?} is not a usable campaign id", campaign.id));
    }
    if campaign.missions.is_empty() {
        return Err("that campaign has no missions".into());
    }
    for m in &campaign.missions {
        if !safe_id(&m.id) {
            return Err(format!("{:?} is not a usable mission id", m.id));
        }
    }
    /* A campaign where everything is locked opens to an empty list and says
       nothing about why. Splaunch refuses to pack one; this refuses to install
       one, because the two checks guard different doors. */
    if campaign.missions.iter().all(|m| !m.requires.is_empty()) {
        return Err("every mission in that campaign is locked behind another".into());
    }
    Ok(())
}

/// Which missions have been finished.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Progress {
    #[serde(default)]
    done: Vec<String>,
}

fn read_progress(dir: &Path) -> Progress {
    std::fs::read_to_string(dir.join("progress.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_progress(dir: &Path, progress: &Progress) -> Result<(), String> {
    let text = serde_json::to_string_pretty(progress)
        .map_err(|e| format!("could not record progress: {e}"))?;
    std::fs::write(dir.join("progress.json"), text)
        .map_err(|e| format!("could not record progress: {e}"))
}

// ------------------------------------------------------------- status -----

/// A campaign as this machine sees it.
///
/// Pure, so the unlocking rules can be tested without an install or a disk.
pub fn status(
    campaign: &Campaign,
    done: &[String],
    resolve: impl Fn(&str) -> Option<String>,
) -> InstalledCampaign {
    let missions = campaign
        .missions
        .iter()
        .map(|m| MissionStatus {
            id: m.id.clone(),
            name: m.name.clone(),
            map: m.map.clone(),
            summary: m.summary.clone(),
            unlocked: m.requires.iter().all(|r| done.iter().any(|d| d == r)),
            done: done.iter().any(|d| d == &m.id),
            map_archive: resolve(&m.map),
        })
        .collect();
    InstalledCampaign {
        id: campaign.id.clone(),
        name: campaign.name.clone(),
        author: campaign.author.clone(),
        version: campaign.version.clone(),
        description: campaign.description.clone(),
        built_against: campaign.built_against.clone(),
        missions,
    }
}

/// Fill a compiled mission in for this machine.
pub fn fill(template: &str, map: &str, game: &str, player: &str) -> String {
    template
        .replace(HOLE_MAP, map)
        .replace(HOLE_GAME, game)
        .replace(HOLE_PLAYER, player)
}

// ------------------------------------------------------------ install -----

fn sha256_of(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

fn host_allowed(url: &str) -> bool {
    url.starts_with("https://github.com/")
        || url.starts_with("https://objects.githubusercontent.com/")
}

/// Unpack a campaign, flattened.
///
/// Flattening is what stops an entry named `../..` from writing outside the
/// campaign's own directory, and it costs nothing: the archive's own layout is
/// one manifest and a `missions/` folder whose names are already unique.
///
/// Only the three extensions a campaign is made of are kept. An archive
/// carrying anything else is not a campaign and the rest of it is not unpacked.
fn unpack(bytes: &[u8], into: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("that is not a campaign file: {e}"))?;
    let mut wrote = false;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| format!("unreadable entry: {e}"))?;
        if f.is_dir() {
            continue;
        }
        let Some(name) = Path::new(f.name())
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_owned)
        else {
            continue;
        };
        let ext = Path::new(&name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "json" | "script" | "splaunch") {
            continue;
        }
        let mut out = std::fs::File::create(into.join(&name))
            .map_err(|e| format!("could not write {name}: {e}"))?;
        std::io::copy(&mut f, &mut out).map_err(|e| format!("could not write {name}: {e}"))?;
        wrote = true;
    }
    if !wrote {
        return Err("that campaign file is empty".into());
    }
    Ok(())
}

/// Put an unpacked campaign in place, once it has been checked.
fn adopt(dir: &Path, staging: &Path) -> Result<Campaign, String> {
    let campaign = read_manifest(staging)?;
    for m in &campaign.missions {
        if !staging.join(format!("{}.script", m.id)).is_file() {
            return Err(format!(
                "the campaign lists {} but does not carry it",
                m.name
            ));
        }
    }
    let home = dir.join(&campaign.id);
    /* Progress belongs to the player rather than to the campaign, so a reinstall
       or an update keeps it. */
    let kept = read_progress(&home);
    let _ = std::fs::remove_dir_all(&home);
    std::fs::rename(staging, &home)
        .map_err(|e| format!("could not put the campaign in place: {e}"))?;
    if !kept.done.is_empty() {
        write_progress(&home, &kept)?;
    }
    Ok(campaign)
}

fn install_bytes(dir: &Path, bytes: &[u8]) -> Result<Campaign, String> {
    let staging = dir.join(".unpacking");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("could not stage: {e}"))?;
    let outcome = unpack(bytes, &staging).and_then(|()| adopt(dir, &staging));
    let _ = std::fs::remove_dir_all(&staging);
    outcome
}

// ----------------------------------------------------------- commands -----

#[tauri::command]
pub fn zks_campaign_catalogue() -> Vec<CatalogueCampaign> {
    CATALOGUE.to_vec()
}

/// Every campaign installed, with this machine's answers filled in.
#[tauri::command(async)]
pub fn zks_campaign_list(
    app: tauri::AppHandle,
    install_root: Option<String>,
) -> Result<Vec<InstalledCampaign>, String> {
    let dir = campaigns_dir(&app)?;
    let installed = crate::install::detect_with(install_root.as_deref())
        .ok()
        .map(|i| crate::archives::installed(&i.root));
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(out) };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Ok(campaign) = read_manifest(&path) else { continue };
        let progress = read_progress(&path);
        out.push(status(&campaign, &progress.done, |map| {
            installed.as_ref().and_then(|i| i.resolve(map))
        }));
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Install a campaign file the player already has.
///
/// The path an author uses, and the only one that works before anything has
/// been published. It reads a file the player chose, which is why there is no
/// hash to check: they are not being protected from their own disk.
#[tauri::command(async)]
pub fn zks_campaign_install_file(
    app: tauri::AppHandle,
    path: String,
) -> Result<InstalledCampaign, String> {
    let dir = campaigns_dir(&app)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("could not read {path}: {e}"))?;
    if meta.len() > MAX_CAMPAIGN {
        return Err("that file is far too large to be a campaign".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("could not read {path}: {e}"))?;
    let campaign = install_bytes(&dir, &bytes)?;
    Ok(status(&campaign, &[], |_| None))
}

/// Install a campaign the player picked in the window.
///
/// Base64 rather than a path, because Shiro has no file-dialog plugin and a
/// webview `<input type="file">` hands over contents rather than a location.
/// Base64 costs a third in size where a byte array over the IPC bridge costs
/// five times that, which for a campaign of a few kilobytes is the difference
/// between free and free.
///
/// No hash to check: the player chose this file off their own disk, and they
/// are not being protected from themselves. The catalogue path is the one that
/// fetches, and that one is pinned.
#[tauri::command(async)]
pub fn zks_campaign_install_upload(
    app: tauri::AppHandle,
    data: String,
) -> Result<InstalledCampaign, String> {
    use base64::Engine as _;
    if data.len() as u64 > MAX_CAMPAIGN * 2 {
        return Err("that file is far too large to be a campaign".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| "that file did not arrive intact".to_string())?;
    if bytes.len() as u64 > MAX_CAMPAIGN {
        return Err("that file is far too large to be a campaign".into());
    }
    let dir = campaigns_dir(&app)?;
    let campaign = install_bytes(&dir, &bytes)?;
    Ok(status(&campaign, &[], |_| None))
}

/// Download one from the catalogue.
#[tauri::command(async)]
pub fn zks_campaign_install(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let entry = CATALOGUE
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("no campaign called {id}"))?;
    if !host_allowed(entry.download) {
        return Err(format!("refusing to fetch {}", entry.download));
    }
    let dir = campaigns_dir(&app)?;

    let mut res = reqwest::blocking::Client::builder()
        .user_agent(concat!("Shiro/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))?
        .get(entry.download)
        .send()
        .map_err(|e| format!("could not reach {}: {e}", entry.download))?;
    if !res.status().is_success() {
        return Err(format!("{} answered {}", entry.download, res.status()));
    }

    let mut bytes: Vec<u8> = Vec::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n =
            std::io::Read::read(&mut res, &mut buf).map_err(|e| format!("download failed: {e}"))?;
        if n == 0 {
            break;
        }
        if bytes.len() as u64 + n as u64 > MAX_CAMPAIGN {
            return Err(format!("{} is larger than a campaign should be", entry.download));
        }
        bytes.extend_from_slice(&buf[..n]);
    }

    /* The hash decides whether these missions get to be run by the engine, and
       it cannot be checked until the download it guards has finished. */
    let got = sha256_of(&bytes);
    if !got.eq_ignore_ascii_case(entry.sha256) {
        return Err(format!(
            "{} did not match its published hash and was discarded - expected {}, got {got}",
            entry.name, entry.sha256
        ));
    }
    install_bytes(&dir, &bytes)?;
    Ok(())
}

#[tauri::command(async)]
pub fn zks_campaign_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !safe_id(&id) {
        return Err(format!("{id:?} is not a campaign"));
    }
    let dir = campaigns_dir(&app)?.join(&id);
    if !dir.is_dir() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("could not remove {id}: {e}"))
}

/// Start a mission.
#[tauri::command]
pub fn zks_campaign_play(
    app: tauri::AppHandle,
    game: tauri::State<'_, Game>,
    campaign_id: String,
    mission_id: String,
    player: String,
    install_root: Option<String>,
) -> Result<u32, String> {
    if !safe_id(&campaign_id) || !safe_id(&mission_id) {
        return Err("that is not a mission".into());
    }
    let home = campaigns_dir(&app)?.join(&campaign_id);
    let campaign = read_manifest(&home)?;
    let mission = campaign
        .missions
        .iter()
        .find(|m| m.id == mission_id)
        .ok_or_else(|| format!("{campaign_id} has no mission called {mission_id}"))?;

    let progress = read_progress(&home);
    if !mission.requires.iter().all(|r| progress.done.contains(r)) {
        return Err(format!("{} is not unlocked yet.", mission.name));
    }

    let install = crate::install::detect_with(install_root.as_deref())?;
    let installed = crate::archives::installed(&install.root);
    let map = installed.resolve(&mission.map).ok_or_else(|| {
        format!(
            "{} needs the map {}, which is not installed. Play it once in a \
             skirmish to download it, then try again.",
            mission.name, mission.map
        )
    })?;
    /* Whichever Zero-K is here, by the name the engine indexes it under. A
       start script naming anything else stops at an unknown game, and the name
       carries a version nobody can hardcode. */
    let zk = installed
        .resolve("Zero-K")
        .ok_or("No Zero-K is installed for the engine to run.")?;

    let template = std::fs::read_to_string(home.join(format!("{mission_id}.script")))
        .map_err(|e| format!("could not read {}: {e}", mission.name))?;
    let script = fill(&template, &map, &zk, player.trim());
    let path = crate::launch::mission_script_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    std::fs::write(&path, script).map_err(|e| format!("could not write the mission: {e}"))?;
    crate::launch::launch_written_script(app, &game, &path, "")
}

/// Record that a mission was finished.
///
/// The player says so. The engine's exit code does not distinguish winning from
/// quitting, and reading the game's log for a victory line would be reading a
/// format nobody promised us. For single-player content the cost of being wrong
/// is that somebody unlocks a mission early in their own copy.
#[tauri::command(async)]
pub fn zks_campaign_finish(
    app: tauri::AppHandle,
    campaign_id: String,
    mission_id: String,
    done: bool,
) -> Result<(), String> {
    if !safe_id(&campaign_id) || !safe_id(&mission_id) {
        return Err("that is not a mission".into());
    }
    let home = campaigns_dir(&app)?.join(&campaign_id);
    let campaign = read_manifest(&home)?;
    if !campaign.missions.iter().any(|m| m.id == mission_id) {
        return Err(format!("{campaign_id} has no mission called {mission_id}"));
    }
    let mut progress = read_progress(&home);
    let already = progress.done.iter().any(|d| d == &mission_id);
    if done && !already {
        progress.done.push(mission_id);
    } else if !done {
        progress.done.retain(|d| d != &mission_id);
    }
    write_progress(&home, &progress)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn three() -> Campaign {
        Campaign {
            format_version: 1,
            id: "first-contact".into(),
            name: "First Contact".into(),
            author: "Qrow".into(),
            version: "1.0.0".into(),
            description: String::new(),
            built_against: Some("Zero-K v1.14.8.0".into()),
            missions: vec![
                CampaignMission {
                    id: "one".into(),
                    name: "One".into(),
                    map: "Comet Catcher Redux".into(),
                    requires: vec![],
                    summary: None,
                },
                CampaignMission {
                    id: "two".into(),
                    name: "Two".into(),
                    map: "Icy Crater v4".into(),
                    requires: vec!["one".into()],
                    summary: None,
                },
                CampaignMission {
                    id: "three".into(),
                    name: "Three".into(),
                    map: "Icy Crater v4".into(),
                    requires: vec!["one".into(), "two".into()],
                    summary: None,
                },
            ],
        }
    }

    fn everything(map: &str) -> Option<String> {
        Some(format!("{map} v9"))
    }

    #[test]
    fn only_the_first_mission_is_open_to_start_with() {
        let s = status(&three(), &[], everything);
        let open: Vec<&str> = s
            .missions
            .iter()
            .filter(|m| m.unlocked)
            .map(|m| m.id.as_str())
            .collect();
        assert_eq!(open, vec!["one"]);
    }

    #[test]
    fn finishing_one_opens_the_next_and_not_the_one_after() {
        let s = status(&three(), &["one".to_string()], everything);
        let open: Vec<&str> = s
            .missions
            .iter()
            .filter(|m| m.unlocked)
            .map(|m| m.id.as_str())
            .collect();
        // "three" needs both, and only one is done.
        assert_eq!(open, vec!["one", "two"]);
        assert!(s.missions[0].done);
    }

    #[test]
    fn a_mission_whose_map_is_missing_says_so_rather_than_offering_to_start() {
        let s = status(&three(), &[], |map| {
            if map.starts_with("Icy") {
                None
            } else {
                Some(map.to_string())
            }
        });
        assert_eq!(s.missions[0].map_archive.as_deref(), Some("Comet Catcher Redux"));
        assert_eq!(s.missions[1].map_archive, None);
    }

    #[test]
    fn filling_a_mission_replaces_every_marker() {
        let template = "Mapname=__SHIRO_MAP__;\nGameType=__SHIRO_GAME__;\n\
                        MyPlayerName=__SHIRO_PLAYER__;\n[PLAYER0]{Name=__SHIRO_PLAYER__;}";
        let out = fill(template, "Icy Crater v4", "Zero-K v1.14.8.0", "Qrow");
        assert!(!out.contains("__SHIRO"), "{out}");
        assert!(out.contains("Mapname=Icy Crater v4;"));
        assert!(out.contains("GameType=Zero-K v1.14.8.0;"));
        // Both places the player's name appears, not just the first.
        assert_eq!(out.matches("Qrow").count(), 2);
    }

    #[test]
    fn an_id_that_would_escape_its_directory_is_refused() {
        assert!(safe_id("first-contact"));
        assert!(safe_id("01_the_outpost"));
        assert!(!safe_id("../../etc/passwd"));
        assert!(!safe_id("has space"));
        assert!(!safe_id(""));
        assert!(!safe_id(&"x".repeat(65)));
    }

    #[test]
    fn a_campaign_with_no_first_mission_is_refused() {
        let mut c = three();
        c.missions[0].requires = vec!["three".into()];
        let said = check(&c).unwrap_err();
        assert!(said.contains("locked behind"), "{said}");
    }

    #[test]
    fn a_campaign_naming_a_mission_id_that_is_a_path_is_refused() {
        let mut c = three();
        c.missions[1].id = "../../evil".into();
        assert!(check(&c).is_err());
    }

    /// A real campaign, through the whole loader, against a real install.
    ///
    /// The only test here that touches a machine, and the only one that would
    /// have caught a marker Splaunch writes and this does not replace. Ignored
    /// because CI has neither the file nor Zero-K:
    ///
    /// ```text
    /// SHIRO_TEST_CAMPAIGN=first-contact.shirocamp \
    ///   SHIRO_TEST_ZK_ROOT=... SHIRO_TEST_SCRIPT=out.txt \
    ///   cargo test --lib -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "needs a campaign file and a Zero-K install"]
    fn a_real_campaign_binds_to_a_real_install() {
        /* Skipped rather than failed when its inputs are absent: `--ignored`
           runs every ignored test, so panicking here reports a failure to
           anyone running an unrelated one. */
        let (Ok(file), Ok(root)) = (
            std::env::var("SHIRO_TEST_CAMPAIGN"),
            std::env::var("SHIRO_TEST_ZK_ROOT"),
        ) else {
            eprintln!("skipped: set SHIRO_TEST_CAMPAIGN and SHIRO_TEST_ZK_ROOT");
            return;
        };
        let root = PathBuf::from(root);
        let bytes = std::fs::read(&file).expect("could not read the campaign");

        let dir = std::env::temp_dir().join("shiro-campaign-e2e");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let campaign = install_bytes(&dir, &bytes).expect("the campaign did not install");
        println!("campaign: {} by {}", campaign.name, campaign.author);

        let installed = crate::archives::installed(&root);
        println!("{} archives indexed", installed.len());
        let view = status(&campaign, &[], |map| installed.resolve(map));
        for m in &view.missions {
            println!(
                "  {} on {:?} -> {:?} unlocked={}",
                m.name, m.map, m.map_archive, m.unlocked
            );
        }

        let mission = &campaign.missions[0];
        let template =
            std::fs::read_to_string(dir.join(&campaign.id).join(format!("{}.script", mission.id)))
                .expect("the mission is not where the manifest says");

        let zk = installed.resolve("Zero-K").expect("no Zero-K installed");
        /* The campaign's own map may not be on this machine, which is a real
           answer rather than a failure - the point of the test is the binding,
           so it falls back to any map that is here. */
        let map = installed
            .resolve(&mission.map)
            .or_else(|| std::env::var("SHIRO_TEST_MAP").ok().and_then(|m| installed.resolve(&m)))
            .unwrap_or_else(|| {
                panic!("neither {:?} nor SHIRO_TEST_MAP is installed", mission.map)
            });
        println!("binding to game={zk:?} map={map:?}");

        let script = fill(&template, &map, &zk, "Qrow");
        assert!(!script.contains("__SHIRO"), "a marker survived: {script}");
        assert!(script.contains(&format!("GameType={zk};")), "{script}");
        assert!(script.contains(&format!("Mapname={map};")), "{script}");
        assert!(
            zk.to_ascii_lowercase().starts_with("zero-k"),
            "the game bound to {zk:?}"
        );

        if let Ok(out) = std::env::var("SHIRO_TEST_SCRIPT") {
            std::fs::write(&out, &script).expect("could not write the script");
            println!("wrote {out} ({} bytes)", script.len());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_github_is_fetchable() {
        assert!(host_allowed("https://github.com/FIGHTORDER/shiro/releases/download/x/y.shirocamp"));
        assert!(!host_allowed("https://github.com.example.com/x"));
        assert!(!host_allowed("http://github.com/x"));
    }

    #[test]
    fn every_catalogue_entry_is_pinned_to_a_hash() {
        for c in CATALOGUE {
            assert_eq!(c.sha256.len(), 64, "{} has no usable hash", c.id);
            assert!(host_allowed(c.download), "{} is fetched from nowhere we trust", c.id);
        }
    }
}
