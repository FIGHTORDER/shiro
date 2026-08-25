/**
 * Run with:  node --test src/screens/mapmesh.test.ts
 *
 * The 3D view is hard to eyeball for correctness - a map that is subtly the
 * wrong shape still looks like a map - so the two things that decide whether
 * it is telling the truth are pinned here: the footprint a non-square map gets,
 * and the normals that relief shading is computed from.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { aspectFromImage, buildMesh, norm } from "./mapmesh.ts";

const flat = (cols: number, rows: number) => new Float32Array(cols * rows);

function extent(m: { pos: Float32Array }, axis: 0 | 2) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = axis; i < m.pos.length; i += 3) {
    lo = Math.min(lo, m.pos[i]);
    hi = Math.max(hi, m.pos[i]);
  }
  return hi - lo;
}

test("the published picture's shape is the square of the map's", () => {
  // Comet Catcher Redux is 12x16 and publishes a 576x1025 heightmap.
  assert.ok(Math.abs(aspectFromImage(576, 1024) - 12 / 16) < 1e-9);
  // Iced Coffee is 8x8 and publishes a square one.
  assert.equal(aspectFromImage(513, 513), 1);
});

test("a degenerate image shape does not produce a NaN footprint", () => {
  assert.equal(aspectFromImage(0, 100), 1);
  assert.equal(aspectFromImage(100, 0), 1);
});

test("a tall map is laid out taller than it is wide", () => {
  const m = buildMesh(flat(8, 8), 8, 8, 12 / 16);
  const w = extent(m, 0);
  const d = extent(m, 2);
  assert.ok(d > w, `expected depth ${d} to exceed width ${w}`);
  assert.ok(Math.abs(w / d - 12 / 16) < 1e-6);
  // The longer axis is normalised, so framing does not move with the map.
  assert.ok(Math.abs(d - 1) < 1e-6);
});

test("a wide map is laid out wider than it is tall", () => {
  const m = buildMesh(flat(8, 8), 8, 8, 16 / 12);
  const w = extent(m, 0);
  const d = extent(m, 2);
  assert.ok(w > d);
  assert.ok(Math.abs(w - 1) < 1e-6);
});

test("flat ground points straight up whatever the map's shape", () => {
  for (const aspect of [1, 12 / 16, 16 / 12, 4]) {
    const m = buildMesh(flat(6, 6), 6, 6, aspect);
    for (let i = 0; i < m.nrm.length; i += 3) {
      assert.ok(Math.abs(m.nrm[i]) < 1e-6, "flat ground has no x tilt");
      assert.ok(Math.abs(m.nrm[i + 1] - 1) < 1e-6, "flat ground points up");
      assert.ok(Math.abs(m.nrm[i + 2]) < 1e-6, "flat ground has no z tilt");
    }
  }
});

/* The bug this guards: using one axis's spacing for both derivatives. The z
   derivative is the one that goes wrong, so the ramp has to run along z - a
   ramp along x passes either way, which an earlier version of this test did. */
test("a rise along z is read against z's own spacing", () => {
  const cols = 8;
  const rows = 8;
  const ramp = new Float32Array(cols * rows);
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) ramp[z * cols + x] = z / (rows - 1);
  }

  /* A map wide in x is short in z, so the same rise covers less ground and is
     the steeper slope. Divide by stepX here instead and the order inverts. */
  const wide = buildMesh(ramp, cols, rows, 4);
  const tall = buildMesh(ramp, cols, rows, 0.25);

  const zTilt = (m: { nrm: Float32Array }) => {
    const i = (3 * cols + 3) * 3;
    return Math.abs(m.nrm[i + 2] / m.nrm[i + 1]);
  };
  assert.ok(zTilt(wide) > zTilt(tall),
    `a map short in z should read the same rise as steeper: ${zTilt(wide)} vs ${zTilt(tall)}`);
});

test("every index names a vertex that exists", () => {
  const cols = 9;
  const rows = 5;
  const m = buildMesh(flat(cols, rows), cols, rows, 1);
  assert.equal(m.idx.length, (cols - 1) * (rows - 1) * 6);
  for (const i of m.idx) assert.ok(i < cols * rows, `index ${i} is out of range`);
  assert.equal(m.pos.length, cols * rows * 3);
  assert.equal(m.uv.length, cols * rows * 2);
});

test("uv covers the whole picture corner to corner", () => {
  const cols = 4;
  const rows = 7;
  const m = buildMesh(flat(cols, rows), cols, rows, 1);
  assert.equal(m.uv[0], 0);
  assert.equal(m.uv[1], 0);
  assert.equal(m.uv[m.uv.length - 2], 1);
  assert.equal(m.uv[m.uv.length - 1], 1);
});

test("a mesh that fits 16-bit indices uses them", () => {
  const m = buildMesh(flat(64, 64), 64, 64, 1);
  assert.ok(m.idx instanceof Uint16Array);
});

test("norm leaves a zero vector alone rather than dividing by zero", () => {
  assert.deepEqual(norm([0, 0, 0]), [0, 0, 0]);
});
