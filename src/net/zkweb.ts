/**
 * Player profiles from zero-k.info.
 *
 * The lobby protocol tells us nothing about a player who is offline, and
 * `UserProfile` is server-to-client only, so another player's awards and
 * progression never arrive over the socket. The Zero-K developers were asked
 * for an endpoint and declined. The fetching and parsing are in
 * `src-tauri/src/zkweb.rs`,
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

const SITE = "https://zero-k.info";

/**
 * The address of a player's page, for opening in a real browser.
 *
 * `/Users/Detail` takes the account in a path segment. A query string is not
 * bound to that route, so `/Users/Detail?name=Zythid` arrives with nothing to
 * resolve and the site answers `Invalid account (neither an ID nor name)` -
 * the same forty bytes as `src-tauri/src/fixtures/user-missing.html`, for every
 * player, whoever was asked for. This is the map link's mistake in another
 * place: see the VENDOR PATCH on `/Maps/Detail` in `src/ds/shiro.js`.
 *
 * The numeric id wins when we have one. Their name lookup is case-sensitive,
 * and a name of nothing but digits resolves as somebody else's account. A
 * `User` record carries the id for anyone connected, and the page the reader
 * above already fetched carries it for anyone who is not.
 *
 * `undefined` for nobody: the site root is not their profile, and a link that
 * goes somewhere wrong is worse than one that is not drawn.
 */
export function profileUrl(name: string | undefined, accountId?: number): string | undefined {
  if (accountId != null && Number.isInteger(accountId) && accountId > 0) {
    return `${SITE}/Users/Detail/${accountId}`;
  }
  const who = (name ?? "").trim();
  return who ? `${SITE}/Users/Detail/${encodeURIComponent(who)}` : undefined;
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
 * have.
 */
export function latestRating(points: RatingPoint[] | undefined): number | undefined {
  if (!points?.length) return undefined;
  const last = points[points.length - 1];
  return typeof last?.elo === "number" && Number.isFinite(last.elo) ? last.elo : undefined;
}
