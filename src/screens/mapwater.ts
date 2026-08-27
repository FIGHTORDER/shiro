/**
 * What a waterline does to a map.
 *
 * Two halves of one sum, kept out of the components that use them because
 * they are arithmetic and worth pinning: the 3D view measures the heightmap
 * once as it builds, and the dialog turns that measurement into a sentence
 * every time the slider moves.
 */

/**
 * How the terrain is distributed, as 101 buckets of normalised height.
 *
 * Enough to answer "how much of this map is under a given waterline" to the
 * nearest percent without holding on to the whole grid or re-reading pixels
 * every time the slider moves.
 */
export interface TerrainProfile {
  buckets: number[];
  total: number;
}

export function profileOf(heights: ArrayLike<number>): TerrainProfile {
  const buckets = new Array(101).fill(0);
  for (let i = 0; i < heights.length; i++) {
    const b = Math.min(100, Math.max(0, Math.round(heights[i] * 100)));
    buckets[b]++;
  }
  return { buckets, total: heights.length };
}

/**
 * How much of the map sits under a waterline, as a sentence.
 *
 * The slider's own position already shows where the line is; the number worth
 * reading is what that does to the map. `undefined` until the heightmap has
 * been measured, which is one frame after the dialog opens, and again from the
 * moment a different map is asked for: a percentage that belongs to the map
 * before this one is worse than no percentage at all.
 */
export function floodedAt(profile: TerrainProfile | undefined, water: number): string | undefined {
  if (!profile || !profile.total) return undefined;
  const cut = Math.min(100, Math.max(0, Math.round(water * 100)));
  let under = 0;
  for (let b = 0; b < cut; b++) under += profile.buckets[b];
  const pct = (under / profile.total) * 100;
  if (pct <= 0) return "nothing under water";
  if (pct >= 99.5) return "all under water";
  // Under a percent is still worth distinguishing from none at all.
  return (pct < 1 ? "<1" : Math.round(pct)) + "% under water";
}
