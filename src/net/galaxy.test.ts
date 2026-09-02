import assert from "node:assert/strict";
import test from "node:test";

import { briefing, initialPlanets, planetName, reachable } from "./galaxy.ts";
import type { Campaign } from "./galaxy.ts";

/**
 * The galaxy graph, which decides what a player may click.
 *
 * Tested here rather than in the screen because a `.jsx` cannot be imported by
 * a test, and this is the part that can be wrong in a way nobody notices: a
 * campaign that opens too much is only visible to someone who has played it.
 */

const GALAXY: Campaign = {
  planets: [
    { name: "Im Jaleth" }, { name: "Gulon" }, { name: "Prime" }, { name: "Far" },
  ],
  planetEdgeList: [[1, 2], [2, 3], [3, 4]],
  initialPlanets: [1],
};

test("a new campaign can only start where it says it starts", () => {
  const open = reachable(GALAXY, []);
  assert.deepEqual([...open].sort(), [1]);
});

test("capturing a planet opens its neighbours", () => {
  const open = reachable(GALAXY, [1]);
  assert.deepEqual([...open].sort(), [1, 2]);
});

test("an edge opens both ways, whichever end it was written from", () => {
  // The edge list has [2,3] only; capturing 3 must open 2 as well as the other
  // way round, because the galaxy is traversable in both directions.
  const open = reachable(GALAXY, [3]);
  assert.ok(open.has(2), "backwards along the edge");
  assert.ok(open.has(4), "forwards along the edge");
});

test("a captured planet stays open, because replaying it raises the difficulty it was beaten at", () => {
  const open = reachable(GALAXY, [1, 2]);
  assert.ok(open.has(1));
  assert.ok(open.has(2));
});

test("a galaxy that names no way in still has one", () => {
  // Otherwise the campaign is unplayable rather than merely odd.
  assert.deepEqual(initialPlanets({ planets: [] }), [1]);
  assert.deepEqual(initialPlanets({ planets: [], initialPlanets: [] }), [1]);
});

test("initial planets are read whether Lua handed us a list or a table", () => {
  assert.deepEqual(initialPlanets({ planets: [], initialPlanets: [3, 7] }), [3, 7]);
  // A Lua table keyed some other way arrives as an object.
  assert.deepEqual(initialPlanets({ planets: [], initialPlanets: { a: 5, b: 6 } }), [5, 6]);
});

test("a planet with no edges at all is unreachable rather than an error", () => {
  const island: Campaign = { planets: [{}, {}], planetEdgeList: [], initialPlanets: [1] };
  const open = reachable(island, [1]);
  assert.ok(!open.has(2));
});

test("a nameless planet is still called something", () => {
  assert.equal(planetName({ name: "Gulon" }, 2), "Gulon");
  assert.equal(planetName({ name: "   " }, 2), "Planet 2");
  assert.equal(planetName(undefined, 9), "Planet 9");
});

test("the briefing prefers the long text the way the game does", () => {
  assert.equal(briefing({ infoDisplay: { text: "short", extendedText: "long" } }), "long");
  assert.equal(briefing({ infoDisplay: { text: "short" } }), "short");
  assert.equal(briefing({}), "");
});

/**
 * The campaign's progression commands have to be reachable from the interface.
 *
 * This exists because they were not. `finishPlanet`, `applyReward`, `readCodex`
 * and `setLoadout` were all written, registered and tested on the Rust side,
 * and nothing in `src/` ever called any of them - so winning a planet recorded
 * nothing, `planetsCaptured` stayed empty, and every planet after the first
 * stayed "Not reachable yet" forever. Every unit test passed the whole time,
 * because each half worked; only the join was missing.
 *
 * Asserted by reading the screens, the way `publishSweep.test.ts` reads the
 * workflow: what is being checked is that two files agree, and no amount of
 * testing either one alone can see it.
 */
import { readFileSync, readdirSync } from "node:fs";

function frontendSource(): string {
  const parts = [readFileSync("src/App.jsx", "utf8")];
  for (const name of readdirSync("src/screens")) {
    if (name.endsWith(".jsx")) parts.push(readFileSync(`src/screens/${name}`, "utf8"));
  }
  return parts.join("\n");
}

test("winning a planet is recorded and rewarded by something the player can reach", () => {
  const source = frontendSource();
  for (const fn of ["finishPlanet", "applyReward"]) {
    assert.ok(
      source.includes(fn),
      `${fn} has no caller in the interface, so campaign progress is never saved`,
    );
  }
});

test("the commands that are deliberately not wired are still only these", () => {
  /* Not a wish list - a boundary. `readCodex` needs a codex screen and
     `setLoadout` needs the commander loadout screen, and neither exists yet;
     `commanderLevel` therefore never moves, which is only harmless while no
     screen reads it. If one of these gains a caller, delete it from here. If
     something *else* stops being called, the test above is the one that
     should have caught it. */
  const source = frontendSource();
  const unwired = ["readCodex", "setLoadout"].filter(fn => !source.includes(fn));
  assert.deepEqual(
    unwired,
    ["readCodex", "setLoadout"],
    "a screen now uses one of these - update this list",
  );
});
