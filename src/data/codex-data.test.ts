import assert from "node:assert/strict";
import test from "node:test";

import units from "./codex.json" with { type: "json" };
import proseFile from "./codex-prose.json" with { type: "json" };
import type { Prose } from "../net/codex.ts";

/* TypeScript widens the imported JSON into a union of 230 literal shapes, so a
   field absent from any one of them is not readable at all. The declared type
   is the one the application uses. */
const prose: Record<string, Prose> = proseFile.prose;

/* The generated data, checked rather than trusted.
 *
 * Both of these shipped wrong once. Neither is a bug in any function this
 * repository can unit-test - the generators ran, wrote plausible JSON and said
 * nothing. The only place the mistake exists is the file, so the file is what
 * gets asserted. */

const text = (p: Prose) =>
  [p.summary, p.description, ...(p.tactics ?? [])].filter(Boolean).join(" ");

test("no wiki filing markup survives into the prose", () => {
  /* `[[Category:Raiders]]` is a filing instruction. MediaWiki renders it as a
     footer strip, never as text, so unwrapping it like an ordinary link ended
     every other description with a stray "Category:Raiders". */
  const dirty = Object.entries(prose)
    .filter(([, p]) => /\[\[|\]\]|(?:Category|File|Image|Media):/.test(text(p)))
    .map(([id]) => id);
  assert.deepEqual(dirty, [], "these entries carry unrendered wiki markup");
});

test("the engine's own scaffolding is not listed as units", () => {
  /* "LOS Provider", "Fake AA target", "Terraform", "Empirical DPS thing" - the
     jumpjet script's target dummy and the balance team's test objects. They
     have stats and names, and a player will never see one. */
  const scaffolding = units.units
    .map(u => u.id)
    .filter(id => /^fakeunit|^terraunit$|sink$|^empiricaldpser|^pw_/.test(id));
  assert.deepEqual(scaffolding, []);
});

test("tactics are separate points, not one block of prose", () => {
  const withTactics = Object.values(prose).filter(p => p.tactics?.length);
  assert.ok(withTactics.length > 50, `only ${withTactics.length} units have tactics`);
  for (const p of withTactics) assert.ok(Array.isArray(p.tactics));
});

test("every unit the prose describes is a unit the game still defines", () => {
  const known = new Set(units.units.map(u => u.id));
  const orphans = Object.keys(prose).filter(id => !known.has(id));
  assert.deepEqual(orphans, [], "prose for units that are not in the dataset");
});

test("nearly every unit has a picture to draw", () => {
  /* The pictures are files on disk rather than data, so the assertion that can
     be made here is the count. `gen-unitpics.mjs --check` runs before the
     suite and is what catches a picture left behind by a removed unit. */
  const declared = units.units.filter(u => u.icon).length;
  assert.ok(declared > units.units.length * 0.9,
    `only ${declared} of ${units.units.length} units name a picture`);
});
