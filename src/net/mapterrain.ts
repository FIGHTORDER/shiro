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

/**
 * Why a fetch failed, said rather than implied.
 *
 * The dialog used to tell a map with no published heightmap from a dead
 * connection by testing the error text for the word "heightmap". Rust names
 * the asset it could not reach, and the URL it names contains that word, so
 * an unreachable site was reported as a map Zero-K had never published. Rust
 * now sends `{kind, asset, message}` and the kind is what gets branched on.
 *
 * - `missing`: zero-k.info answered, and not with an image.
 * - `network`: zero-k.info was not reached.
 * - `unsupported`: asked for outside the desktop app, where it cannot work.
 * - `other`: anything else. The message is the whole explanation.
 */
export type TerrainFailureKind = "missing" | "network" | "unsupported" | "other";

export class TerrainFailure extends Error {
  readonly kind: TerrainFailureKind;
  /** `"heightmap"` or `"minimap"`, when the failure belongs to one of them. */
  readonly asset: string | undefined;

  constructor(kind: TerrainFailureKind, message: string, asset?: string) {
    super(message);
    this.name = "TerrainFailure";
    this.kind = kind;
    this.asset = asset;
  }
}

const KINDS = new Set(["missing", "network", "unsupported", "other"]);

/** Whatever `invoke` rejected with, as something with a kind on it. */
export function asTerrainFailure(e: unknown): TerrainFailure {
  if (e instanceof TerrainFailure) return e;
  const o = e as { kind?: unknown; asset?: unknown; message?: unknown } | null | undefined;
  const kind = typeof o?.kind === "string" && KINDS.has(o.kind) ? (o.kind as TerrainFailureKind) : "other";
  const message = typeof o?.message === "string" && o.message ? o.message : String(e);
  return new TerrainFailure(kind, message, typeof o?.asset === "string" ? o.asset : undefined);
}

/* About 90 kB a map, and a player browsing a catalogue comes back to the same
   few. Kept for the session; the assets change when a map is republished, not
   while somebody is looking at the list. */
const cache = new Map<string, Promise<MapTerrain>>();

export function mapTerrain(name: string): Promise<MapTerrain> {
  const key = name.trim();
  if (!key) return Promise.reject(new TerrainFailure("other", "no map name given"));
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      if (!inTauri()) throw new TerrainFailure("unsupported", "the 3D view needs the desktop app");
      try {
        return await invoke<MapTerrain>("zks_map_terrain", { name: key });
      } catch (e) {
        throw asTerrainFailure(e);
      }
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
