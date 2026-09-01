import assert from "node:assert/strict";
import test from "node:test";

import {
  changesFor, factories, filterUnits, isStructure, matches, roleOf, roles, sortUnits,
} from "./codex.ts";
import type { Codex, Unit } from "./codex.ts";

const glaive: Unit = {
  id: "cloakraid", name: "Glaive", description: "Light Raider Bot",
  cost: 65, health: 230, speed: 115.5, sight: 560,
  weapon: { damage: 10.5, range: 185, reload: 0.3 },
  factory: "Cloakbot Factory",
};
const mex: Unit = {
  id: "staticmex", name: "Metal Extractor", description: "Extracts metal",
  cost: 85, health: 560,
};
const rogue: Unit = {
  id: "shieldskirm", name: "Rogue", description: "Skirmisher Bot",
  cost: 125, health: 520, speed: 54, factory: "Shieldbot Factory",
};
const nameless: Unit = { id: "wreck", name: "Wreck" };

test("a role is read out of the description the game writes", () => {
  assert.equal(roleOf(glaive), "Raider");
  assert.equal(roleOf(rogue), "Skirmisher");
  assert.equal(roleOf(nameless), undefined);
});

test("a longer role name wins over a shorter one inside it", () => {
  /* "Anti-Air" would be missed entirely if a shorter pattern matched first, and
     the unit would land under whatever that shorter one was. */
  const aa: Unit = { id: "x", name: "Hacksaw", description: "Anti-Air Turret" };
  assert.equal(roleOf(aa), "Anti-Air");
});

test("a structure is one that cannot move, not one nothing builds", () => {
  /* Factory membership is the wrong test: plenty of units have no factory
     because nothing lists them, and they are still units. */
  assert.equal(isStructure(mex), true);
  assert.equal(isStructure(glaive), false);
  assert.equal(isStructure(nameless), true);
});

test("search finds a unit by its internal name", () => {
  // Half the community says "cloakraid" when they mean the Glaive.
  assert.equal(matches(glaive, "cloakraid"), true);
  assert.equal(matches(glaive, "glaive"), true);
  assert.equal(matches(glaive, "raider"), true, "the description counts too");
  assert.equal(matches(glaive, "reaver"), false);
});

test("an empty search matches everything", () => {
  assert.equal(matches(glaive, ""), true);
  assert.equal(matches(glaive, "   "), true);
});

test("filters combine rather than replace each other", () => {
  const all = [glaive, rogue, mex];
  assert.deepEqual(filterUnits(all, { factory: "Cloakbot Factory" }).map(u => u.id), ["cloakraid"]);
  assert.deepEqual(filterUnits(all, { role: "Skirmisher" }).map(u => u.id), ["shieldskirm"]);
  assert.deepEqual(filterUnits(all, { factory: "Cloakbot Factory", role: "Skirmisher" }), []);
});

test("sorting puts a missing value last rather than treating it as zero", () => {
  /* A structure has no speed. Sorted as 0 it would head the list, which puts
     the least relevant rows exactly where the eye lands. */
  const sorted = sortUnits([glaive, mex, rogue], "speed");
  assert.deepEqual(sorted.map(u => u.id), ["shieldskirm", "cloakraid", "staticmex"]);
});

test("sorting by cost is ascending, and ties fall back to the name", () => {
  const a: Unit = { id: "a", name: "Zulu", cost: 100 };
  const b: Unit = { id: "b", name: "Alpha", cost: 100 };
  assert.deepEqual(sortUnits([a, b], "cost").map(u => u.name), ["Alpha", "Zulu"]);
});

test("the factory and role lists come from the units present", () => {
  assert.deepEqual(factories([glaive, rogue, mex]), ["Cloakbot Factory", "Shieldbot Factory"]);
  assert.deepEqual(roles([glaive, rogue]).sort(), ["Raider", "Skirmisher"]);
});

test("a unit's change history is every entry that names it, in order", () => {
  const codex = {
    game: "Zero-K v2", units: [glaive], prose: {},
    proseLicence: { licence: "CC BY-SA", licenceUrl: "", source: "" },
    changes: [
      { game: "v2", previous: "v1", recorded: "2026-01-02",
        changed: { cloakraid: { name: "Glaive", fields: { cost: [60, 65] as [number, number] } } },
        added: [], removed: [] },
      { game: "v1", previous: "v0", recorded: "2026-01-01",
        changed: { shieldskirm: { name: "Rogue", fields: { speed: [52, 54] as [number, number] } } },
        added: [], removed: [] },
    ],
  } as Codex;
  const history = changesFor(codex, "cloakraid");
  assert.equal(history.length, 1);
  assert.equal(history[0].entry.game, "v2");
  assert.deepEqual(history[0].change.fields.cost, [60, 65]);
  assert.deepEqual(changesFor(codex, "nothing"), []);
});

test("a cost of zero sorts last, because nothing buildable is free", () => {
  /* Every chicken is cost 0 - the whole PvE roster - so without this the
     default cost-ascending list opens on chickens rather than on anything a
     player can build. */
  const chicken: Unit = { id: "chicken", name: "Chicken", cost: 0, health: 270, speed: 87 };
  const sorted = sortUnits([chicken, glaive, rogue], "cost");
  assert.deepEqual(sorted.map(u => u.id), ["cloakraid", "shieldskirm", "chicken"]);
});

test("a zero is only special for cost, not for the other keys", () => {
  // A speed of zero is a real answer: the thing does not move.
  const still: Unit = { id: "still", name: "Still", speed: 0, health: 10 };
  const sorted = sortUnits([glaive, still], "speed");
  assert.deepEqual(sorted.map(u => u.id), ["still", "cloakraid"]);
});
