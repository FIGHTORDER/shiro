import assert from "node:assert/strict";
import test from "node:test";

import {
  HOME, MAX_ZOOM, MIN_ZOOM, clampView, focus, place, planetAt, radius, zoomAt,
} from "./galaxyView.ts";

const SIZE = { width: 1000, height: 600 };

test("at rest the galaxy fills the viewport and cannot be panned", () => {
  // Panning at zoom 1 would drag empty background into view, which reads as a
  // bug rather than as a feature.
  const view = clampView({ zoom: 1, x: 200, y: -50 }, SIZE);
  assert.deepEqual(view, HOME);
});

test("the zoom is held between its limits", () => {
  assert.equal(clampView({ zoom: 0.1, x: 0, y: 0 }, SIZE).zoom, MIN_ZOOM);
  assert.equal(clampView({ zoom: 99, x: 0, y: 0 }, SIZE).zoom, MAX_ZOOM);
});

test("panning stops where the galaxy would leave the window", () => {
  // At 2x there is exactly half a viewport of slack in each direction.
  const view = clampView({ zoom: 2, x: 9999, y: -9999 }, SIZE);
  assert.equal(view.x, SIZE.width / 2);
  assert.equal(view.y, -SIZE.height / 2);
});

test("a planet's normalised position lands where the maths says", () => {
  assert.deepEqual(place({ x: 0.5, y: 0.5 }, HOME, SIZE), { x: 500, y: 300 });
  assert.deepEqual(place({ x: 0, y: 0 }, HOME, SIZE), { x: 0, y: 0 });
  assert.deepEqual(place({ x: 1, y: 1 }, HOME, SIZE), { x: 1000, y: 600 });
});

test("a planet with no position is put in the middle rather than at the corner", () => {
  assert.deepEqual(place({}, HOME, SIZE), { x: 500, y: 300 });
});

test("zooming keeps what is under the cursor under the cursor", () => {
  // The whole point of zoomAt. Zooming about the centre instead would slide
  // the planet away exactly as the player tries to look at it.
  const at = { x: 750, y: 150 };
  const before = place({ x: 0.75, y: 0.25 }, HOME, SIZE);
  assert.deepEqual(before, at, "the planet starts under the cursor");

  const zoomed = zoomAt(HOME, SIZE, 2, at);
  const after = place({ x: 0.75, y: 0.25 }, zoomed, SIZE);
  assert.ok(Math.abs(after.x - at.x) < 0.001, `x moved to ${after.x}`);
  assert.ok(Math.abs(after.y - at.y) < 0.001, `y moved to ${after.y}`);
});

test("zooming out from the limit returns to exactly home", () => {
  let view = zoomAt(HOME, SIZE, 3, { x: 800, y: 100 });
  view = zoomAt(view, SIZE, 1 / 3, { x: 800, y: 100 });
  assert.deepEqual(view, HOME, "no drift left behind");
});

test("planets grow more slowly than the map, so zooming spreads them out", () => {
  const small = radius(44, HOME);
  const big = radius(44, { zoom: 4, x: 0, y: 0 });
  assert.equal(small, 22);
  assert.equal(big, 44, "four times the zoom, twice the radius");
});

const PLANETS = [
  { id: 1, at: { x: 0.5, y: 0.5 }, size: 44 },
  { id: 2, at: { x: 0.52, y: 0.5 }, size: 44 },
  { id: 3, at: { x: 0.1, y: 0.1 }, size: 44 },
];

test("clicking picks the nearest planet, not the first one drawn", () => {
  // 1 and 2 overlap at rest. A point just right of 2's centre belongs to 2
  // even though 1 comes first in the list.
  const near2 = place({ x: 0.52, y: 0.5 }, HOME, SIZE);
  assert.equal(planetAt(near2, PLANETS, HOME, SIZE), 2);

  const near1 = place({ x: 0.5, y: 0.5 }, HOME, SIZE);
  assert.equal(planetAt(near1, PLANETS, HOME, SIZE), 1);
});

test("clicking empty space picks nothing", () => {
  assert.equal(planetAt({ x: 990, y: 590 }, PLANETS, HOME, SIZE), undefined);
});

test("focusing a planet brings it to the middle", () => {
  // Far enough from the edge that centring it does not need more pan than the
  // clamp allows - see the test below for what happens when it does.
  const view = focus({ x: 0.35, y: 0.6 }, SIZE, 2);
  const at = place({ x: 0.35, y: 0.6 }, view, SIZE);
  assert.ok(Math.abs(at.x - SIZE.width / 2) < 0.001, `x at ${at.x}`);
  assert.ok(Math.abs(at.y - SIZE.height / 2) < 0.001, `y at ${at.y}`);
});

test("focusing a planet near the edge stops at the edge rather than showing background", () => {
  // A planet at 0.2 cannot reach the centre at 2x: centring it needs 600px of
  // pan and only 500 is available. Showing the planet off-centre is right;
  // showing empty space beside the galaxy is not.
  const view = focus({ x: 0.2, y: 0.8 }, SIZE, 2);
  assert.deepEqual(view, clampView(view, SIZE), "within bounds");
  assert.equal(view.x, 500, "pinned to the slack, not the 600 centring wants");

  const at = place({ x: 0.2, y: 0.8 }, view, SIZE);
  assert.ok(at.x > 0 && at.x < SIZE.width, "still on screen");
});

test("a zero or missing planet size still draws something clickable", () => {
  assert.ok(radius(0, HOME) > 0);
  assert.ok(radius(undefined, HOME) > 0);
});
