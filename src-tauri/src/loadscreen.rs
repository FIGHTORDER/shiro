//! Shiro's loading screen, placed into a data directory.
//!
//! Zero-K draws the screen between pressing start and the game appearing from
//! `luaintro/main.lua` inside its own game archive. That archive cannot be
//! touched - its checksum is what keeps a client in sync with the server - but
//! it does not have to be, because the first thing Zero-K's own script does is
//!
//! ```lua
//! VFS.DEF_MODE = VFS.RAW_FIRST
//! ```
//!
//! which searches the raw data directory before any archive. A file written to
//! `<datadir>/LuaIntro/Addons/main.lua` is therefore found ahead of Zero-K's
//! addon of the same name and replaces it. Nothing is patched, nothing is
//! injected, and the game's checksum is exactly what it was.
//!
//! **Every path here is spelled the way the engine spells it, capitals and
//! all.** The addon handler scans `LUA_DIRNAME .. 'Addons/'` and the addon asks
//! for `LuaIntro/Images/…`; a raw file is found by handing those strings to the
//! filesystem unchanged. Windows does not care about the difference and Linux
//! does, so a lowercase `addons/` is a screen that works on one platform and is
//! invisible on the other - which is exactly how it was reported.
//!
//! Two limits worth stating plainly:
//!
//! - **This rests on Zero-K's choice, not the engine's guarantee.** That
//!   `RAW_FIRST` line is in their script. If it goes, the file is simply
//!   ignored and the stock screen comes back - which is the safe way for it to
//!   fail.
//! - **Only where Shiro owns the directory.** A managed install is ours to
//!   write into. Somebody else's Steam installation is not, so this is not
//!   written there without being asked.
//!
//! The screen is three files, not one: the addon and the two pictures it draws.
//! They are installed and removed together, because an addon that reaches for a
//! texture nobody placed is worse than no addon at all. The match file a launch
//! writes beside them (`sidecar.rs`) is removed with them for the same reason
//! read backwards: it exists for this addon, so it has no business outliving it.

use std::path::{Path, PathBuf};

/// The addon itself, compiled in rather than shipped beside the binary: it is a
/// few kilobytes and having it in the executable means there is no resource to
/// go missing.
const ADDON: &str = include_str!("loadscreen/main.lua");

/// The two pictures, white on transparent so the addon can tint them with
/// `gl.Color` rather than needing a file per state.
///
/// Bytes rather than text, so `include_bytes!` rather than `include_str!` -
/// same reasoning as the addon, and the same reason the release build does not
/// have to carry a resource directory around.
///
/// Both are built by `tools/gen-loadscreen-art.mjs` from art the client already
/// ships, and both are named with a `shiro-` prefix on purpose: `LuaIntro/Images`
/// is a directory the game also reads, and removal deletes these names without
/// asking, so they had better be names nothing else would choose.
const IMAGES: [(&str, &[u8]); 2] = [
    ("shiro-mark.png", include_bytes!("loadscreen/shiro-mark.png")),
    (
        "shiro-glaive-plate.png",
        include_bytes!("loadscreen/shiro-glaive-plate.png"),
    ),
];

/// Where the file goes, relative to a data directory.
///
/// `main.lua` deliberately matches the name Zero-K uses, since replacing that
/// addon is the point - a second addon with a different name would draw on top
/// of the original rather than instead of it.
///
/// `Addons` is capitalised because the engine capitalises it. The handler in
/// `springcontent.sdz` builds its search list as `LUA_DIRNAME .. 'Addons/'`
/// with `LUA_DIRNAME` coming from `Script.GetName()`, which for this handle is
/// `LuaIntro` - so the string it hands the filesystem is `LuaIntro/Addons/`.
/// Zero-K's own copy lives at `luaintro/addons/` inside the archive and is
/// found anyway, because archive lookups are lowercased; raw ones are not.
pub fn path(root: &Path) -> PathBuf {
    root.join("LuaIntro").join("Addons").join("main.lua")
}

/// The spelling an older Shiro wrote, kept so it can be cleaned up.
///
/// It was `addons`, which on Windows is the same file as the path above and on
/// Linux is a different one that nothing ever reads. Only ever removed, never
/// written - and removed before the real one is written, because on a
/// case-insensitive filesystem these two are one file and the order is what
/// keeps that from deleting the screen it just placed.
fn legacy(root: &Path) -> PathBuf {
    root.join("LuaIntro").join("addons").join("main.lua")
}

/// Clear a screen left at the old spelling, and the directory if it emptied.
fn clear_legacy(root: &Path) {
    let file = legacy(root);
    if ours(&file) {
        let _ = std::fs::remove_file(&file);
    }
    let _ = std::fs::remove_dir(root.join("LuaIntro").join("addons"));
}

/// Written when somebody turns the screen off, so it stays off.
///
/// A sibling of the addon rather than its absence, because absence is also what
/// a brand-new install looks like - and a launcher that cannot tell those apart
/// puts the file back every time it starts, which is the same unhelpfulness as
/// reinstalling an app the user just removed.
const OFF: &str = ".shiro-loadscreen-off";

fn off_marker(root: &Path) -> PathBuf {
    root.join(OFF)
}

/// Turned off on purpose?
pub fn declined(root: &Path) -> bool {
    off_marker(root).is_file()
}

/// Put it in place unless it is already there or somebody said no.
///
/// Runs at startup for an install Shiro owns, so the screen is on by default -
/// including for installs made before it existed, which would otherwise have
/// needed the switch found and pressed to get something the next install got
/// for free.
///
/// `installed` below counts the pictures, so an install left behind by a Shiro
/// that predated them is repaired here rather than reported as fine.
pub fn ensure_default(root: &Path) -> Result<(), String> {
    if declined(root) || current(root) {
        return Ok(());
    }
    install(root)
}

/// Is what is on disk what this build ships?
///
/// `installed` asks whether *a* screen is there; this asks whether it is *this*
/// one. The difference was a real bug: startup only wrote the addon when none
/// was present, so the first version ever installed stayed forever. Somebody
/// who had the screen before the match roster existed kept a screen that could
/// not read the roster file - Shiro wrote it faithfully every launch and the
/// addon on disk had no idea it was there.
///
/// Compared by content rather than a version stamp. A stamp is a second thing
/// to remember to change, and this costs one read of a file that is already
/// being opened.
fn current(root: &Path) -> bool {
    if std::fs::read_to_string(path(root)).map(|t| t != ADDON).unwrap_or(true) {
        return false;
    }
    IMAGES.iter().all(|(name, bytes)| {
        std::fs::read(image(root, name)).map(|b| b == *bytes).unwrap_or(false)
    })
}

/// Where a picture goes. `LuaIntro/Images` is the directory the addon's
/// `gl.Texture("LuaIntro/Images/…")` resolves against.
fn image(root: &Path, name: &str) -> PathBuf {
    root.join("LuaIntro").join("Images").join(name)
}

/// Is the addon at that path one Shiro wrote?
///
/// Takes the file rather than the directory, because the old spelling has to be
/// asked the same question before it is deleted.
fn ours(file: &Path) -> bool {
    std::fs::read_to_string(file)
        .map(|t| t.contains("Shiro's loading screen"))
        .unwrap_or(false)
}

/// Is Shiro's screen in place here, all of it?
///
/// The pictures count. A version of Shiro that predates them left the addon
/// behind without them, and reporting that as installed would leave the switch
/// saying yes while the screen drew with two textures missing.
pub fn installed(root: &Path) -> bool {
    ours(&path(root)) && IMAGES.iter().all(|(name, _)| image(root, name).is_file())
}

/// Write it, replacing anything already at those paths.
pub fn install(root: &Path) -> Result<(), String> {
    // Asking for it back cancels the note that said not to.
    let _ = std::fs::remove_file(off_marker(root));
    clear_legacy(root);
    let file = path(root);
    write(&file, ADDON.as_bytes())?;
    for (name, bytes) in IMAGES {
        write(&image(root, name), bytes)?;
    }
    Ok(())
}

fn write(file: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    std::fs::write(file, bytes).map_err(|e| format!("could not write {}: {e}", file.display()))
}

/// Remove it, which restores Zero-K's own screen.
///
/// Only ever files this wrote: the check reads the addon first, so a hand-made
/// one at that path is left alone rather than deleted by a launcher that assumed
/// it put it there.
pub fn remove(root: &Path) -> Result<(), String> {
    let file = path(root);
    if file.exists() {
        if !ours(&file) {
            return Err(format!(
                "{} was not written by Shiro, so it will not be removed.",
                file.display()
            ));
        }
        std::fs::remove_file(&file)
            .map_err(|e| format!("could not remove {}: {e}", file.display()))?;
    }
    /* The pictures go too, and go even when the addon has already been deleted
       by hand. That case is the whole reason this is not inside the branch
       above: nothing else in the data directory knows those two files are ours,
       so if this does not clear them, nothing ever will. */
    for (name, _) in IMAGES {
        let picture = image(root, name);
        if picture.exists() {
            std::fs::remove_file(&picture)
                .map_err(|e| format!("could not remove {}: {e}", picture.display()))?;
        }
    }
    /* And an addon an older Shiro left at the lowercase spelling. On Linux that
       is a second file, at a path this version never touches again, so nothing
       else is ever going to notice it is there. */
    clear_legacy(root);
    /* And the match file, which belongs to this screen and nothing else: it is
       written for this addon to read, so once the addon is gone it is a roster
       in a folder with nothing left to draw it - and the one thing that would
       stop the tidy-up below from ever emptying LuaIntro on a real install. */
    crate::sidecar::clear(root);
    /* And the directories, if this is all that was in them. `remove_dir`
       refuses a directory that still has something in it, which is exactly the
       question worth asking: anything left is somebody else's. */
    let luaintro = root.join("LuaIntro");
    let _ = std::fs::remove_dir(luaintro.join("Images"));
    let _ = std::fs::remove_dir(luaintro.join("Addons"));
    let _ = std::fs::remove_dir(&luaintro);
    /* And remember that it was deliberate, so startup does not helpfully put it
       back. Best-effort: failing to write the note is not a reason to refuse
       the removal the user asked for. */
    let _ = std::fs::write(off_marker(root), "Shiro's loading screen was turned off here.\n");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shiro-loadscreen-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn bytes_of(name: &str) -> &'static [u8] {
        IMAGES.iter().find(|(n, _)| *n == name).unwrap().1
    }

    /// Width and height out of a PNG's IHDR, which is always its first chunk.
    fn png_size(bytes: &[u8]) -> (u32, u32) {
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "not a PNG");
        assert_eq!(&bytes[12..16], b"IHDR", "IHDR is not the first chunk");
        let at = |i: usize| u32::from_be_bytes(bytes[i..i + 4].try_into().unwrap());
        (at(16), at(20))
    }

    /// The last `n` components of a path, as plain strings.
    ///
    /// Compared this way rather than with `ends_with` so the assertion reads as
    /// the literal spelling being pinned, which is the entire point of it.
    fn tail(path: &Path, n: usize) -> Vec<String> {
        let all: Vec<String> = path
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        all[all.len() - n..].to_vec()
    }

    #[test]
    fn it_lands_where_zero_k_looks_first() {
        let root = temp("place");
        assert!(!installed(&root));
        install(&root).unwrap();
        // The path matters: it has to be the addon Zero-K also calls main, or
        // it draws alongside the original instead of replacing it.
        assert!(root.join("LuaIntro").join("Addons").join("main.lua").is_file());
        assert!(installed(&root));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_paths_are_spelled_the_way_the_engine_spells_them() {
        /* The reported Linux failure, pinned. A raw file is found by handing
           the engine's own string to the filesystem, so the name on disk and
           the name in the VFS have to agree byte for byte - which a Windows
           filesystem will forgive and a Linux one will not. This runs on both
           and passes on neither by accident, because it compares components
           rather than asking the filesystem anything.

           The addon has no Lua string to check it against: the handler in
           springcontent.sdz scans `LUA_DIRNAME .. 'Addons/'`, and
           `Script.GetName()` for this handle is `LuaIntro`. */
        let root = Path::new("/zk");
        assert_eq!(tail(&path(root), 3), ["LuaIntro", "Addons", "main.lua"]);

        /* The pictures and the match file do have one, in ADDON, and nothing
           but this connects the two sides. Renaming one and not the other costs
           two textures and a roster at runtime and nothing at compile time,
           which is the kind of silence this repo has been bitten by before. */
        for (name, _) in IMAGES {
            assert_eq!(tail(&image(root, name), 3), ["LuaIntro", "Images", name]);
            assert!(ADDON.contains(&format!("LuaIntro/Images/{name}")),
                "the addon asks for {name} under some other path");
        }
        assert_eq!(tail(&crate::sidecar::path(root), 2), ["LuaIntro", "shiro-match.lua"]);
        assert!(ADDON.contains("LuaIntro/shiro-match.lua"));
    }

    #[cfg(unix)]
    #[test]
    fn the_lowercase_spelling_an_older_shiro_used_is_cleared() {
        /* Only on a filesystem that can hold both at once. On Windows these are
           one file, which is why the lowercase one went unnoticed for as long
           as it did. */
        let root = temp("legacy");
        let old = legacy(&root);
        std::fs::create_dir_all(old.parent().unwrap()).unwrap();
        std::fs::write(&old, "-- Shiro's loading screen, from before this was fixed\n").unwrap();

        install(&root).unwrap();
        assert!(installed(&root));
        assert!(!old.exists(), "a screen the engine cannot see was left behind");

        // And a hand-written one at that path is still somebody else's file.
        std::fs::create_dir_all(old.parent().unwrap()).unwrap();
        std::fs::write(&old, "-- my own load screen\n").unwrap();
        remove(&root).unwrap();
        assert!(old.is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_pictures_land_beside_it_unaltered() {
        // The addon draws them by name out of LuaIntro/Images, and a texture
        // that does not resolve is a picture that silently is not there.
        let root = temp("pictures");
        install(&root).unwrap();
        for (name, bytes) in IMAGES {
            let file = root.join("LuaIntro").join("Images").join(name);
            assert_eq!(std::fs::read(&file).unwrap(), bytes, "{name} was altered");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_addon_without_its_pictures_is_not_installed() {
        /* What an install made by a Shiro that predated the pictures looks
           like. It has to read as not-installed, or the switch says yes and the
           screen draws with nothing in it. */
        let root = temp("halfway");
        install(&root).unwrap();
        std::fs::remove_file(root.join("LuaIntro").join("Images").join("shiro-mark.png")).unwrap();
        assert!(!installed(&root));
        // And installing again is what puts it right.
        install(&root).unwrap();
        assert!(installed(&root));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn removing_it_puts_the_stock_screen_back() {
        let root = temp("remove");
        install(&root).unwrap();
        remove(&root).unwrap();
        assert!(!path(&root).exists());
        // Everything it wrote, not just the file it is named after.
        for (name, _) in IMAGES {
            assert!(!root.join("LuaIntro").join("Images").join(name).exists());
        }
        assert!(!root.join("LuaIntro").exists(), "an empty LuaIntro was left behind");
        // Removing what is not there is not an error - it is the desired state.
        remove(&root).unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_match_file_goes_when_the_screen_does() {
        /* Written into LuaIntro/ by a launch, read by the addon and by nothing
           else. Left behind it is a roster with nothing to draw it - and the
           one file that would keep the test above from ever being true on an
           install somebody had actually played from. */
        let root = temp("match-file");
        install(&root).unwrap();
        std::fs::write(crate::sidecar::path(&root), "-- last week's match\nreturn {}\n").unwrap();
        remove(&root).unwrap();
        assert!(!crate::sidecar::path(&root).exists(), "the last match's roster survived");
        assert!(!root.join("LuaIntro").exists(), "an empty LuaIntro was left behind");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn removal_leaves_a_directory_that_is_not_only_ours() {
        // remove_dir refusing a non-empty directory is the check, not an
        // accident: somebody else's file in there means the folder is not ours
        // to tidy away.
        let root = temp("shared");
        install(&root).unwrap();
        let theirs = root.join("LuaIntro").join("Images").join("someone-elses.png");
        std::fs::write(&theirs, b"not ours").unwrap();
        remove(&root).unwrap();
        assert!(theirs.is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_screen_from_an_older_shiro_is_replaced() {
        /* The reported failure, from the other end: Shiro wrote the match file
           every launch and the screen never showed it, because the addon on
           disk predated the code that reads it. Startup only wrote the addon
           when none was there, so the first version installed stayed forever. */
        let root = temp("stale");
        install(&root).unwrap();
        std::fs::write(path(&root), "-- Shiro's loading screen, an older one\n").unwrap();
        assert!(installed(&root), "it is still a screen of ours");
        ensure_default(&root).unwrap();
        assert_eq!(std::fs::read_to_string(path(&root)).unwrap(), ADDON,
            "startup left an old screen in place");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_stale_picture_is_replaced_too() {
        // Same trap, other file: the addon can be current while the art it
        // draws is the previous design's.
        let root = temp("stale-art");
        install(&root).unwrap();
        let (name, bytes) = IMAGES[0];
        std::fs::write(image(&root, name), b"not the picture").unwrap();
        ensure_default(&root).unwrap();
        assert_eq!(std::fs::read(image(&root, name)).unwrap(), bytes);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn it_is_on_by_default_but_off_stays_off() {
        let root = temp("default");
        // A fresh managed install gets it without being asked.
        ensure_default(&root).unwrap();
        assert!(installed(&root));

        // Turning it off has to survive the next start, or the switch is a
        // suggestion rather than a setting.
        remove(&root).unwrap();
        assert!(declined(&root));
        ensure_default(&root).unwrap();
        assert!(!installed(&root), "startup put back a screen the user removed");

        // And turning it on again clears that.
        install(&root).unwrap();
        assert!(installed(&root) && !declined(&root));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn somebody_elses_addon_is_not_deleted() {
        // A launcher that deletes a file it did not write is a launcher that
        // eats somebody's work the first time they customise this themselves.
        let root = temp("theirs");
        let file = path(&root);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "-- my own load screen\n").unwrap();
        assert!(!installed(&root));
        assert!(remove(&root).is_err());
        assert!(file.is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_addon_declares_what_the_handler_needs() {
        // Loaded by name through Zero-K's addon handler, so the InGetInfo block
        // and the two callins it is loaded for have to be present.
        assert!(ADDON.contains("addon.InGetInfo"));
        assert!(ADDON.contains("function addon.DrawLoadScreen"));
        assert!(ADDON.contains("function addon.LoadProgress"));
        assert!(ADDON.contains("depend"));
    }

    #[test]
    fn the_pictures_are_the_shape_the_addon_draws() {
        assert_eq!(png_size(bytes_of("shiro-mark.png")), (256, 256));
        assert_eq!(png_size(bytes_of("shiro-glaive-plate.png")), (807, 1400));
        /* The plate's aspect is a literal in the Lua, because the addon cannot
           ask a texture how big it is before it has drawn it. If the art is
           ever regenerated at another size, that number has to move with it or
           the Glaive is quietly stretched. */
        assert!(ADDON.contains("807 / 1400"));
    }
}
