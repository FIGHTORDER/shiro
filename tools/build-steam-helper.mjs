/**
 * Build the Steam sign-in helper and stage what the bundler needs.
 *
 *   node tools/build-steam-helper.mjs
 *   node tools/build-steam-helper.mjs --check     # staged already? (CI, and the
 *                                                #  installer's precondition)
 *
 * Two files come out of this, and neither is committed:
 *
 * - `src-tauri/binaries/shiro-steam-<triple>.exe`, the helper itself. Tauri
 *   wants an `externalBin` named for its target triple and drops it beside the
 *   launcher with the triple stripped.
 * - `src-tauri/resources/steam/steam_api64.dll`, copied out of the
 *   `steamworks-sys` crate rather than downloaded. It is Valve's, it is
 *   redistributed with the SDK, and taking it from the crate we already build
 *   against means the DLL and the bindings can never be different versions.
 *
 * Neither is in git on purpose. A prebuilt executable in a repository is
 * something nobody can review, and Valve's DLL is not ours to check in.
 *
 * Skipping this is fine. Without it the bundle carries no helper, Shiro starts
 * exactly as before, and `zks_steam_available` reports false so the sign-in
 * button never appears - which is the same thing that happens on a machine
 * where antivirus took the DLL.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const HELPER = join(ROOT, "steam-helper");
const BINARIES = join(ROOT, "src-tauri", "binaries");
const STEAM_RES = join(ROOT, "src-tauri", "resources", "steam");
const check = process.argv.includes("--check");

/** The triple Tauri expects in an `externalBin` filename. */
function triple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const line = out.split("\n").find(l => l.startsWith("host:"));
  if (!line) throw new Error("rustc -vV did not report a host triple");
  return line.slice("host:".length).trim();
}

/** Valve's redistributable, inside whichever steamworks-sys we build against. */
function bundledDll() {
  const home = process.env.CARGO_HOME || join(process.env.USERPROFILE || process.env.HOME, ".cargo");
  const src = join(home, "registry", "src");
  if (!existsSync(src)) return undefined;
  for (const index of readdirSync(src)) {
    const dir = join(src, index);
    if (!statSync(dir).isDirectory()) continue;
    const crate = readdirSync(dir).find(d => d.startsWith("steamworks-sys-"));
    if (!crate) continue;
    const dll = join(dir, crate, "lib", "steam", "redistributable_bin", "win64", "steam_api64.dll");
    if (existsSync(dll)) return dll;
  }
  return undefined;
}

const host = triple();
const exeName = `shiro-steam-${host}${host.includes("windows") ? ".exe" : ""}`;
const staged = join(BINARIES, exeName);
const stagedDll = join(STEAM_RES, "steam_api64.dll");

if (check) {
  const missing = [staged, stagedDll].filter(p => !existsSync(p));
  if (missing.length) {
    console.error("Steam helper is not staged:");
    for (const m of missing) console.error(`  ${m}`);
    console.error("Run: node tools/build-steam-helper.mjs");
    process.exit(1);
  }
  console.log("steam helper staged");
  process.exit(0);
}

console.log(`building the helper for ${host}`);
execFileSync("cargo", ["build", "--release"], { cwd: HELPER, stdio: "inherit" });

const built = join(HELPER, "target", "release", host.includes("windows") ? "shiro-steam.exe" : "shiro-steam");
if (!existsSync(built)) throw new Error(`cargo did not produce ${built}`);

mkdirSync(BINARIES, { recursive: true });
copyFileSync(built, staged);
console.log(`  ${staged}`);

/* The DLL is only needed where the helper links it. A build on a platform
   without a redistributable in the crate stages the helper and stops, rather
   than failing a build over a file that platform does not use. */
const dll = bundledDll();
if (dll) {
  mkdirSync(STEAM_RES, { recursive: true });
  copyFileSync(dll, stagedDll);
  console.log(`  ${stagedDll}`);
} else {
  console.warn("  no steam_api64.dll found in steamworks-sys; Steam sign-in will be unavailable");
}
