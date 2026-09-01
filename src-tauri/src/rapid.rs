//! Reading files out of a rapid package.
//!
//! A rapid `.sdp` is a gzipped index and nothing else: a run of
//! `(name length, name, md5[16], crc32, size)` records, each naming a body that
//! sits gzipped at `pool/<md5[0..2]>/<md5[2..]>.gz`. Nothing is stored twice,
//! which is why the pool is shared and the index is small.
//!
//! This module exists because three things now need that format - `ais.rs` for
//! `LuaAI.lua`, the campaign reader for `campaign/sample/`, and
//! `tools/zk-archive.mjs` on the JavaScript side. The tool's own header says
//! why: two readers of one format are "one format quirk away from two different
//! bugs". This is the Rust half of that argument. The tool stays separate
//! because a build-time generator cannot call into the app's Rust.
//!
//! Only reading is here. Which package is the one you want is a question about
//! what is in it, and that belongs to whoever is asking - `ais.rs` wants a
//! `LuaAI.lua`, the campaign wants its `planetDefs.lua`, and neither rule
//! generalises.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

/// A corrupt or hostile `.sdp` must not be decompressed without bound. Zero-K's
/// index is about 400 kB; this is room for an archive many times its size.
pub const MAX_INDEX: u64 = 64 * 1024 * 1024;

/// A single Lua or config file out of the pool. Generous for a text file and
/// far below anything that would matter, which is the point: the limit is here
/// so a decompression bomb cannot be the thing that decides.
pub const MAX_BODY: u64 = 4 * 1024 * 1024;

/// One package's contents, by name.
///
/// Names are lowercased on the way in. The engine treats archive paths
/// case-insensitively and the files themselves disagree about case - Chobby
/// writes `planetDefs.lua` with a capital D - so a
/// case-sensitive lookup would work on one install and not the next.
#[derive(Default, Debug, Clone)]
pub struct Index {
    by_name: BTreeMap<String, String>,
}

impl Index {
    /// The pool hash of one file, or `None` if this package has no such file.
    pub fn hash(&self, name: &str) -> Option<&str> {
        self.by_name.get(&name.to_ascii_lowercase()).map(String::as_str)
    }

    pub fn has(&self, name: &str) -> bool {
        self.hash(name).is_some()
    }

    /// Every name under a directory prefix, in sorted order.
    ///
    /// Sorted because the caller usually wants to iterate the campaign's
    /// planets, and "whatever order the index happened to be written in" is the
    /// kind of input that makes a bug reproduce on one machine only.
    pub fn under<'a>(&'a self, prefix: &'a str) -> impl Iterator<Item = (&'a str, &'a str)> {
        let lower = prefix.to_ascii_lowercase();
        self.by_name
            .iter()
            .filter(move |(name, _)| name.starts_with(&lower))
            .map(|(name, hash)| (name.as_str(), hash.as_str()))
    }
}

fn gunzip(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(file)
        .take(limit)
        .read_to_end(&mut out)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(out)
}

/// Parse one `.sdp`.
pub fn read_index(path: &Path) -> Result<Index, String> {
    parse_index(&gunzip(path, MAX_INDEX)?).map_err(|e| format!("{}: {e}", path.display()))
}

/// The index format, split out so a test can hand it bytes without a file.
pub fn parse_index(raw: &[u8]) -> Result<Index, String> {
    let mut by_name = BTreeMap::new();
    let mut i = 0usize;
    while i < raw.len() {
        let len = raw[i] as usize;
        i += 1;
        // 16 bytes of md5, 4 of crc32, 4 of size. A truncated record means a
        // truncated file, and half an index is not an answer.
        let end = i + len + 24;
        if end > raw.len() {
            return Err("ends inside a record".into());
        }
        let name = String::from_utf8_lossy(&raw[i..i + len]).to_ascii_lowercase();
        by_name.insert(name, hex(&raw[i + len..i + len + 16]));
        i = end;
    }
    Ok(Index { by_name })
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Where the pool keeps one file's body.
pub fn pool_path(root: &Path, hash: &str) -> Option<PathBuf> {
    if hash.len() != 32 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(root.join("pool").join(&hash[..2]).join(format!("{}.gz", &hash[2..])))
}

pub fn pool_bytes(root: &Path, hash: &str, limit: u64) -> Option<Vec<u8>> {
    gunzip(&pool_path(root, hash)?, limit).ok()
}

pub fn pool_text(root: &Path, hash: &str) -> Option<String> {
    let raw = pool_bytes(root, hash, MAX_BODY)?;
    Some(String::from_utf8_lossy(&raw).into_owned())
}

/// Read one named file out of a package, in one step.
pub fn file_text(root: &Path, index: &Index, name: &str) -> Option<String> {
    pool_text(root, index.hash(name)?)
}

/// Every `.sdp` in a data directory, newest first.
///
/// Newest first because every caller wants the same tiebreak: a data directory
/// is shared between games and holds one package per rapid download, so when
/// more than one matches, the one fetched most recently is the one somebody is
/// most likely using.
pub fn packages(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root.join("packages")) else { return Vec::new() };
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("sdp"))
        .map(|p| {
            let when = p
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            (when, p)
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    found.into_iter().map(|(_, p)| p).collect()
}

/// The newest package containing `marker`, with its index.
///
/// The marker is how a caller says which kind of package it wants: `LuaAI.lua`
/// is what makes a package a game, `campaign/sample/planetDefs.lua` is what
/// makes one the campaign menu.
pub fn newest_with(root: &Path, marker: &str) -> Option<(PathBuf, Index)> {
    for path in packages(root) {
        let Ok(index) = read_index(&path) else { continue };
        if index.has(marker) {
            return Some((path, index));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build an index the way rapid writes one.
    fn record(name: &str, md5: [u8; 16]) -> Vec<u8> {
        let mut out = vec![name.len() as u8];
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(&md5);
        out.extend_from_slice(&[0; 4]); // crc32
        out.extend_from_slice(&[0; 4]); // size
        out
    }

    #[test]
    fn names_are_folded_so_either_spelling_finds_the_file() {
        let mut raw = record("Campaign/Sample/Planet1.lua", [0xab; 16]);
        raw.extend(record("LuaAI.lua", [0xcd; 16]));
        let index = parse_index(&raw).expect("parses");

        assert_eq!(index.hash("campaign/sample/planet1.lua"), Some("ab".repeat(16).as_str()));
        assert!(index.has("CAMPAIGN/SAMPLE/PLANET1.LUA"), "an archive that capitalises is the same archive");
        assert!(index.has("luaai.lua"));
    }

    #[test]
    fn a_truncated_index_is_an_error_not_half_an_answer() {
        let mut raw = record("modinfo.lua", [0x11; 16]);
        raw.truncate(raw.len() - 3);
        assert!(parse_index(&raw).is_err());
    }

    #[test]
    fn under_lists_a_directory_in_a_fixed_order() {
        let mut raw = record("campaign/sample/planet2.lua", [0x02; 16]);
        raw.extend(record("campaign/sample/planet1.lua", [0x01; 16]));
        raw.extend(record("luaui/widget.lua", [0x03; 16]));
        let index = parse_index(&raw).expect("parses");

        let names: Vec<&str> = index.under("campaign/sample/").map(|(n, _)| n).collect();
        assert_eq!(names, ["campaign/sample/planet1.lua", "campaign/sample/planet2.lua"]);
    }

    #[test]
    fn a_pool_path_is_the_hash_split_after_two_characters() {
        let root = Path::new("/zk");
        let hash = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            pool_path(root, hash).unwrap(),
            Path::new("/zk/pool/01/23456789abcdef0123456789abcdef.gz")
        );
    }

    /// A hash out of a package is a filename component. It is read from a file
    /// the user downloaded, so it is not automatically a safe one.
    #[test]
    fn a_hash_that_is_not_a_hash_addresses_nothing() {
        let root = Path::new("/zk");
        assert!(pool_path(root, "../../../../etc/passwd").is_none());
        assert!(pool_path(root, "0123").is_none(), "too short");
        assert!(pool_path(root, &"z".repeat(32)).is_none(), "not hex");
    }
}
