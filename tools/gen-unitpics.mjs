/**
 * The Codex's unit pictures, taken from the installed game.
 *
 *   node tools/gen-unitpics.mjs                # rebuild
 *   node tools/gen-unitpics.mjs --root <dir>
 *   node tools/gen-unitpics.mjs --check        # is every unit still covered?
 *
 * Writes `public/unitpics/<unit id>.webp`, one per unit, which the Codex
 * reaches by name: `unitpics/${unit.id}.webp` and nothing to look up.
 *
 * ## Why the game's own picture rather than a rendered model
 *
 * Zero-K already ships a render of every unit - the picture the build menu
 * draws, `unitpics/<buildPic>.png`, 96x96 on the diagonal team-colour plate.
 * It is the image players already associate with the unit, which is worth more
 * in a reference than a technically better render they have never seen.
 * Loading the `.s3o` models and their textures and lighting them in a canvas is
 * a genuinely different piece of work and would still arrive somewhere less
 * familiar.
 *
 * ## Why they are transcoded rather than copied
 *
 * The 251 pictures are 5.1 MB of PNG and 1.6 MB of WebP, for no visible
 * difference at the size they are drawn, and this ships in an installer.
 * The encoder is the headless browser the e2e suite already
 * depends on - the same reason `render-icon.mjs` uses one - so this adds no
 * dependency. It does mean the generator needs a browser, which is why the
 * output is committed rather than built during release: the workflow runner has
 * no reason to own one.
 *
 * A picture keeps its own aspect and is not upscaled. The screen decides how
 * large to draw it; baking in a size here would be a decision in the wrong
 * place, and enlarging a 96 pixel image to hide that it is one only makes it
 * look worse.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { findRoot, openGame, poolBytes } from "./zk-archive.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const UNITS = join(ROOT, "src", "data", "codex.json");
const OUT = join(ROOT, "public", "unitpics");

const args = process.argv.slice(2);
const check = args.includes("--check");
const rootArg = args.indexOf("--root") >= 0 ? args[args.indexOf("--root") + 1] : undefined;

const units = JSON.parse(readFileSync(UNITS, "utf8")).units;

// ------------------------------------------------------------------- check ---

if (check) {
  if (!existsSync(OUT)) {
    console.log("unitpics: none generated yet - run: node tools/gen-unitpics.mjs");
    process.exit(0);
  }
  const have = new Set(readdirSync(OUT).map(f => f.replace(/\.webp$/, "")));
  const missing = units.filter(u => !have.has(u.id));
  const stray = [...have].filter(id => !units.some(u => u.id === id));
  console.log(`unitpics: ${have.size} of ${units.length} units drawn, ${missing.length} without a picture, ${stray.length} stray`);
  /* Stray files are the failure that matters: a unit the game removed leaves a
     picture behind, and nothing else would ever notice. Missing ones are
     reported but tolerated - a handful of units genuinely declare no picture. */
  if (stray.length) {
    console.error(`  stray: ${stray.join(", ")}`);
    console.error("  re-run: node tools/gen-unitpics.mjs");
    process.exit(1);
  }
  process.exit(0);
}

// -------------------------------------------------------------------- read ---

const root = findRoot(rootArg);
if (!root) {
  console.error("no Zero-K install found - pass --root <zk data dir> or set SHIRO_ZK_ROOT");
  process.exit(1);
}
const opened = openGame(root);
if (!opened) { console.error(`no Zero-K package found in ${root}`); process.exit(1); }
console.log(`reading ${opened.game} (${opened.package})`);

/* Keyed on the lowercased basename, because a unit's `buildPic` is written in
   whatever case its author felt like and the archive stores its own. */
const pics = new Map();
for (const e of opened.index) {
  const m = e.name.match(/^unitpics\/([^/]+)$/i);
  if (m) pics.set(m[1].toLowerCase(), e.md5);
}
console.log(`  ${pics.size} pictures in the archive`);

const jobs = [];
const without = [];
for (const u of units) {
  const md5 = u.icon && pics.get(String(u.icon).toLowerCase());
  const bytes = md5 && poolBytes(root, md5);
  if (!bytes) { without.push(u.id); continue; }
  jobs.push({ id: u.id, png: bytes.toString("base64") });
}
if (!jobs.length) { console.error("no pictures matched any unit"); process.exit(1); }

// ---------------------------------------------------------------- transcode ---

async function launch() {
  for (const channel of ["msedge", "chrome", "chromium"]) {
    try { return await chromium.launch({ channel }); } catch { /* next */ }
  }
  return chromium.launch();
}

const browser = await launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><title>transcode</title>");

/* In batches, because handing a browser every base64 PNG in one argument is a
   5 MB string through the CDP bridge for no gain. */
const BATCH = 24;
const QUALITY = 0.9;
const encoded = [];
for (let i = 0; i < jobs.length; i += BATCH) {
  const batch = jobs.slice(i, i + BATCH);
  const out = await page.evaluate(async ({ items, quality }) => {
    const results = [];
    for (const it of items) {
      const blob = await (await fetch(`data:image/png;base64,${it.png}`)).blob();
      const bmp = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      const webp = await canvas.convertToBlob({ type: "image/webp", quality });
      if (webp.type !== "image/webp") { results.push({ id: it.id, error: webp.type }); continue; }
      const buf = new Uint8Array(await webp.arrayBuffer());
      let s = "";
      for (const b of buf) s += String.fromCharCode(b);
      results.push({ id: it.id, webp: btoa(s), w: bmp.width, h: bmp.height });
    }
    return results;
  }, { items: batch, quality: QUALITY });
  encoded.push(...out);
  process.stdout.write(`\r  transcoded ${encoded.length}/${jobs.length}`);
}
process.stdout.write("\n");
await browser.close();

/* A browser that quietly hands back a PNG because it cannot encode WebP would
   otherwise produce a directory of mislabelled files. */
const failed = encoded.filter(e => e.error);
if (failed.length) {
  console.error(`  the browser encoded ${failed.length} as ${failed[0].error} rather than WebP`);
  process.exit(1);
}

// ------------------------------------------------------------------- write ---

/* Cleared rather than merged: a unit the game removed must not leave its
   picture behind, and the directory is entirely generated. */
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

let before = 0, after = 0;
for (const e of encoded) {
  const buf = Buffer.from(e.webp, "base64");
  writeFileSync(join(OUT, `${e.id}.webp`), buf);
  after += buf.length;
}
for (const j of jobs) before += Buffer.from(j.png, "base64").length;

const kb = n => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`wrote ${encoded.length} pictures to ${OUT}`);
console.log(`  ${kb(before)} of PNG became ${kb(after)} of WebP`);
if (without.length) {
  console.log(`  ${without.length} units have no picture in the archive: ${without.join(", ")}`);
}
