//! What is actually installed, according to the engine.
//!
//! The launcher needs to answer "does this player have this map" before a game
//! starts, and the answer decides two things: whether to download, and what to
//! tell the room. Getting it wrong in one direction announces the player as
//! "still downloading the map" to everybody, every game, and delays the start
//! by ten seconds. Getting it wrong in the other direction starts an engine
//! that sits on "waiting for connection" forever.
//!
//! **Filenames cannot answer it.** A battle names a map the way the server does
//! - "Argent Strata 1.1" - and the archive on disk is `ArgentStrata1.1.sd7`.
//! No amount of normalising recovers word boundaries from `HideandSeek2.2.3`.
//!
//! The engine already solved this. On startup it scans every archive and writes
//! `cache/ArchiveCache<N>.lua`, mapping each file to the display name inside it.
//! That is the same name the server uses, because both come from the archive.
//! Reading it costs one file read and no network.
//!
//! Two things keep it honest:
//!
//! - **An entry only counts if its file is still there.** The cache is written
//!   by the engine and not updated when somebody deletes a map, so a stale
//!   entry would otherwise claim an archive that is gone - the dangerous
//!   direction, since it ends in an engine waiting forever.
//! - **Absence is not proof.** A map downloaded since the engine last ran is
//!   missing from the cache, so "not in the cache" means "not known to be
//!   here", and the caller treats that as needing a download. That is the safe
//!   direction: at worst we re-check something already present.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// How long a reading of the caches is reused.
///
/// The caches run to megabytes and the preflight reads them twice per join -
/// once on the prefetch, once on the launch - so parsing them every time is a
/// stutter on the join. Short on purpose: the file-exists check is what keeps a
/// deleted archive from counting, and a memo defers that check for as long as
/// it lives. Twenty seconds covers a join and forgets long before anyone could
/// delete a map and wonder why the lobby had not noticed.
const MEMO_TTL: Duration = Duration::from_secs(20);

/// What the caches looked like: path, mtime and length of every file read.
type Stamp = (PathBuf, SystemTime, u64);

static MEMO: Mutex<Option<HashMap<PathBuf, (Vec<Stamp>, Instant, Installed)>>> = Mutex::new(None);

/// Every archive the engine has scanned and which is still on disk, by the
/// display name a battle would use.
#[derive(Debug, Default, Clone)]
pub struct Installed {
    /// Folded name to the archive's own, because both are needed and for
    /// different things. Answering "does this player have this map" wants the
    /// folded one; putting a name into a start script wants the archive's,
    /// exactly as the engine indexes it.
    names: HashMap<String, String>,
    /// Archive files sitting in `maps/` that the engine has not scanned,
    /// keyed by a tighter fold of their filename. See `has`.
    ///
    /// Deliberately a second index rather than more entries in `names`: what is
    /// known about these is that a file exists, not what the engine will call
    /// it, and only the first of those may be used to skip a download.
    unscanned: HashMap<String, String>,
}

impl Installed {
    /// Is this archive here, as far as anything can tell?
    ///
    /// The engine's cache first, then the files it has not scanned yet.
    ///
    /// That second tier exists because of a real report: 264 maps on disk, 263
    /// in the cache, and the one map that had arrived since the last scan was
    /// downloaded again on every join. A map installed by the Zero-K client
    /// after the engine last started is invisible until it next starts, and
    /// "download it again" is not a good answer to "you already have it".
    ///
    /// **Presence only.** `resolve` does not consult this, and must not: what a
    /// file is called on disk is not what the engine will index it as, and a
    /// wrong `Mapname` in a start script is the failure this module exists to
    /// avoid. Skipping a download is recoverable; naming the wrong map is not.
    pub fn has(&self, name: &str) -> bool {
        let key = fold(name);
        if key.is_empty() {
            return false;
        }
        self.names.contains_key(&key) || self.unscanned.contains_key(&tight(&key))
    }

    pub fn len(&self) -> usize {
        self.names.len()
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    /// The archive's own name, for one named loosely.
    ///
    /// A campaign carries the map name its author saw, and the archive on disk
    /// carries a version the author had no reason to write down: "Comet Catcher
    /// Redux" against "Comet Catcher Redux v3.1". `Mapname` in a start script
    /// has to be the second or the engine stops with an error about the map,
    /// which reads like the map is missing when it is not.
    ///
    /// A prefix counts only when one archive matches it. Two versions of a map
    /// installed side by side is ordinary, and starting the wrong one silently
    /// is worse than saying nothing matched. The same rule finds the game:
    /// "Zero-K" resolves to whichever Zero-K is here.
    pub fn resolve(&self, name: &str) -> Option<String> {
        let key = fold(name);
        if key.is_empty() {
            return None;
        }
        if let Some(exact) = self.names.get(&key) {
            return Some(exact.clone());
        }
        let mut near = self.names.iter().filter(|(k, _)| k.starts_with(&key));
        let (_, first) = near.next()?;
        if near.next().is_some() {
            return None;
        }
        Some(first.clone())
    }

    fn insert(&mut self, name: &str) {
        let key = fold(name);
        if !key.is_empty() {
            self.names.insert(key, name.to_string());
        }
    }
}

/// Compare names the way two sources of the same string can still differ:
/// case, and runs of whitespace. Nothing more aggressive - stripping
/// punctuation would make "Zero-K v1.14.8.0" and "Zero K v1 14 8 0" the same
/// archive, and the version is the part that matters.
fn fold(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// A fold tight enough to match a filename against a display name.
///
/// `Argent Strata 1.1` and `ArgentStrata1.1.sd7` are the same map written two
/// ways, and nothing softer than dropping every separator brings them together.
///
/// This is exactly what [`fold`] refuses to do, and for a good reason - it
/// makes `Zero-K v1.14.8.0` and `Zero K v1 14 8 0` the same string. Digits
/// survive, so versions still separate: `nuclearwinterv1` and `nuclearwinterv2`
/// stay different, which is the distinction that matters for maps. It is used
/// only for the presence check, never to name anything.
fn tight(name: &str) -> String {
    name.chars().filter(|c| c.is_ascii_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

/// Archive extensions the engine reads.
const ARCHIVES: [&str; 3] = ["sd7", "sdz", "sdd"];

/// Map archives on disk, whether or not the engine knows about them.
///
/// Only `maps/`: a game the engine has not scanned is a different problem, and
/// a wrong guess about which game is playing is far more damaging than a
/// re-downloaded map.
///
/// A stem that two files share is dropped rather than guessed at. Two maps
/// whose names differ only in punctuation are unusual; picking the wrong one to
/// call "already installed" would leave the engine waiting for a map nobody
/// has, so ambiguity falls back to downloading.
fn unscanned_maps(root: &Path) -> HashMap<String, String> {
    let mut seen: HashMap<String, Option<String>> = HashMap::new();
    let Ok(entries) = std::fs::read_dir(root.join("maps")) else { return HashMap::new() };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_archive = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| ARCHIVES.iter().any(|a| e.eq_ignore_ascii_case(a)));
        if !is_archive {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|f| f.to_str()) else { continue };
        let key = tight(stem);
        if key.is_empty() {
            continue;
        }
        seen.entry(key)
            .and_modify(|slot| *slot = None)
            .or_insert_with(|| Some(stem.to_string()));
    }
    seen.into_iter().filter_map(|(k, v)| Some((k, v?))).collect()
}

/// Every `ArchiveCache*.lua` under a data directory.
///
/// More than one because the engine writes a separate cache per internal
/// version, and a data directory that has run two engines keeps both. Reading
/// all of them is right: an archive listed by an older engine is still on disk,
/// and the file check below is what stops a stale entry lying.
fn cache_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut dirs = vec![root.join("cache")];
    while let Some(dir) = dirs.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                dirs.push(path);
            } else if path
                .file_name()
                .and_then(|f| f.to_str())
                .is_some_and(|f| f.starts_with("ArchiveCache") && f.ends_with(".lua"))
            {
                out.push(path);
            }
        }
    }
    out
}

/// Pull `name`, `path` and `archivedata.name` out of one cache file.
///
/// A hand-written scan rather than a Lua parser: the file is written by the
/// engine to a fixed shape, it is megabytes of it, and the three fields wanted
/// here are unambiguous. `name_pure` is deliberately ignored - it drops the
/// version, and "Zero-K" matching any Zero-K would be worse than no match.
fn read_cache(path: &Path, out: &mut Installed) {
    let Ok(text) = std::fs::read_to_string(path) else { return };

    for entry in text.split("\n\t\t{").skip(1) {
        let Some(file) = field(entry, "name") else { continue };
        let Some(dir) = bracket_field(entry, "path") else { continue };
        let Some(data) = entry.find("archivedata = {") else { continue };
        let Some(display) = field(&entry[data..], "name") else { continue };

        // The cache is a record of a scan, not of the present. An archive that
        // has since been deleted must not count as installed.
        if !Path::new(&dir).join(&file).is_file() {
            continue;
        }
        out.insert(&display);
    }
}

/// `key = "value"` at any indentation, first occurrence.
///
/// Anchored to the start of a line, because a bare substring for `name = "`
/// also matches inside `shortname = "` and `mapfile = "`. It holds today only
/// because the engine's writer emits fields alphabetically and `name` comes
/// first; a field-order change upstream would silently redirect every lookup
/// to a neighbour's value.
fn field(block: &str, key: &str) -> Option<String> {
    let needle = format!("{key} = \"");
    let mut from = 0;
    loop {
        let at = block[from..].find(&needle)? + from;
        if at == 0 || starts_the_key(block, at) {
            let start = at + needle.len();
            let end = block[start..].find('"')? + start;
            return Some(block[start..end].to_string());
        }
        from = at + needle.len();
    }
}

/// Is this match the whole key, rather than the tail of a longer one?
///
/// Everything before it on the line has to be indentation.
fn starts_the_key(block: &str, at: usize) -> bool {
    block[..at]
        .rsplit(|c| c == '\n' || c == '\r')
        .next()
        .map(|line| line.chars().all(|c| c == ' ' || c == '\t'))
        .unwrap_or(true)
}

/// `key = [[value]]`, which is how the engine writes paths so backslashes
/// survive.
fn bracket_field(block: &str, key: &str) -> Option<String> {
    let needle = format!("{key} = [[");
    let start = block.find(&needle)? + needle.len();
    let end = block[start..].find("]]")? + start;
    Some(block[start..end].to_string())
}

/// Where Shiro records what it has downloaded itself.
///
/// The archive cache is written by the engine, so it only learns about an
/// archive when the engine next starts. That leaves a real gap: Shiro downloads
/// the map for a battle, the engine has not run since, and the cache still says
/// the map is missing - so the room is told UNSYNCED for content that is
/// sitting on disk. On a freshly created install the gap covers everything,
/// because the engine has never run at all.
///
/// So a successful download writes down what it fetched, and that counts as
/// installed too.
///
/// The honest limit: unlike a cache entry, this cannot be checked against a
/// file, because what pr-downloader wrote is a pool of chunks rather than a
/// path we can name. Deleting an archive by hand after Shiro fetched it will
/// leave this claiming it is present until the engine next rescans. That is
/// worth it against the alternative, which is being announced as "still
/// downloading the map" in every game.
pub const DOWNLOADED: &str = ".shiro-downloaded";

/// Add a name to the record. Best-effort: a launcher that cannot write here is
/// not a launcher that should refuse to download.
pub fn remember_downloaded(root: &Path, name: &str) {
    if name.trim().is_empty() {
        return;
    }
    let mut seen = read_downloaded(root);
    if seen.iter().any(|n| fold(n) == fold(name)) {
        return;
    }
    seen.push(name.to_string());
    let _ = std::fs::write(root.join(DOWNLOADED), seen.join("\n") + "\n");
    // Our own write, so do not wait for a stamp to notice it: a download that
    // just landed is the one thing the next preflight is asking about.
    forget(root);
}

/// Drop any memo for this data directory.
pub fn forget(root: &Path) {
    if let Ok(mut memo) = MEMO.lock() {
        if let Some(map) = memo.as_mut() {
            map.remove(root);
        }
    }
}

/// Identify the files a reading would be built from, without reading them.
fn stamps(root: &Path) -> Vec<Stamp> {
    let mut files = cache_files(root);
    files.push(root.join(DOWNLOADED));
    /* The maps directory itself, because a file appearing in it changes the
       answer now that `has` looks there. */
    files.push(root.join("maps"));
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let meta = std::fs::metadata(&path).ok();
            let when = meta.as_ref().and_then(|m| m.modified().ok()).unwrap_or(UNIX_EPOCH);
            /* For a directory, how many entries it holds rather than its length,
               which is a constant nobody can use.
             *
             * A directory's mtime does move when an entry is added - but only to
             * the resolution the filesystem keeps, and a map that lands within
             * the same tick as the previous reading leaves it unchanged. The
             * memo then answers from a reading taken before the map existed,
             * and the map is invisible until the entry expires. Counting the
             * entries changes the stamp whether or not the clock did. */
            let size = match meta {
                Some(m) if m.is_dir() => {
                    std::fs::read_dir(&path).map(|d| d.flatten().count() as u64).unwrap_or(0)
                }
                Some(m) => m.len(),
                None => 0,
            };
            (path, when, size)
        })
        .collect()
}

fn read_downloaded(root: &Path) -> Vec<String> {
    std::fs::read_to_string(root.join(DOWNLOADED))
        .map(|t| t.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect())
        .unwrap_or_default()
}

/// What is installed under this data directory: what the engine scanned, plus
/// what Shiro fetched since.
///
/// An empty result is not an error: a fresh install has never run the engine
/// and has downloaded nothing. The caller reads that as "nothing known to be
/// here", which results in a download rather than a false claim.
pub fn installed(root: &Path) -> Installed {
    let now = stamps(root);
    if let Ok(memo) = MEMO.lock() {
        if let Some((seen, at, cached)) = memo.as_ref().and_then(|m| m.get(root)) {
            if *seen == now && at.elapsed() < MEMO_TTL {
                return cached.clone();
            }
        }
    }

    let mut out = Installed::default();
    for file in cache_files(root) {
        read_cache(&file, &mut out);
    }
    for name in read_downloaded(root) {
        out.insert(&name);
    }
    out.unscanned = unscanned_maps(root);

    if let Ok(mut memo) = MEMO.lock() {
        memo.get_or_insert_with(HashMap::new)
            .insert(root.to_path_buf(), (now, Instant::now(), out.clone()));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A maps directory holding these files and nothing else.
    fn with_maps(name: &str, files: &[&str]) -> PathBuf {
        let root = std::env::temp_dir().join(format!("shiro-archives-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("maps")).unwrap();
        for f in files {
            std::fs::write(root.join("maps").join(f), b"an archive as far as this is concerned")
                .unwrap();
        }
        root
    }

    #[test]
    fn a_map_the_engine_has_not_scanned_still_counts_as_here() {
        /* The reported bug: 264 maps on disk, 263 in the engine's cache, and
           the one that arrived since the last scan was downloaded again every
           single join. */
        let root = with_maps("unscanned", &["centerrockv12.sd7", "nuclear_winter_v1.sd7"]);
        let have = installed(&root);
        assert!(have.has("centerrockv12"), "a map on disk was called missing");
        // And the same map named the way a battle would name it.
        assert!(have.has("Center Rock v1.2"), "spacing and punctuation must not matter here");
        assert!(have.has("Nuclear Winter v1"));
    }

    #[test]
    fn a_version_is_still_a_difference() {
        /* The whole reason `fold` refuses to strip punctuation. Dropping
           separators must not go so far as to merge two versions of a map,
           because then the engine is sent looking for one nobody has. */
        let root = with_maps("versions", &["nuclear_winter_v1.sd7"]);
        let have = installed(&root);
        assert!(have.has("Nuclear Winter v1"));
        assert!(!have.has("Nuclear Winter v2"), "v2 is not v1");
    }

    #[test]
    fn two_files_that_fold_alike_are_both_ignored() {
        /* Skipping a download for a map that is not really there leaves the
           engine waiting for something nobody has, so an ambiguous match falls
           back to downloading rather than guessing. */
        let root = with_maps("ambiguous", &["some map.sd7", "Some_Map.sd7"]);
        let have = installed(&root);
        assert!(!have.has("Some Map"), "an ambiguous stem must not claim a map");
    }

    #[test]
    fn only_archives_count_and_only_in_maps() {
        let root = with_maps("kinds", &["real.sd7", "notes.txt", "half.sd7.part"]);
        let have = installed(&root);
        assert!(have.has("real"));
        assert!(!have.has("notes"), "a text file is not a map");
        assert!(!have.has("half"), "a part file is not a map");
    }

    #[test]
    fn resolve_never_answers_from_a_filename() {
        /* Presence may be guessed from a filename; a name for the start script
           may not. `Mapname` has to be what the engine indexes the archive as,
           and a stem is not that. */
        let root = with_maps("resolve", &["centerrockv12.sd7"]);
        let have = installed(&root);
        assert!(have.has("centerrockv12"));
        assert_eq!(have.resolve("centerrockv12"), None, "a stem is not an archive name");
    }

    #[test]
    fn a_map_added_in_the_same_instant_is_still_noticed() {
        /* The reading is memoised on the files it was built from, and a
           directory's mtime only moves to whatever resolution the filesystem
           keeps. A map landing in the same tick as the previous reading left
           the stamp identical, so the memo answered from before it existed -
           which is the original "downloads a map it already has" wearing a
           different hat. Counting entries makes the stamp move regardless. */
        let root = with_maps("memo-tick", &["first.sd7"]);
        assert!(installed(&root).has("first"));
        // No sleep: the point is that this works without waiting for a clock.
        std::fs::write(root.join("maps").join("second.sd7"), b"x").unwrap();
        assert!(installed(&root).has("second"), "a map added immediately was missed");
        std::fs::remove_file(root.join("maps").join("second.sd7")).unwrap();
        assert!(!installed(&root).has("second"), "a map removed immediately was still claimed");
    }

    #[test]
    fn a_map_appearing_later_is_noticed_despite_the_memo() {
        /* The reading is memoised on the files it was built from. A map that
           lands afterwards has to move that stamp, or the answer stays wrong
           for as long as the memo lives - which is the same bug again. */
        let root = with_maps("memo-newmap", &["first.sd7"]);
        assert!(installed(&root).has("first"));
        assert!(!installed(&root).has("second"));
        std::fs::write(root.join("maps").join("second.sd7"), b"x").unwrap();
        assert!(installed(&root).has("second"), "a new map was not noticed");
    }

    #[test]
    fn a_name_without_its_version_resolves_to_the_archive_that_has_one() {
        let mut installed = Installed::default();
        installed.insert("Comet Catcher Redux v3.1");
        assert_eq!(
            installed.resolve("Comet Catcher Redux").as_deref(),
            Some("Comet Catcher Redux v3.1")
        );
        // And the same rule answers "which Zero-K is this".
        installed.insert("Zero-K v1.14.8.0");
        assert_eq!(installed.resolve("Zero-K").as_deref(), Some("Zero-K v1.14.8.0"));
    }

    #[test]
    fn two_versions_of_a_map_refuse_to_answer_to_the_bare_name() {
        let mut installed = Installed::default();
        installed.insert("Tabula v6.1");
        installed.insert("Tabula v6.2");
        assert_eq!(installed.resolve("Tabula"), None);
        // Named exactly, there is no ambiguity to refuse.
        assert_eq!(installed.resolve("Tabula v6.2").as_deref(), Some("Tabula v6.2"));
    }

    #[test]
    fn resolving_keeps_the_archives_own_spelling() {
        // `has` folds case and whitespace; what goes into a script must not.
        let mut installed = Installed::default();
        installed.insert("Icy Crater v4");
        assert!(installed.has("icy  crater V4"));
        assert_eq!(installed.resolve("icy  crater V4").as_deref(), Some("Icy Crater v4"));
    }

    #[test]
    fn a_field_lookup_does_not_match_the_tail_of_a_longer_key() {
        // `shortname` ends in `name`, and a bare substring search finds it.
        // Today the engine writes fields alphabetically, so `name` happens to
        // come first and the bug is invisible - which is exactly the kind of
        // thing that changes upstream without anyone here noticing.
        let block = "\t\tshortname = \"zk\",\n\t\tname = \"Zero-K v1.14\",\n";
        assert_eq!(field(block, "name").as_deref(), Some("Zero-K v1.14"));
        assert_eq!(field(block, "shortname").as_deref(), Some("zk"));
    }

    #[test]
    fn a_field_lookup_still_works_when_the_key_leads_the_block() {
        let block = "name = \"first thing\",\n";
        assert_eq!(field(block, "name").as_deref(), Some("first thing"));
    }

    #[test]
    fn a_key_that_is_not_there_is_not_invented() {
        let block = "\t\tmapfile = \"maps/x.sd7\",\n";
        assert_eq!(field(block, "name"), None);
    }

    fn write(dir: &Path, name: &str, body: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, body).unwrap();
        path
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shiro-archives-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The shape the engine writes, trimmed to the fields this reads.
    fn cache_entry(file: &str, dir: &Path, display: &str) -> String {
        format!(
            "\n\t\t{{\n\t\t\tname = \"{file}\",\n\t\t\tpath = [[{}]],\n\t\t\tarchivedata = {{\n\t\t\t\tname = \"{display}\",\n\t\t\t\tname_pure = \"pure\",\n\t\t\t}},\n\t\t}},",
            dir.display()
        )
    }

    #[test]
    fn a_display_name_is_found_through_its_file() {
        let root = temp("basic");
        let maps = root.join("maps");
        write(&maps, "ArgentStrata1.1.sd7", "x");
        write(
            &root.join("cache"),
            "ArchiveCache20.lua",
            &format!("local archiveCache = {{\n\tarchives = {{{}\n\t}},\n}}",
                cache_entry("ArgentStrata1.1.sd7", &maps, "Argent Strata 1.1")),
        );

        let found = installed(&root);
        assert!(found.has("Argent Strata 1.1"));
        /* The point of the whole module: the name the server uses is not
           recoverable from the file name. That still holds where it matters -
           `resolve` will not answer from a stem, because a start script needs
           the name the engine indexes.
           This used to assert that `has` refused the filename form too. It no
           longer does, on purpose: presence may be read off a file so that a
           map the engine has not scanned yet is not downloaded again. The two
           claims were tangled together in one assertion; only the second was
           ever load-bearing. */
        assert_eq!(found.resolve("ArgentStrata1.1"), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_archive_that_was_deleted_does_not_count() {
        // The failure this prevents is the expensive one: claiming a map is
        // present starts an engine that waits for a connection forever.
        let root = temp("deleted");
        let maps = root.join("maps");
        std::fs::create_dir_all(&maps).unwrap();
        write(
            &root.join("cache"),
            "ArchiveCache20.lua",
            &format!("archives = {{{}\n\t}},", cache_entry("Gone.sd7", &maps, "Gone v1")),
        );
        assert!(!installed(&root).has("Gone v1"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn caches_from_several_engine_versions_are_all_read() {
        let root = temp("multi");
        let maps = root.join("maps");
        write(&maps, "One.sd7", "x");
        write(&maps, "Two.sd7", "x");
        write(&root.join("cache"), "ArchiveCache20.lua",
            &format!("archives = {{{}}}", cache_entry("One.sd7", &maps, "One v1")));
        write(&root.join("cache").join("104dev"), "ArchiveCache14.lua",
            &format!("archives = {{{}}}", cache_entry("Two.sd7", &maps, "Two v2")));

        let found = installed(&root);
        assert!(found.has("One v1") && found.has("Two v2"), "{} found", found.len());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn names_differing_only_in_case_or_spacing_still_match() {
        let root = temp("fold");
        let maps = root.join("maps");
        write(&maps, "M.sd7", "x");
        write(&root.join("cache"), "ArchiveCache20.lua",
            &format!("archives = {{{}}}", cache_entry("M.sd7", &maps, "Comet  Catcher Redux")));

        let found = installed(&root);
        assert!(found.has("comet catcher redux"));
        // But a different version is a different archive.
        assert!(!found.has("Comet Catcher Redux v2"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn something_we_downloaded_counts_before_the_engine_has_seen_it() {
        /* The gap this closes: Shiro fetches the map for a battle, the engine
           has not restarted, and the cache still says it is missing - so the
           room is told UNSYNCED about content already on disk. On a fresh
           managed install that is true of everything, because the engine has
           never run. */
        let root = temp("downloaded");
        assert!(!installed(&root).has("Some Map v3"));
        remember_downloaded(&root, "Some Map v3");
        assert!(installed(&root).has("some map v3"));

        // Writing it twice does not duplicate it.
        remember_downloaded(&root, "Some Map v3");
        assert_eq!(installed(&root).len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_directory_with_no_cache_is_empty_rather_than_an_error() {
        let root = temp("fresh");
        assert!(installed(&root).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_download_is_visible_immediately_rather_than_when_the_memo_expires() {
        // The reading is memoised - the caches are megabytes and the preflight
        // reads them twice per join - so our own writes have to invalidate it.
        // Otherwise the download that just landed is invisible to the preflight
        // that asked for it.
        let root = temp("memo");
        assert!(!installed(&root).has("Comet Catcher Redux"));
        remember_downloaded(&root, "Comet Catcher Redux");
        assert!(
            installed(&root).has("Comet Catcher Redux"),
            "a fresh download must not wait for the memo to expire"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_second_reading_of_unchanged_caches_agrees_with_the_first() {
        let root = temp("memo-stable");
        let maps = root.join("maps");
        write(&maps, "ArgentStrata1.1.sd7", "x");
        write(
            &root.join("cache"),
            "ArchiveCache1.lua",
            &cache_entry("ArgentStrata1.1.sd7", &maps, "Argent Strata 1.1"),
        );
        let first = installed(&root);
        let second = installed(&root);
        assert_eq!(first.len(), second.len());
        assert!(second.has("Argent Strata 1.1"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
