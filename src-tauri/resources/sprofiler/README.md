# Not committed: fetched at build time

`Sprofiler.exe` is placed here by `tools/fetch-bundled-apps.mjs`, which
downloads the exact zip the catalogue in `src-tauri/src/apps.rs` pins and checks
it against the SHA-256 pinned beside it.

Reading both out of the catalogue is the point. The bundled copy and the
downloadable copy are then provably the same bytes, there is one place to change
a version, and the hash that guards the download guards the bundle too.

A build that skips the fetch simply ships no bundled copy, and Sprofiler behaves
like every other entry in the launcher: it downloads on demand.

Only the executable is copied in. The archive also contains Sprofiler's own
README, and unpacking the whole thing here once landed it on top of this file.

## Windows only

`bundle.resources` in `tauri.conf.json` names this directory, and that applies
to every target. `src-tauri/tauri.linux.conf.json` clears it again so the
`.deb`, `.rpm` and `.AppImage` do not carry a Windows executable no Linux
machine can run - nine megabytes of dead weight, and a launcher entry that
looked installed and did nothing. The catalogue refuses to seed, install or
launch a `.exe` off Windows (`why_not` in `src-tauri/src/apps.rs`), so the
absence is the same story the app already tells there.
