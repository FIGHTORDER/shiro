/**
 * Zero-K's content catalogue, for the pickers that need real names.
 *
 * The lobby protocol has no "list all maps" command - the server only tells you
 * about maps that happen to be in an open battle - which is why the host dialog
 * used to suggest whatever one or two maps were live at the time. Zero-K's own
 * content service does have a searchable catalogue.
 */
import { invoke } from "@tauri-apps/api/core";
/* With the extension, as ais.ts and apps.ts have it. Without one this module
   cannot be loaded by `node --test`, which is the other reason it had no unit
   test to fail when its fields stopped arriving. */
import { inTauri } from "./connection.ts";

/**
 * A map found by searching, which is thinner than a catalogue entry on purpose.
 *
 * `FindResourceData` reaches the whole library - the tens of thousands of maps
 * the public catalogue leaves out - and answers with a name, a support level, an
 * id and four of the suitability flags. No dimensions and no rating: the service
 * does not send them, so a screen showing one of these must look less certain
 * than one showing a `CatalogueMap` rather than fill the gap in with zeroes.
 */
export interface MapHit {
  name: string;
  /** Zero-K's rating: "MatchMaker" is the curated ladder set, and sorts first. */
  support: string;
  /** Addresses `/Maps/Detail/<id>`, so a searched map links to itself. */
  resourceId?: number;
  /* Optional throughout, and `undefined` is not `false`: the service sends
     `i:nil` for some hits, and "not told" is a different claim from "no". */
  is1v1?: boolean;
  isTeams?: boolean;
  isFfa?: boolean;
  isSpecial?: boolean;
}

export async function findMaps(query: string): Promise<MapHit[]> {
  if (!canSearchLibrary() || !query.trim()) return [];
  return invoke<MapHit[]>("zks_find_maps", { query });
}

/**
 * Whether the whole library can be searched at all.
 *
 * `findMaps` answers `[]` in the browser demo, and a caller that could not tell
 * that apart from a real miss would say "searching found nothing" about a
 * search it never ran. Two different sentences, so two different questions.
 */
export function canSearchLibrary(): boolean {
  return inTauri();
}

/**
 * One of Zero-K's featured custom game modes.
 *
 * A mode is not simply "a different game". Of the seven featured modes, most
 * name a `game`, Zero Wars names a `map` and runs on stock Zero-K, and Tech-K
 * names neither and is one modoption. Treating a mode as a game would host a
 * plain Zero-K room for two of the seven.
 */
export interface GameMode {
  shortName: string;
  displayName: string;
  game?: string;
  map?: string;
  options: Record<string, string>;
}

export async function gameModes(): Promise<GameMode[]> {
  if (!inTauri()) return [];
  return invoke<GameMode[]>("zks_game_modes");
}

// -------------------------------------------------------------- map pages ---

export interface CatalogueMap {
  name: string;
  resourceId: number;
  /* What the site knows about the map, all of which was already arriving in
     the same response and being discarded - the parser read two fields out of
     sixteen. Optional throughout: a map nobody has rated has no rating, and a
     zero would be a claim rather than a gap. */
  width?: number;
  height?: number;
  /** "Featured", "MatchMaker", or whatever the service adds next. */
  supportLevel?: string;
  is1v1: boolean;
  isTeams: boolean;
  isFfa: boolean;
  isChickens: boolean;
  isSpecial: boolean;
  isAssymetrical: boolean;
  ffaMaxTeams?: number;
  hills?: number;
  waterLevel?: number;
  ratingSum?: number;
  ratingCount?: number;
}

/**
 * Out of five, which is the scale zero-k.info draws its own stars on - the map
 * page renders a 70px strip of 14px stars and fills it to the score.
 *
 * Worth stating in one place, because a bare mean on screen is the thing the
 * owner could not read: "4.7" says nothing until you know what the top is.
 */
export const RATING_MAX = 5;

/**
 * The mean, or nothing at all.
 *
 * `undefined` is not a low score, and callers must draw the two differently: a
 * map nobody has voted on has no opinion attached to it, which is a different
 * statement from a map people disliked. Only the count decides that - a sum of
 * zero across real votes would still be a verdict.
 */
export function ratingOf(m: CatalogueMap): number | undefined {
  if (!m.ratingCount) return undefined;
  return (m.ratingSum ?? 0) / m.ratingCount;
}

/** "16 x 16", or nothing when the service did not say. */
export function sizeOf(m: CatalogueMap): string | undefined {
  return m.width && m.height ? `${m.width} \u00d7 ${m.height}` : undefined;
}

/** The four kinds the catalogue flags. Also the filter's vocabulary. */
export const KINDS = ["1v1", "Teams", "FFA", "Chickens"] as const;
export type Kind = (typeof KINDS)[number];

/**
 * What this map is drawn for, in the words the lobby already uses.
 *
 * Kinds only, with no counts folded into the strings - the filter and the
 * badges read the same list, and a filter that had to match "FFA up to 6" by
 * prefix was one string edit away from silently matching nothing. The count
 * lives in `sidesOf` instead.
 *
 * Empty when the service flags nothing, which is a real answer: 60 of the 343
 * catalogue maps are flagged for none of the four, and plenty of maps are
 * simply maps. The caller must say so rather than guess at "Teams".
 *
 * Takes a search hit too, where the flags are optional and `undefined` means
 * the service said nothing rather than said no.
 */
export function suitedTo(m: CatalogueMap | MapHit): Kind[] {
  const out: Kind[] = [];
  if (m.is1v1) out.push("1v1");
  if (m.isTeams) out.push("Teams");
  if (m.isFfa) out.push("FFA");
  if ((m as CatalogueMap).isChickens) out.push("Chickens");
  return out;
}

/**
 * How many sides the map is drawn for, when that can be said honestly.
 *
 * `FFAMaxTeams` is the only player count in the whole catalogue, and it is only
 * sent for FFA maps - 40 of the 343, ranging from 2 to 16. A teams map carries
 * no count at all, so this returns nothing for one rather than inventing 8v8
 * out of its dimensions.
 */
export function sidesOf(m: CatalogueMap): string | undefined {
  if (m.isFfa && m.ffaMaxTeams) return `up to ${m.ffaMaxTeams} ways`;
  if (m.is1v1 && !m.isTeams && !m.isFfa) return "2 players";
  return undefined;
}


/**
 * How the catalogue draws a map's minimap, which is not how it describes it.
 *
 * `.thumbnail.jpg` carries the map's real proportions - a 12x8 map is 96x64.
 * `.minimap.jpg` squares them: measured across thirteen maps in both
 * orientations, its aspect is consistently `(width / height)`**2**. A 12x8 map
 * is 1024x454, a 16x6 map is 1024x143, and every square map is 1024x1024, which
 * is why nobody noticed - 198 of the 343 catalogue maps are square.
 *
 * `MapImage` covers rather than contains, so a box given the wrong ratio crops
 * the picture instead of distorting it. Every minimap in the app was being
 * drawn in a 1:1 box, so a long thin map showed as a square of its middle.
 *
 * If Zero-K ever corrects the generator this returns a ratio that is too wide
 * and the picture crops - which is where it already was, so the failure is the
 * old behaviour rather than a new one.
 */
/**
 * A map's true proportions, which is what a `thumbnail` is drawn at.
 *
 * The counterpart to `minimapRatio`, and easy to reach for the wrong one:
 * `.minimap.jpg` is drawn at the *square* of this, and `.thumbnail.jpg` is
 * drawn at this. Passing the squared one to a thumbnail turns a 4x16 map into
 * a picture sixteen times taller than it should be, which is a card 2656px
 * deep in a 166px column.
 */
export function thumbAspect(
  m: Pick<CatalogueMap, "width" | "height"> | undefined,
): number | undefined {
  if (!m?.width || !m?.height) return undefined;
  return m.width / m.height;
}

export function minimapRatio(m: CatalogueMap): number | undefined {
  if (!m.width || !m.height) return undefined;
  return (m.width / m.height) ** 2;
}

/**
 * An ordering for "best rated" that a single five-star vote cannot win.
 *
 * The plain mean is the honest score for one map and a bad way to rank a list:
 * of the 256 rated maps in the catalogue the most-voted has 46 votes and plenty
 * have one, so sorting by mean puts a map one person liked above the map the
 * ladder actually plays. Four point seven from ninety-two votes and four point
 * seven from four are different claims, and the sort has to know that.
 *
 * So each map is pulled towards the catalogue's own mean by a few imaginary
 * average votes, and a map earns its way clear of them by being voted on. The
 * displayed score stays the plain mean - this only decides the order.
 */
const PRIOR_VOTES = 5;

export function ratingRanker(maps: CatalogueMap[]): (m: CatalogueMap) => number | undefined {
  let sum = 0;
  let count = 0;
  for (const m of maps) {
    if (!m.ratingCount) continue;
    sum += m.ratingSum ?? 0;
    count += m.ratingCount;
  }
  const mean = count ? sum / count : RATING_MAX / 2;
  return m => {
    if (!m.ratingCount) return undefined;
    return (PRIOR_VOTES * mean + (m.ratingSum ?? 0)) / (PRIOR_VOTES + m.ratingCount);
  };
}

/**
 * Every featured and supported map, with the id that addresses its page.
 *
 * A map's detail page on zero-k.info is `/Maps/Detail/<ResourceID>`; `?name=`
 * is ignored, which is why map links used to land on a search. The id is not
 * derivable from a name, and asking `FindResourceData` per map would be a
 * request per minimap - so the whole catalogue is fetched once instead.
 *
 * Memoised for the session. It changes when maps are added, not while you play.
 */
let catalogue: Promise<Map<string, CatalogueMap>> | undefined;

export function mapCatalogue(): Promise<Map<string, CatalogueMap>> {
  if (!catalogue) {
    catalogue = (async () => {
      if (!inTauri()) return new Map<string, CatalogueMap>();
      const maps = await invoke<CatalogueMap[]>("zks_map_catalogue");
      /* Keyed by the normalised name. The lobby sends "Comet Catcher Redux"
         and the catalogue says "Comet_Catcher_Redux" for the same map. */
      return new Map(maps.map(m => [normaliseMapName(m.name), m]));
    })().catch(() => new Map<string, CatalogueMap>());   // offline is not an error here
  }
  return catalogue;
}

/** Test seam: forget the memoised catalogue. */
export function forgetCatalogue(): void {
  catalogue = undefined;
}

/** Underscores and spaces are the same separator as far as a map name goes. */
export function normaliseMapName(name: string): string {
  return String(name).replace(/_/g, " ").trim().toLowerCase();
}
