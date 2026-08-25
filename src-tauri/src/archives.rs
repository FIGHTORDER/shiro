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

use std::collections::{HashMap, HashSet};
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
    names: HashSet<String>,
}

impl Installed {
    pub fn has(&self, name: &str) -> bool {
        let key = fold(name);
        !key.is_empty() && self.names.contains(&key)
    }

    pub fn len(&self) -> usize {
        self.names.len()
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    fn insert(&mut self, name: &str) {
        let key = fold(name);
        if !key.is_empty() {
            self.names.insert(key);
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
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let meta = std::fs::metadata(&path).ok();
            let when = meta.as_ref().and_then(|m| m.modified().ok()).unwrap_or(UNIX_EPOCH);
            let size = meta.map(|m| m.len()).unwrap_or(0);
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

    if let Ok(mut memo) = MEMO.lock() {
        memo.get_or_insert_with(HashMap::new)
            .insert(root.to_path_buf(), (now, Instant::now(), out.clone()));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

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
        // The point of the whole module: the name the server uses is not
        // recoverable from the file name.
        assert!(found.has("Argent Strata 1.1"));
        assert!(!found.has("ArgentStrata1.1"));
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
