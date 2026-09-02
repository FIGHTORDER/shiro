/**
 * Build the Codex dataset from an installed Zero-K.
 *
 *   node tools/gen-codex.mjs                       # find the install itself
 *   node tools/gen-codex.mjs --root <zk data dir>
 *   node tools/gen-codex.mjs --check               # is the committed one current?
 *
 * Writes `src/data/codex.json`: every unit the game defines, with the numbers
 * the Codex screens show, stamped with the game version it came from. When the
 * game has moved on since the committed dataset, it also appends the difference
 * to `src/data/codex-changes.json`, which is what the Codex's Changes section
 * and each unit's "recent changes" block read.
 *
 * **No second copy of the game is needed for that.** The committed dataset was
 * generated from the previous build and lives in the repository, so a
 * regeneration after a game update has both sides of the comparison to hand.
 * Once its dataset is written, the old game can go.
 *
 * ## Why the data is generated and shipped rather than read at runtime
 *
 * The design calls for data "bundled, versioned with the game build", with a
 * banner when it no longer matches what is installed. That is the right call
 * for three reasons that only show up once you try the alternative:
 *
 * - **Not every Shiro user has Zero-K installed.** Someone browsing units
 *   before they download the game is a real case, and reading the install would
 *   give them an empty screen.
 * - **A rapid install is a pool of gzipped blobs**, so "read the units" means
 *   decompressing several hundred files. Fine once in a build step, not on a
 *   tab switch.
 * - **The version stamp is the honest part.** A dataset that silently drifts
 *   from the installed game is worse than one that says which build it is from
 *   and lets the interface admit the difference.
 *
 * ## Where the numbers come from
 *
 * `units/<name>.lua` inside the game archive. Zero-K stores the headline stats
 * directly - `metalCost`, `health`, `speed`, `sightDistance`, and a `weaponDefs`
 * table with `damage`, `range` and `reloadtime` - so this is a read rather than
 * a simulation of the game's own arithmetic.
 *
 * Two things are not stored and have to be worked out:
 *
 * - **A unit's internal name is its table key**, not its filename. They agree
 *   for almost every unit and `damagesinkrock.lua` defines `rocksink`. Splaunch
 *   found that one the hard way.
 * - **Factory membership** is not on the unit. It is derived by reading every
 *   builder's `buildOptions` and inverting it. Factories have to outrank
 *   `athena`, which builds a cross-section of six factories and would otherwise
 *   claim units that belong elsewhere.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { field, findRoot, openGame, poolBody } from "./zk-archive.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "src", "data", "codex.json");
const CHANGES = join(ROOT, "src", "data", "codex-changes.json");

const args = process.argv.slice(2);
const check = args.includes("--check");
const rootArg = args.indexOf("--root") >= 0 ? args[args.indexOf("--root") + 1] : undefined;

/** The unit's internal name: the table key, not the filename. */
function tableKey(src) {
  const m = src.match(/return\s*{\s*([A-Za-z0-9_]+)\s*=/);
  return m ? m[1].toLowerCase() : undefined;
}

/** The first weapon's numbers, which is the one a player means by "the weapon". */
/**
 * The headline damage: the largest entry of the weapon's `damage` table.
 *
 * `damage` is a table of armour classes. Reading it needs the table's real
 * end, which is the whole of this function.
 *
 * The first version took the 400 characters after `damage = {` and reported the
 * largest number in them, which walks straight past the closing brace into
 * whatever follows. The committed dataset showed what that costs: Aegis and
 * Aspis reported `damage: 3600`, which is their *shield capacity*, and the
 * Cornea jammer reported `1000000000`. Sixteen units carried a damage figure
 * with no range. Worse, `codex-changes.json` diffs on these, so a shield
 * rebalance would have been logged as a damage change.
 */
function damageOf(body) {
  const at = body.search(/damage\s*=\s*{/i);
  if (at < 0) return undefined;
  const open = body.indexOf("{", at);
  /* To the matching brace, counting depth: the table is flat today, but a
     nested one would silently truncate at the first `}` otherwise. */
  let depth = 0;
  let end = -1;
  for (let i = open; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return undefined;
  const table = body.slice(open + 1, end);

  /* The largest entry in the table, which is the number a reader wants: an
     anti-air weapon is `{default = 15.01, planes = 150.1}`, and reporting 15
     for a Razor would be true of the wrong target. Elsewhere the classes agree
     - the Impaler is `{default = 20, planes = 20}` - so this differs only where
     the difference is the point.

     Taking the max was never the bug. Taking it from 400 characters that ran
     past the closing brace was: that is where Aegis got its shield capacity as
     damage and the Cornea jammer got a billion. */
  const nums = [...table.matchAll(/=\s*([\d.]+)/g)]
    .map(m => Number(m[1]))
    .filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : undefined;
}

function firstWeapon(src) {
  const at = src.search(/weaponDefs\s*=/i);
  if (at < 0) return undefined;
  const body = src.slice(at);
  const range = field(body, "range");
  const reload = field(body, "reloadtime");
  const damage = damageOf(body);
  if (range === undefined && damage === undefined) return undefined;
  return { damage, range, reload };
}

/** Everything a builder can make, so factory membership can be inverted. */
function buildOptions(src) {
  const at = src.search(/buildOptions\s*=\s*{/i);
  if (at < 0) return [];
  const block = src.slice(at, src.indexOf("}", at) + 1);
  return [...block.matchAll(/\[\[([a-z0-9_]+)\]\]|"([a-z0-9_]+)"/gi)]
    .map(m => (m[1] || m[2]).toLowerCase());
}

/**
 * Which factory a unit belongs to.
 *
 * Inverted from every builder's `buildOptions`. A unit can be built by more
 * than one thing, so a factory wins over a generic constructor: `athena`
 * builds a 22-unit cross-section of six factories and would otherwise be
 * credited with all of them.
 */
function assignFactories(units) {
  const owner = new Map();
  const isFactory = u => /^factory/.test(u.id) || (u.buildOptions.length >= 4 && !/athena|conjurer|convict/.test(u.id));
  for (const u of units) {
    if (!u.buildOptions.length) continue;
    const rank = isFactory(u) ? 2 : 1;
    for (const made of u.buildOptions) {
      const prev = owner.get(made);
      if (!prev || rank > prev.rank) owner.set(made, { by: u.id, name: u.name, rank });
    }
  }
  for (const u of units) {
    const o = owner.get(u.id);
    u.factory = o ? o.name : undefined;
    u.factoryId = o ? o.by : undefined;
  }
}

// ------------------------------------------------------------------ changes ---

/**
 * What changed between two datasets.
 *
 * The point of this, and the reason no second install is needed: **the
 * committed `codex.json` is the previous version.** It was generated from the
 * game build before this one and it is in the repository, so regenerating
 * against a freshly updated game has both sides of the comparison already. The
 * old game itself can be deleted the moment its dataset was written.
 *
 * Only the numbers the Codex actually shows are compared. A unit whose
 * collision volume moved has not changed as far as a player reading a stat card
 * is concerned, and reporting it would bury the balance changes that matter in
 * noise.
 */
const COMPARED = ["cost", "health", "speed", "sight"];
const COMPARED_WEAPON = ["damage", "range", "reload"];

function diff(before, after) {
  const was = new Map(before.units.map(u => [u.id, u]));
  const now = new Map(after.units.map(u => [u.id, u]));

  const changed = {};
  for (const [id, u] of now) {
    const old = was.get(id);
    if (!old) continue;
    const fields = {};
    for (const k of COMPARED) {
      if (old[k] !== u[k]) fields[k] = [old[k] ?? null, u[k] ?? null];
    }
    for (const k of COMPARED_WEAPON) {
      const a = old.weapon?.[k], b = u.weapon?.[k];
      if (a !== b) fields[`weapon.${k}`] = [a ?? null, b ?? null];
    }
    if (Object.keys(fields).length) changed[id] = { name: u.name, fields };
  }

  return {
    changed,
    added: [...now.keys()].filter(id => !was.has(id)).map(id => ({ id, name: now.get(id).name })),
    removed: [...was.keys()].filter(id => !now.has(id)).map(id => ({ id, name: was.get(id).name })),
  };
}

/** Prepend an entry to the changes log, newest first, as the design lists it. */
function recordChanges(before, after) {
  const d = diff(before, after);
  const count = Object.keys(d.changed).length + d.added.length + d.removed.length;
  if (!count) {
    console.log(`  no stat changes between ${before.game} and ${after.game}`);
    return count;
  }
  const log = existsSync(CHANGES)
    ? JSON.parse(readFileSync(CHANGES, "utf8"))
    : { formatVersion: 1, entries: [] };
  /* Keyed on the pair, so re-running the generator against the same two builds
     replaces its entry rather than adding a second one. */
  log.entries = log.entries.filter(e => !(e.game === after.game && e.previous === before.game));
  log.entries.unshift({
    game: after.game,
    previous: before.game,
    // When the dataset was built, which is not when the game shipped. The
    // honest label for it is "recorded", and the interface should say that.
    recorded: new Date().toISOString().slice(0, 10),
    ...d,
  });
  writeFileSync(CHANGES, `${JSON.stringify(log, null, 1)}\n`, "utf8");
  console.log(`  ${Object.keys(d.changed).length} units changed, ${d.added.length} added, ${d.removed.length} removed`);
  console.log(`  recorded in ${CHANGES}`);
  return count;
}

// ---------------------------------------------------------------------- main ---

const root = findRoot(rootArg);
if (!root) {
  const msg = "no Zero-K install found - pass --root <zk data dir> or set SHIRO_ZK_ROOT";
  if (check) { console.log(`codex: ${msg} (skipping check)`); process.exit(0); }
  console.error(msg);
  process.exit(1);
}

const opened = openGame(root);
if (!opened) { console.error(`no Zero-K package found in ${root}`); process.exit(1); }
const { index, game: gameName, package: chosen } = opened;

console.log(`reading ${gameName} (${chosen})`);

/**
 * Definitions that are not units a player will ever meet.
 *
 * Written out rather than derived, because the game has no field that says so
 * and every candidate flag is wrong. `customParams.dontcount` also marks the
 * Claw, the Pavise, the Lamp and the Glint, which are real. "Nothing builds it
 * and the wiki has no page" also drops every commander, the Grebe, the
 * Anarchid, the Dozer and the Teleporter. There is no signal in the archive
 * separating a jumpjet script's target dummy from a unit nothing happens to
 * list, so this states which are which and can be checked by eye.
 *
 * Three kinds, and nothing else belongs here:
 *
 * - engine scaffolding the gadgets spawn and despawn (`fakeunit*`, `terraunit`)
 * - the balance team's test dummies (`damagesink`, `empiricaldpser`)
 * - Planetwars fixtures, which no ordinary game contains
 */
const SCAFFOLDING = new Set([
  "fakeunit", "fakeunit_aatarget", "fakeunit_los", "terraunit",
  "damagesink", "rocksink", "empiricaldpser", "empiricaldpsersmall",
  "pw_generic", "pw_hq_attacker",
]);

const unitFiles = index.filter(e => /^units\/[^/]+\.lua$/i.test(e.name));
console.log(`${unitFiles.length} unit definitions`);

const units = [];
for (const f of unitFiles) {
  const src = poolBody(root, f.md5);
  if (!src) continue;
  const id = tableKey(src) || f.name.replace(/^units\//i, "").replace(/\.lua$/i, "").toLowerCase();
  const name = field(src, "name");
  if (!name) continue;
  if (SCAFFOLDING.has(id)) continue;
  units.push({
    id,
    name,
    description: field(src, "description"),
    cost: field(src, "metalCost"),
    health: field(src, "health"),
    speed: field(src, "speed"),
    sight: field(src, "sightDistance"),
    icon: field(src, "buildPic"),
    model: field(src, "objectName"),
    weapon: firstWeapon(src),
    buildOptions: buildOptions(src),
  });
}

assignFactories(units);
for (const u of units) delete u.buildOptions;
units.sort((a, b) => a.name.localeCompare(b.name));

const dataset = {
  formatVersion: 1,
  game: gameName,
  units,
};

if (check) {
  if (!existsSync(OUT)) { console.error(`${OUT} is missing - run: node tools/gen-codex.mjs`); process.exit(1); }
  const have = JSON.parse(readFileSync(OUT, "utf8"));
  if (have.game !== dataset.game) {
    console.error(`codex.json is from ${have.game}, this install is ${dataset.game}`);
    process.exit(1);
  }
  console.log(`codex.json matches ${dataset.game} (${have.units.length} units)`);
  process.exit(0);
}

/* Before overwriting it: the committed dataset is the only record of the
   previous game build, so the comparison has to happen while it still exists. */
if (existsSync(OUT)) {
  const previous = JSON.parse(readFileSync(OUT, "utf8"));
  if (previous.game && previous.game !== dataset.game) {
    console.log(`${previous.game} -> ${dataset.game}`);
    recordChanges(previous, dataset);
  } else if (previous.game === dataset.game) {
    console.log(`same game build as the committed dataset (${dataset.game}); no changes to record`);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(dataset, null, 1)}\n`, "utf8");
const withFactory = units.filter(u => u.factory).length;
const withWeapon = units.filter(u => u.weapon).length;
console.log(`wrote ${OUT}`);
console.log(`  ${units.length} units, ${withFactory} placed in a factory, ${withWeapon} armed`);
