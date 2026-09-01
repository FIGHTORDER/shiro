/**
 * Finding an installed Zero-K and reading files out of it.
 *
 * Shared by the generators that need the game's own content -
 * `gen-codex.mjs` for the unit stats and `gen-unitpics.mjs` for the pictures.
 * They were reading the same rapid pool two different ways, which is one
 * format quirk away from two different bugs.
 *
 * A rapid `.sdp` is a gzipped index of `(name length, name, md5[16], crc32,
 * size)` records, each naming a body that sits gzipped at
 * `pool/<md5[0..2]>/<md5[2..]>.gz`. Same format `ais.rs` reads.
 */
import { gunzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Where Zero-K might be, most specific first. Mirrors `install.rs`. */
export function candidates(rootArg) {
  const out = [];
  if (rootArg) out.push(rootArg);
  if (process.env.SHIRO_ZK_ROOT) out.push(process.env.SHIRO_ZK_ROOT);
  const appdata = process.env.APPDATA;
  if (appdata) out.push(join(appdata, "info.zero-k.shiro", "zk"));
  const local = process.env.LOCALAPPDATA;
  if (local) out.push(join(local, "Programs", "Zero-K"));
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) out.push(join(home, ".config", "info.zero-k.shiro", "zk"));
  return out;
}

export function findRoot(rootArg) {
  for (const c of candidates(rootArg)) {
    if (c && existsSync(join(c, "packages")) && existsSync(join(c, "pool"))) return c;
  }
  return undefined;
}

export function readSdp(sdpPath) {
  const data = gunzipSync(readFileSync(sdpPath));
  const out = [];
  let i = 0;
  while (i < data.length) {
    const n = data[i]; i += 1;
    const name = data.subarray(i, i + n).toString("utf8"); i += n;
    const md5 = data.subarray(i, i + 16).toString("hex"); i += 16;
    i += 4;                       // crc32, unused
    i += 4;                       // size, unused - the body carries its own
    out.push({ name, md5 });
  }
  return out;
}

/** A file's bytes, or undefined when the pool does not hold it. */
export function poolBytes(root, md5) {
  const p = join(root, "pool", md5.slice(0, 2), `${md5.slice(2)}.gz`);
  if (!existsSync(p)) return undefined;
  return gunzipSync(readFileSync(p));
}

export function poolBody(root, md5) {
  return poolBytes(root, md5)?.toString("utf8");
}

/**
 * `key = value` out of a Lua table body.
 *
 * Deliberately not a Lua parser: these are flat tables of literals, and the two
 * string forms that appear are `[[text]]` and `"text"`. Anything cleverer is a
 * parser to maintain for no gain.
 */
export function field(src, key) {
  const re = new RegExp(`(?:^|[,{\\s])${key}\\s*=\\s*(\\[\\[([\\s\\S]*?)\\]\\]|"([^"]*)"|'([^']*)'|[-\\d.]+)`, "i");
  const m = src.match(re);
  if (!m) return undefined;
  if (m[2] !== undefined) return m[2].trim();
  if (m[3] !== undefined) return m[3].trim();
  if (m[4] !== undefined) return m[4].trim();
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The Zero-K package in an install, and its version.
 *
 * An install holds every package rapid ever pulled into it, maps and old game
 * builds included, so the one to read is chosen by its `modinfo.lua` rather
 * than by being first. Reading the wrong one is how `base_game` once reported
 * a racing mod.
 */
export function openGame(root) {
  const packages = readdirSync(join(root, "packages")).filter(f => f.endsWith(".sdp"));
  if (!packages.length) return undefined;
  for (const p of packages) {
    const index = readSdp(join(root, "packages", p));
    const modinfo = index.find(e => e.name.toLowerCase() === "modinfo.lua");
    if (!modinfo) continue;
    const text = poolBody(root, modinfo.md5);
    if (!text) continue;
    const name = field(text, "name");
    if (!name || !/zero-k/i.test(name)) continue;
    const version = field(text, "version");
    const game = version && !String(name).endsWith(String(version)) ? `${name} ${version}` : name;
    return { index, game, package: p };
  }
  return undefined;
}
