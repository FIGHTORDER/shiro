/**
 * Runs a Zero-K game in an isolated install, screenshots the interface, quits.
 *
 *   node tools/uiskin-shoot.mjs ShiroSlate
 *   node tools/uiskin-shoot.mjs            # no skin, for a baseline
 *
 * Temporary, like the other uiskin tools.
 *
 * Two things this exists to avoid, both of which went wrong the hard way:
 *
 * - It never touches the install the player uses. Content is junctioned in and
 *   everything the engine writes goes to its own root, so a broken skin cannot
 *   reach a game somebody is actually playing.
 * - It does not photograph the window. The engine draws with OpenGL and a
 *   background process cannot reliably raise a window to grab it; three
 *   attempts came back as the loading splash. The engine screenshots itself
 *   from its own framebuffer instead, driven by a widget that then quits.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKINS_SRC = join(ROOT, "src-tauri", "src", "uiskins");
const TEST = "C:\\Users\\youyx\\AppData\\Local\\Temp\\zktest";
const SCRATCH = join("C:\\Users\\youyx\\AppData\\Local\\Temp\\claude",
  "C--Users-youyx-Documents-NewLobby",
  "9208adc5-d538-43bb-9809-349da26d64f3", "scratchpad");
const HARNESS = join(SCRATCH, "shiro_shotter.lua");
const SCRIPT = join(SCRATCH, "skintest.txt");
const ENGINE = join(TEST, "engine", "win64", "2025.06.21", "spring.exe");
const SKIN_DIRS = [
  join("LuaUI", "Widgets", "chili_old", "Skins"),
  join("LuaUI", "Widgets", "chili", "Skins"),
];

const name = process.argv.find(a => !a.startsWith("-") && !a.endsWith(".mjs") && !a.endsWith("node.exe"));

if (!existsSync(TEST)) {
  console.error(`No isolated install at ${TEST}. Build it first.`);
  process.exit(1);
}

/* A clean slate each run: an old skin left behind would be indistinguishable
   from the one under test. */
for (const d of SKIN_DIRS) {
  const dir = join(TEST, d);
  if (!existsSync(dir)) continue;
  for (const e of readdirSync(dir)) {
    if (e.startsWith("Shiro")) rmSync(join(dir, e), { recursive: true, force: true });
  }
}
const widgets = join(TEST, "LuaUI", "Widgets");
mkdirSync(widgets, { recursive: true });
for (const e of readdirSync(widgets)) {
  if (e.startsWith("shiro_")) rmSync(join(widgets, e), { force: true });
}
const shots = join(TEST, "screenshots");
rmSync(shots, { recursive: true, force: true });

if (name) {
  const source = join(SKINS_SRC, name);
  if (!existsSync(source)) {
    console.error(`No skin called ${name} in ${SKINS_SRC}`);
    process.exit(1);
  }
  for (const d of SKIN_DIRS) {
    const t = join(TEST, d, name);
    mkdirSync(dirname(t), { recursive: true });
    cpSync(source, t, { recursive: true });
  }
  /* The selector persists its own choice and a fresh root has none, so rather
     than seeding a config file, force the theme from a test-only widget. Same
     pass and one layer above the real selector, so it wins without the run
     depending on anything saved. */
  writeFileSync(join(widgets, "shiro_uiskin_force.lua"), `function widget:GetInfo()
	return { name = "Shiro Skin Force", desc = "test harness", author = "Shiro",
		date = "2026", license = "GNU GPL, v2 or later",
		layer = 1002, api = true, enabled = true }
end

function widget:Initialize()
	local chili = WG.Chili
	if not chili then
		Spring.Echo("SHIROFORCE no chili")
		return
	end
	local ok = chili.SkinHandler and chili.SkinHandler.IsValidSkin
		and chili.SkinHandler.IsValidSkin("${name}")
	chili.theme.skin.general.skinName = "${name}"
	Spring.Echo("SHIROFORCE set skinName=${name} valid=" .. tostring(ok))
end
`, "utf8");
}
cpSync(HARNESS, join(widgets, "shiro_shotter.lua"));

console.log(`running ${name || "no skin (baseline)"} in ${TEST}`);
const child = spawn(ENGINE, ["--window", "--write-dir", TEST, SCRIPT], {
  cwd: TEST,
  env: { ...process.env, SPRING_WRITEDIR: TEST, SPRING_DATADIR: TEST },
  stdio: "ignore",
  detached: false,
});

/* The harness quits the game itself. This only stops a run that hangs. */
const cap = setTimeout(() => { try { child.kill(); } catch {} }, 90_000);
child.on("exit", code => {
  clearTimeout(cap);
  const out = existsSync(shots) ? readdirSync(shots).filter(f => f.endsWith(".png")) : [];
  console.log(`engine exited ${code}; ${out.length} screenshot(s) in ${shots}`);
  for (const f of out) console.log(`  ${f}  ${statSync(join(shots, f)).size} bytes`);
});
