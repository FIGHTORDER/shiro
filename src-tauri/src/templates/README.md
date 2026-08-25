# Vendored Zero-K config templates

These seven files are **not Shiro's**. They are copied verbatim from Chobby, the
official Zero-K lobby:

    github.com/ZeroK-RTS/Chobby @ 8fed2a62a8e1d4f325aea013743ab82314c9396e
    LuaMenu/configs/gameConfig/zk/lups/lups{0..4}.cfg
    LuaMenu/configs/gameConfig/zk/cmdcolors/cmdcolors_source.txt

Chobby is GPL-v2.

## Why they are here

Zero-K's settings menu does not write all of its settings into
`springsettings.cfg`. The six Lups effect settings and the two command-colour
sliders are applied by substituting `__PLACEHOLDER__` values into these
templates and writing the result to `lups.cfg` and `cmdcolors.txt` in the Zero-K
data dir.

Upstream loads them out of the Chobby archive through the engine's VFS. Shiro
launches the engine directly and never runs Chobby, so it has no VFS to read
from, and reading them out of an `.sd7` would mean implementing archive access
for 13 kB of config. They are vendored instead.

## Keeping them honest

The pin above must match `PIN_SHA` in `tools/gen-settings.mjs` and
`TEMPLATE_PIN` in `../game_files.rs`; bump all three together.

Two tests in `game_files.rs` guard the pin:

- `every_placeholder_we_substitute_exists` — a rename upstream fails the build
  rather than writing a config with a literal `__AIR_JET__` in it.
- `the_quality_numbers_are_the_ones_the_reader_expects` — the five templates are
  *not* a clean quality ladder (they carry 0, 2, 3, 3 and 4), and the two that
  share a quality are told apart by whether `DistortionUpdateSkip` is commented
  out. `src/net/gameSettings.ts` relies on exactly that to read a `lups.cfg`
  back, so a tidy-up upstream must not pass silently.

Do not hand-edit these files. Re-copy them from the pin.
