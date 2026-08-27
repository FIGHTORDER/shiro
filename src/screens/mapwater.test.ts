/**
 * Run with:  node --test src/screens/mapwater.test.ts
 *
 * The waterline readout is a number a player will believe, so the two ways it
 * can lie are pinned here: rounding a real percentage to something confident
 * and wrong, and reporting a percentage at all when the map it was measured
 * from is no longer the map on screen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { floodedAt, profileOf } from "./mapwater.ts";

/** A profile with `n` samples at each of the given normalised heights. */
function heights(...hs: number[]) {
  return profileOf(Float32Array.from(hs));
}

test("a flat map is all or nothing", () => {
  const flat = heights(0.5, 0.5, 0.5, 0.5);
  assert.equal(floodedAt(flat, 0), "nothing under water");
  assert.equal(floodedAt(flat, 0.5), "nothing under water");
  assert.equal(floodedAt(flat, 0.51), "all under water");
  assert.equal(floodedAt(flat, 1), "all under water");
});

test("half a map under the line reads as half", () => {
  const half = heights(0.1, 0.1, 0.9, 0.9);
  assert.equal(floodedAt(half, 0.5), "50% under water");
});

/* A single flooded pixel in a thousand is still a lake, and "0%" would read
   as a map with no water at all. */
test("less than a percent is not rounded away to none", () => {
  const nearlyDry = profileOf(Float32Array.from(
    Array.from({ length: 1000 }, (_, i) => (i === 0 ? 0.01 : 0.9)),
  ));
  assert.equal(floodedAt(nearlyDry, 0.5), "<1% under water");
});

/* One dry island in a hundred is still land; one in a thousand is not worth
   the sentence, and "all" is the honest reading. */
test("a last dry percent is kept, a last dry tenth is not", () => {
  const dry1in100 = profileOf(Float32Array.from(
    Array.from({ length: 100 }, (_, i) => (i === 0 ? 0.9 : 0.01)),
  ));
  assert.equal(floodedAt(dry1in100, 0.5), "99% under water");

  const dry1in1000 = profileOf(Float32Array.from(
    Array.from({ length: 1000 }, (_, i) => (i === 0 ? 0.9 : 0.01)),
  ));
  assert.equal(floodedAt(dry1in1000, 0.5), "all under water");
});

/* The dialog stays mounted between maps and clears the profile when the map
   changes, so this is the state the hint is asked about mid-fetch. Anything
   but `undefined` here is the previous map's number on the new map's screen. */
test("no profile is no sentence, not a stale one", () => {
  assert.equal(floodedAt(undefined, 0.4), undefined);
  assert.equal(floodedAt({ buckets: new Array(101).fill(0), total: 0 }, 0.4), undefined);
});

/* Terrain exactly at the line is not under it, which is why the highest
   ground on a map is still dry at a waterline of 1. */
test("the waterline is clamped to the range the profile covers", () => {
  const m = heights(0, 0.5, 1);
  assert.equal(floodedAt(m, -3), "nothing under water");
  assert.equal(floodedAt(m, 1), "67% under water");
  assert.equal(floodedAt(m, 7), "67% under water");
});

test("a profile counts every sample once, in range", () => {
  const p = heights(0, 0.5, 1, 1.4, -0.2);
  assert.equal(p.total, 5);
  assert.equal(p.buckets.length, 101);
  assert.equal(p.buckets.reduce((a, b) => a + b, 0), 5);
  // Out of range heights land on the ends rather than off the array.
  assert.equal(p.buckets[0], 2);
  assert.equal(p.buckets[100], 2);
  assert.equal(p.buckets[50], 1);
});
