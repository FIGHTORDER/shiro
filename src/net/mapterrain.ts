import { invoke } from "@tauri-apps/api/core";

import { inTauri } from "./connection.ts";
import type { CatalogueMap } from "./zkcatalogue.ts";

/**
 * The two pictures a 3D view of a map needs.
 *
 * Fetched in Rust rather than by the webview: zero-k.info sends no
 * `Access-Control-Allow-Origin` on `/Resources/`, so a canvas textured from
 * those URLs directly is tainted and cannot be read back or drawn from.
 */
export interface MapTerrain {
  /** `data:` URLs, so the canvas that reads them counts as same-origin. */
  heightmap: string;
  minimap: string;
}

/* About 90 kB a map, and a player browsing a catalogue comes back to the same
   few. Kept for the session; the assets change when a map is republished, not
   while somebody is looking at the list. */
const cache = new Map<string, Promise<MapTerrain>>();

export function mapTerrain(name: string): Promise<MapTerrain> {
  const key = name.trim();
  if (!key) return Promise.reject(new Error("no map name given"));
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      if (!inTauri()) throw new Error("the 3D view needs the desktop app");
      return await invoke<MapTerrain>("zks_map_terrain", { name: key });
    })();
    /* A failure is not cached: a map that 404s today may be published
       tomorrow, and a network blip should not disable the view for the
       session. */
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

/**
 * The map's true width over its height.
 *
 * `minimapRatio` gives the ratio the published image is drawn at, which is the
 * square of the real one: a 12x16 map publishes a 576x1024 picture, and
 * (12/16) squared is 0.5625, which is 576/1024. The 3D view needs the real
 * footprint, so it takes the square root back out.
 */
export function worldAspect(
  m: Pick<CatalogueMap, "width" | "height"> | undefined,
): number | undefined {
  if (!m?.width || !m?.height) return undefined;
  return m.width / m.height;
}
