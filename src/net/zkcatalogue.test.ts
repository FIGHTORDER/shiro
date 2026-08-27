/**
 * Run with:  node --test src/net/zkcatalogue.test.ts
 *
 * The half of the catalogue bug that lives on this side of the wire.
 *
 * Rust sending `is_1v1` to a client reading `is1v1` is caught in
 * `zkcontent.rs`; what is caught here is everything that reads those fields
 * once they arrive - a filter that matched by string prefix, a rating that
 * could not tell "nobody voted" from "everybody hated it", and a "best rated"
 * order that one five-star vote could win.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import D from "../data.js";
import {
  forgetCatalogue, KINDS, mapCatalogue, minimapRatio, normaliseMapName, RATING_MAX, ratingOf, ratingRanker, sidesOf, sizeOf, suitedTo, thumbAspect,
} from "./zkcatalogue.ts";
import type { CatalogueMap } from "./zkcatalogue.ts";

const maps: CatalogueMap[] = D.maps;

/** A map with nothing flagged, to vary one field at a time from. */
function plain(over: Partial<CatalogueMap> = {}): CatalogueMap {
  return {
    name: "Test", resourceId: 1,
    is1v1: false, isTeams: false, isFfa: false,
    isChickens: false, isSpecial: false, isAssymetrical: false,
    ...over,
  };
}

/* The names Rust must serialise under. Written out rather than derived from the
   type, because a type cannot be wrong at runtime and this is exactly the
   mistake that shipped: the interface said `is1v1` and the wire said `is_1v1`,
   and nothing anywhere disagreed out loud. The demo fixture stands in for the
   wire here - it is the shape the screen is developed against, and it drifting
   would hide the same fault from the click-through. */
const WIRE = [
  "name", "resourceId", "width", "height", "supportLevel", "is1v1", "isTeams",
  "isFfa", "isChickens", "isSpecial", "isAssymetrical", "ffaMaxTeams", "hills",
  "waterLevel", "ratingSum", "ratingCount",
];

test("the demo catalogue is spelled the way the wire spells it", () => {
  assert.ok(maps.length > 0);
  for (const m of maps) {
    for (const key of Object.keys(m)) {
      assert.ok(WIRE.includes(key), `${m.name} carries an unknown field ${key}`);
    }
    // The three every map must have, whatever else the service left out.
    assert.equal(typeof m.name, "string");
    assert.equal(typeof m.resourceId, "number");
    assert.equal(typeof m.is1v1, "boolean");
  }
});

test("a map nobody has voted on has no score, and is not a zero", () => {
  assert.equal(ratingOf(plain()), undefined);
  assert.equal(ratingOf(plain({ ratingCount: 0, ratingSum: 0 })), undefined);
  /* And the other way round: real votes that all came out at the bottom are a
     verdict, and must not be filed under "nobody said". */
  assert.equal(ratingOf(plain({ ratingCount: 4, ratingSum: 0 })), 0);
});

test("the mean is the mean, on a scale the screen can name", () => {
  assert.equal(ratingOf(plain({ ratingSum: 191, ratingCount: 46 })), 191 / 46);
  assert.equal(RATING_MAX, 5);
});

test("what a map is drawn for is the four kinds and nothing else", () => {
  assert.deepEqual(suitedTo(plain({ is1v1: true, isTeams: true })), ["1v1", "Teams"]);
  assert.deepEqual(suitedTo(plain({ isFfa: true, ffaMaxTeams: 6 })), ["FFA"]);
  assert.deepEqual(suitedTo(plain({ isChickens: true })), ["Chickens"]);
  /* Empty is an answer, not a gap - 60 of the 343 catalogue maps are flagged
     for none of the four - and the caller must be able to say so. */
  assert.deepEqual(suitedTo(plain()), []);
});

test("every kind the filter offers is a kind a map can be", () => {
  /* The old filter matched badge text by prefix, so "FFA up to 6" only ever
     matched because the badge happened to start with "FFA". One reworded badge
     and the tickbox would have silently matched nothing. */
  const all = suitedTo(plain({ is1v1: true, isTeams: true, isFfa: true, isChickens: true }));
  assert.deepEqual([...KINDS].sort(), [...all].sort());
});

test("the only player count in the catalogue is the FFA one, and it is not invented", () => {
  assert.equal(sidesOf(plain({ isFfa: true, ffaMaxTeams: 6 })), "up to 6 ways");
  assert.equal(sidesOf(plain({ is1v1: true })), "2 players");
  // A teams map carries no count at all. Its dimensions are not one.
  assert.equal(sidesOf(plain({ isTeams: true, width: 24, height: 24 })), undefined);
  assert.equal(sidesOf(plain({ isFfa: true })), undefined);
});


test("size is what the service said, or nothing", () => {
  assert.equal(sizeOf(plain({ width: 12, height: 16 })), "12 × 16");
  assert.equal(sizeOf(plain({ width: 12 })), undefined);
  assert.equal(sizeOf(plain()), undefined);
});

/* Measured against the live service, thirteen maps in both orientations: the
   thumbnail carries the map's proportions and the minimap squares them. A 12x8
   map is a 96x64 thumbnail and a 1024x454 minimap, and 454/1024 is (8/12)**2. */
test("a minimap is drawn in the shape zero-k.info actually generates", () => {
  assert.equal(minimapRatio(plain({ width: 12, height: 8 })), 2.25);
  assert.equal(minimapRatio(plain({ width: 16, height: 16 })), 1);
  assert.equal(minimapRatio(plain()), undefined);
});

test("one five-star vote does not outrank the map the ladder plays", () => {
  /* Shaped like the live catalogue rather than taken from it: a middling
     average, one map a lot of people rated well, and one map one person rated
     perfectly. Five maps in the real 343 are five out of five from a single
     vote, and the plain mean puts all five of them above every map anybody
     actually plays - which is the "sort by does not work" the owner would have
     reported next, once the scores arrived at all. */
  const shelf = [
    plain({ name: "Middling", ratingSum: 30, ratingCount: 10 }),      // 3.0
    plain({ name: "Ordinary", ratingSum: 36, ratingCount: 12 }),      // 3.0
    plain({ name: "Played", ratingSum: 191, ratingCount: 46 }),       // 4.15, the real
    plain({ name: "One vote", ratingSum: 5, ratingCount: 1 }),        // 5.00  Small Supreme
  ];
  const played = shelf[2], lone = shelf[3];
  assert.ok(ratingOf(lone)! > ratingOf(played)!, "the means really do disagree");

  const rank = ratingRanker(shelf);
  assert.ok(rank(played)! > rank(lone)!, "forty-six votes beat one");
  // And the score on screen is still the map's own, not the smoothed one.
  assert.equal(ratingOf(played), 191 / 46);
});

test("the demo catalogue puts its most-voted map first, not its luckiest", () => {
  const rank = ratingRanker(maps);
  const best = [...maps].sort((a, b) => (rank(b) ?? -1) - (rank(a) ?? -1))[0];
  assert.equal(best.name, "Ravaged_v2", "4.48 from 25 votes");
  assert.equal(ratingOf(maps.find(m => m.name === "FrostyCove v1.13")!), 5);
});

test("an unrated map is unranked, so it sorts apart rather than at zero", () => {
  const rank = ratingRanker(maps);
  assert.equal(rank(plain()), undefined);
  assert.equal(rank(maps.find(m => m.name === "Craterv02")!), undefined);
});

test("a catalogue with no votes at all still ranks without dividing by nothing", () => {
  const rank = ratingRanker([plain(), plain({ name: "Other" })]);
  assert.equal(rank(plain()), undefined);
  assert.equal(rank(plain({ ratingSum: 5, ratingCount: 1 })), (5 * 2.5 + 5) / 6);
});

test("underscores and spaces name the same map", () => {
  assert.equal(normaliseMapName("Comet_Catcher_Redux"), normaliseMapName("comet catcher redux"));
  assert.equal(normaliseMapName("  Chicken_Farm_v02 "), "chicken farm v02");
});

/* These two are the same question with two answers, and reaching for the wrong
   one is what turned the room's map picker into a column of enormous cards. A
   thumbnail is drawn at the map's real proportions; a minimap is drawn at the
   square of them. */
test("a thumbnail's ratio is the map's own, not the minimap's squared", () => {
  const tall = { width: 4, height: 16 };
  assert.equal(thumbAspect(tall), 0.25);
  assert.equal(minimapRatio(tall as never), 0.0625);
  assert.ok(thumbAspect(tall) !== minimapRatio(tall as never),
    "if these ever agree for a non-square map, one of them is wrong");
});

test("a square map is the one case where the two agree", () => {
  const square = { width: 16, height: 16 };
  assert.equal(thumbAspect(square), 1);
  assert.equal(minimapRatio(square as never), 1);
});

test("a map the catalogue has no dimensions for has no ratio either", () => {
  assert.equal(thumbAspect(undefined), undefined);
  assert.equal(thumbAspect({ width: 0, height: 16 }), undefined);
  assert.equal(thumbAspect({ width: 16, height: undefined }), undefined);
});

/**
 * Run one `mapCatalogue` call as if it were inside the app, against a stub that
 * either answers or throws. The same shape `ais.test.ts` uses: `inTauri` looks
 * for `window.__TAURI_INTERNALS__` and `invoke` calls straight through it.
 */
async function catalogueReading(invoke: () => Promise<unknown>) {
  const global = globalThis as { window?: unknown };
  const before = global.window;
  global.window = { __TAURI_INTERNALS__: { invoke } };
  try {
    return await mapCatalogue();
  } finally {
    if (before === undefined) delete global.window;
    else global.window = before;
  }
}

test("a catalogue that failed once is not the answer for the rest of the session", async () => {
  /* The failure used to be memoised: the catch wrapped the whole memoised
     promise, so one hiccup at the moment Maps was first opened left every map
     picker and minimap lookup finding nothing until Shiro was restarted. */
  forgetCatalogue();
  try {
    const dead = await catalogueReading(async () => { throw new Error("offline"); });
    assert.equal(dead.size, 0, "a failed fetch still has to answer with nothing");

    const good = await catalogueReading(async () => [
      { name: "Comet_Catcher_Redux", resourceId: 1, is1v1: true, isTeams: false, isFfa: false,
        isChickens: false, isSpecial: false, isAssymetrical: false },
    ]);
    assert.equal(good.size, 1, "the failure was remembered instead of retried");
    assert.ok(good.has(normaliseMapName("Comet Catcher Redux")));
  } finally {
    forgetCatalogue();
  }
});

test("a catalogue that answered is fetched once and kept", async () => {
  forgetCatalogue();
  try {
    let calls = 0;
    const entry = [
      { name: "Comet_Catcher_Redux", resourceId: 1, is1v1: true, isTeams: false, isFfa: false,
        isChickens: false, isSpecial: false, isAssymetrical: false },
    ];
    await catalogueReading(async () => { calls += 1; return entry; });
    await catalogueReading(async () => { calls += 1; return entry; });
    assert.equal(calls, 1, "the whole point of the memo is one fetch a session");
  } finally {
    forgetCatalogue();
  }
});
