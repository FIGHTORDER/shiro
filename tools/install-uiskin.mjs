/**
 * Puts a Chili skin into a Zero-K install, for testing one before it is
 * packaged and published.
 *
 * Temporary, in the same way tools/install-lobby-button.mjs is. The shipping
 * path is a download through the Add-ons screen, and the layout written here is
 * deliberately the layout a release zip will carry, so the two cannot diverge.
 *
 *   node tools/install-uiskin.mjs ShiroSlate
 *   node tools/install-uiskin.mjs ShiroSlate --remove
 *   node tools/install-uiskin.mjs ShiroSlate --zip out.zip
 *
 * Pass a path after the name to use an install other than the one Shiro manages.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = join(HERE, "..", "src-tauri", "src", "uiskins");
/* Both Chili trees, because Zero-K picks one at runtime and either can be live.
   `api_chili.lua` sets CHILI_DIRNAME to `chili_old/` unless ZKUseNewChiliRTT is
   1, and that setting defaults to 0, so the old tree is the usual one. Skins go
   to both rather than reading the config, since the player can change it and a
   skin that vanishes when they do is worse than a duplicated directory.

   Chili then finds it with `VFS.SubDirs(SKIN_DIRNAME, "*", VFS.RAW_FIRST)`,
   which is why loose files beside the packaged skins work at all. */
const SKIN_DIRS = [
  join("LuaUI", "Widgets", "chili_old", "Skins"),
  join("LuaUI", "Widgets", "chili", "Skins"),
];

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const positional = args.filter(a => !a.startsWith("--"));
const name = positional[0];
const root = positional[1]
  || join(process.env.APPDATA || "", "info.zero-k.shiro", "zk");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!name) {
  const have = existsSync(SOURCES) ? readdirSync(SOURCES) : [];
  die(`Name a skin. Available: ${have.join(", ") || "none built yet"}`);
}
const source = join(SOURCES, name);
if (!existsSync(source)) die(`No skin called ${name} in ${SOURCES}`);

if (flag("--zip")) {
  /* The zip holds the skin directory itself, so unpacking it inside Skins/ is
     the whole installation. Same shape the skin catalogue already expects. */
  const out = resolve(args[args.indexOf("--zip") + 1] || `${name}.zip`);
  rmSync(out, { force: true });
  execFileSync("powershell", ["-NoProfile", "-Command",
    `Compress-Archive -Path '${source}' -DestinationPath '${out}'`]);
  const { size } = statSync(out);
  console.log(`packed  ${out}  (${size} bytes)`);
  execFileSync("powershell", ["-NoProfile", "-Command",
    `(Get-FileHash '${out}' -Algorithm SHA256).Hash.ToLower()`], { stdio: "inherit" });
  process.exit(0);
}

if (!existsSync(root)) die(`No such directory: ${root}`);
if (!existsSync(join(root, "engine"))) {
  die(`${root} has no engine/ in it, so it is not a Zero-K install.`);
}
const targets = SKIN_DIRS.map(d => join(root, d, name));

if (flag("--remove")) {
  let gone = 0;
  for (const t of targets) {
    if (!existsSync(t)) continue;
    rmSync(t, { recursive: true });
    console.log(`removed  ${t}`);
    gone++;
  }
  if (!gone) console.log("nothing to remove");
  else console.log("Zero-K falls back to its own skin the next time it starts.");
  process.exit(0);
}

/* A new directory beside Zero-K's eleven. Nothing here overwrites a packaged
   file: the skins are found by directory, and a name of our own collides with
   none of them. */
let bytes = 0;
const walk = d => readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = join(d, e.name);
  if (e.isDirectory()) walk(p); else bytes += statSync(p).size;
});
for (const t of targets) {
  mkdirSync(dirname(t), { recursive: true });
  rmSync(t, { recursive: true, force: true });
  cpSync(source, t, { recursive: true });
  bytes = 0;
  walk(t);
  console.log(`installed  ${t}  (${bytes} bytes)`);
}
/* The selector travels with the skins: a skin nobody can pick is present
   rather than installed. */
const widgets = join(root, "LuaUI", "Widgets");
mkdirSync(widgets, { recursive: true });
cpSync(join(SOURCES, "shiro_uiskin.lua"), join(widgets, "shiro_uiskin.lua"));
console.log(`installed  ${join(widgets, "shiro_uiskin.lua")}`);

console.log(`
Next:
  1. Start a game.
  2. Settings > HUD Panels > Extras > HUD Skin, and pick ${name} from the
     "Shiro Skin" list. Zero-K's own list is hardcoded and will not show it.
  3. Reload LuaUI. A skin only reaches controls built after it is set.

  The skin echoes a line into infolog.txt when Chili scans for it. If that
  line is absent, it was never discovered, and no amount of picking will
  help - look there first:

    ${name} skin.lua loaded from
`);
