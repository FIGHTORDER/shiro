/**
 * Every resource the base Tauri config bundles is bundled on every platform,
 * unless it is named as deliberately platform-specific.
 *
 * Tauri merges `tauri.<platform>.conf.json` over `tauri.conf.json`, and for an
 * array the merge is a REPLACE, not an append. So a platform config that lists
 * one resource does not add it - it drops every other resource that platform
 * would otherwise have carried, silently, at bundle time.
 *
 * That is how Linux shipped without Zero-K's campaign: the Linux config named
 * `libsteam_api.so`, which threw away `resources/campaign/**` with it. Nothing
 * failed, nothing logged; the Galaxy nav item is hidden when the campaign reads
 * as empty, so the feature was simply absent, and only on one platform.
 *
 * A resource is exempt when its path carries a marker of the platform it is
 * for - a Windows `.dll`, a Linux `.so`, a `.exe` - because those genuinely
 * belong to one platform and listing them everywhere would be the wrong fix.
 *
 *   node tools/check-bundle.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* Resolved from this file rather than from the working directory: run from
   another repository it would otherwise check that one and pass. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");

/**
 * Resources a platform may drop, and why.
 *
 * Written down rather than inferred: a resource missing from one platform is
 * either a deliberate decision worth recording or the bug this file exists to
 * catch, and nothing about the path itself tells the two apart.
 */
const ALLOWED = {
  "resources/sprofiler/*": "Sprofiler is a Windows .exe; there is no Linux build to ship.",
};

/** Does this path belong to one platform by its own nature? */
function platformOwned(path) {
  return path in ALLOWED || /\.(dll|so|dylib|exe)(\/|$)/i.test(path);
}

const base = JSON.parse(readFileSync(join(SRC, "tauri.conf.json"), "utf8"));
const wanted = base.bundle?.resources ?? [];

const overrides = readdirSync(SRC)
  .filter(f => /^tauri\.[a-z0-9]+\.conf\.json$/i.test(f));

const problems = [];
for (const file of overrides) {
  const conf = JSON.parse(readFileSync(join(SRC, file), "utf8"));
  const theirs = conf.bundle?.resources;
  // No `resources` key at all is fine: the base list is inherited whole.
  if (!theirs) continue;
  for (const want of wanted) {
    if (platformOwned(want) || theirs.includes(want)) continue;
    problems.push(`${file} drops ${want}`);
  }
}

if (problems.length > 0) {
  console.error("Platform bundle configs drop resources the base config ships:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nA platform `resources` array REPLACES the base one. List the resource in"
    + "\nthe platform config too, or take it out of the base config."
  );
  process.exit(1);
}

const checked = overrides.length;
console.log(
  `bundle resources fine: ${wanted.length} in the base config, `
  + `${checked} platform override${checked === 1 ? "" : "s"} keep them`
);
