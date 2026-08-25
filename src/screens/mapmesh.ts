/**
 * The geometry behind the 3D map view, kept apart from the drawing so it can
 * be tested without a graphics context.
 *
 * Heights arrive as one float per lattice point in 0..1, read out of the 8-bit
 * heightmap Zero-K publishes. Nothing here knows about WebGL.
 */

export interface Mesh {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  idx: Uint16Array | Uint32Array;
}

export function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * The map's footprint from the shape of its published picture.
 *
 * Zero-K draws these at the square of the map's real ratio: a 12x16 map gets a
 * 576x1024 image, and (12/16) squared is 0.5625, which is 576/1024. Taking the
 * root back out recovers the proportions, though not the samples.
 */
export function aspectFromImage(pxWidth: number, pxHeight: number): number {
  if (!(pxWidth > 0) || !(pxHeight > 0)) return 1;
  return Math.sqrt(pxWidth / pxHeight);
}

/**
 * A displaced grid over the heightmap, sized to the map's real footprint.
 *
 * The longer axis is normalised to one unit so the camera framing does not
 * change with the map, and normals use each axis's own spacing: a single step
 * for both is what makes relief shading wrong on a map that is not square.
 */
export function buildMesh(
  h: Float32Array | number[], cols: number, rows: number, aspect: number,
): Mesh {
  const shape = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const halfX = shape >= 1 ? 0.5 : 0.5 * shape;
  const halfZ = shape >= 1 ? 0.5 / shape : 0.5;

  const pos = new Float32Array(cols * rows * 3);
  const nrm = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);

  const at = (x: number, z: number): number =>
    h[Math.min(rows - 1, Math.max(0, z)) * cols + Math.min(cols - 1, Math.max(0, x))];

  const stepX = (halfX * 2) / (cols - 1);
  const stepZ = (halfZ * 2) / (rows - 1);

  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const i = z * cols + x;
      const fx = x / (cols - 1);
      const fz = z / (rows - 1);
      pos[i * 3] = (fx - 0.5) * halfX * 2;
      pos[i * 3 + 1] = at(x, z);
      pos[i * 3 + 2] = (fz - 0.5) * halfZ * 2;
      uv[i * 2] = fx;
      uv[i * 2 + 1] = fz;
      const dx = (at(x + 1, z) - at(x - 1, z)) / (2 * stepX);
      const dz = (at(x, z + 1) - at(x, z - 1)) / (2 * stepZ);
      const n = norm([-dx, 1, -dz]);
      nrm[i * 3] = n[0];
      nrm[i * 3 + 1] = n[1];
      nrm[i * 3 + 2] = n[2];
    }
  }

  const quads = (cols - 1) * (rows - 1);
  /* Index width follows the vertex count, not the index count: a 16-bit index
     cannot name a vertex past 65535. */
  const idx = cols * rows > 65536
    ? new Uint32Array(quads * 6)
    : new Uint16Array(quads * 6);
  let k = 0;
  for (let z = 0; z < rows - 1; z++) {
    for (let x = 0; x < cols - 1; x++) {
      const a = z * cols + x;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }

  return { pos, nrm, uv, idx };
}
