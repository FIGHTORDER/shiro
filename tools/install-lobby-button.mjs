/**
 * Puts the Shiro lobby button widget into a Zero-K install, for testing it
 * before any of this is wired into Shiro itself.
 *
 * Temporary. Once Shiro places the widget the way it already places the
 * loading screen addon, this goes away.
 *
 *   node tools/install-lobby-button.mjs            # install
 *   node tools/install-lobby-button.mjs --remove   # take it back out
 *   node tools/install-lobby-button.mjs --watch    # print presses as they land
 *
 * Pass a path to use an install other than the one Shiro manages.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "src-tauri", "src", "lobbybutton", "shiro_lobby_button.lua");
/* The same shiro_ prefix Shiro's own widget installer uses, so the widget list
   already recognises this as ours and offers to remove it. */
const NAME = "shiro_lobby_button.lua";
/* Written by the widget, relative to the engine's write directory, which is
   the install root. */
const SIGNAL = join("LuaUI", "shiro-lobby.txt");

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const root = args.find(a => !a.startsWith("--"))
  || join(process.env.APPDATA || "", "info.zero-k.shiro", "zk");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

/* An install is a directory with an engine and content beside it. The same
   shape install.rs looks for, checked here so a wrong path fails now rather
   than by writing a widget somewhere nothing will read it. */
if (!existsSync(root)) die(`No such directory: ${root}`);
if (!existsSync(join(root, "engine"))) {
  die(`${root} has no engine/ in it, so it is not a Zero-K install.`);
}

const widgets = join(root, "LuaUI", "Widgets");
const target = join(widgets, NAME);

if (flag("--remove")) {
  if (existsSync(target)) {
    rmSync(target);
    console.log(`removed  ${target}`);
  } else {
    console.log(`nothing to remove at ${target}`);
  }
  const signal = join(root, SIGNAL);
  if (existsSync(signal)) {
    rmSync(signal);
    console.log(`removed  ${signal}`);
  }
  process.exit(0);
}

if (flag("--watch")) {
  /* Stands in for the Shiro side until it exists: the same poll, printing
     instead of raising a window. Proves the widget's half on its own. */
  const signal = join(root, SIGNAL);
  console.log(`watching ${signal}`);
  console.log("press the Lobby button in game; presses appear here.\n");
  let last = existsSync(signal) ? readFileSync(signal, "utf8") : null;
  setInterval(() => {
    if (!existsSync(signal)) return;
    const now = readFileSync(signal, "utf8");
    if (now !== last) {
      last = now;
      console.log(`  press  ${now.trim()}   at ${new Date().toLocaleTimeString()}`);
    }
  }, 200);
} else {
  /* Zero-K rewrites its widget config when it exits, so a widget dropped in
     while the game is open is fine - it is read at the next start - but a
     config change would not be. Nothing here touches the config: local widgets
     are already on in this install, and turning them on is Shiro's job and
     has rules of its own. */
  mkdirSync(widgets, { recursive: true });
  copyFileSync(SOURCE, target);
  const size = statSync(target).size;
  console.log(`installed  ${target}  (${size} bytes)`);
  console.log(`
Next:
  1. Start a game from Shiro.
  2. Look at the top right bar. The button fills the gap at its left end.
  3. Clicking it writes ${SIGNAL} and minimises the game.

Watch the presses land with:
  node tools/install-lobby-button.mjs --watch
`);
}
