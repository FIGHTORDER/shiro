/**
 * Player profiles from zero-k.info.
 *
 * The lobby protocol tells us nothing about a player who is offline, and
 * `UserProfile` is server-to-client only, so another player's awards and
 * progression never arrive over the socket. The Zero-K developers were asked
 * for an endpoint and declined. `docs/PROFILES-WITHOUT-ENDPOINTS.md` has the
 * measurements; the fetching and parsing are in `src-tauri/src/zkweb.rs`,
 * behind the same host allowlist and timeout as the rest of our outbound HTTP.
 *
 * Everything here is an *enrichment*. A profile that fails to load must leave
 * the card we can already draw from the lobby record intact.
 */
import { invoke } from "@tauri-apps/api/core";
/* Extension spelled out so the unit test runner can load this module: Node's
   type-stripping loader does not do Vite's extensionless resolution, and
   `latestRating` below is worth a test. */
import { inTauri } from "./connection.ts";

export interface Award {
  key: string;
  name: string;
  count: number;
}

export interface RecentBattle {
  id: number;
  map: string;
  players?: number;
}

/** Every field is optional because every field is somebody else's markup. */
export interface WebProfile {
  accountId?: number;
  name: string;
  clan?: string;
  clanId?: number;
  avatar?: string;
  level?: number;
  levelPercent?: number;
  xpToNext?: number;
  rank?: string;
  /** The `<level>_<skill>` rank icon id. `src/net/ranks.ts` colours from it. */
  rankIcon?: string;
  badges: string[];
  awards: Award[];
  battlesPlayed?: number;
  battlesWatched?: number;
  firstLogin?: string;
  lastLogin?: string;
  forumKarma?: number;
  recent: RecentBattle[];
}

export interface RatingPoint {
  date: string;
  elo: number;
}

/**
 * Look a player up by name (case-sensitive) or account id.
 *
 * `null` means there is no such player - the site says so in forty bytes, and
 * that is an answer rather than a failure. A rejection means we could not read
 * the page, which is a different thing and should be shown differently.
 */
export async function webProfile(who: string): Promise<WebProfile | null> {
  if (!inTauri() || !who.trim()) return null;
  return invoke<WebProfile | null>("zkw_profile", { who });
}

/**
 * The rating history for an account.
 *
 * Empty when there is no series - a new account, or a category they have never
 * played. Not an error.
 */
export async function webRatings(accountId: number, category = 1): Promise<RatingPoint[]> {
  if (!inTauri() || !accountId) return [];
  return invoke<RatingPoint[]>("zkw_ratings", { accountId, category });
}

/**
 * Where a series ends, which is where the player is now.
 *
 * The player page carries no rating figure at all - only a link to the chart -
 * so for somebody who is not connected this is the only rating there is, and
 * the lobby has none to offer. The series is chronological: `parse_ratings`
 * reads it in document order and the Rust fixture test pins the dates as
 * ascending.
 *
 * `undefined` rather than 0 when there is nothing, because a zero on a rating
 * tile reads as a player who is terrible rather than as an answer we do not
 * have. See docs/PROFILE-AND-SEARCH.md section 5.
 */
export function latestRating(points: RatingPoint[] | undefined): number | undefined {
  if (!points?.length) return undefined;
  const last = points[points.length - 1];
  return typeof last?.elo === "number" && Number.isFinite(last.elo) ? last.elo : undefined;
}
