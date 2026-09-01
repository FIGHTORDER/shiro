/**
 * Searching zero-k.info's battle archive. The Rust side does the request and
 * the parsing; this owns the invoke plumbing and the shape the screen sees.
 *
 * See `src-tauri/src/zkbattles.rs` for what is fetched and why it is fetched
 * that way. The short version: the site has no search API, so this drives its
 * own search form, and the list it returns carries no player names - those come
 * from the replay file itself once one is opened.
 */
import { invoke } from "@tauri-apps/api/core";
// With the extension, because this module is exercised by `node --test` and
// node does not resolve an extensionless specifier the way Vite does.
import { inTauri } from "./connection.ts";
import type { Replay } from "../store/replays.ts";

/** One row of the archive. Lean by necessity - the list page has no more. */
export interface ArchiveBattle {
  id: number;
  title?: string;
  map?: string;
  game?: string;
  thumbnail?: string;
  players?: number;
  spectators?: number;
  /** Seconds. */
  duration?: number;
  /** As the site printed it, in its own timezone and format. */
  played?: string;
  teams?: number;
  /** The shape the site names, where it names one - `1v1`. */
  shape?: string;
  bots: boolean;
}

export interface ArchivePage {
  battles: ArchiveBattle[];
  offset: number;
  /** Whether asking for the next page is worth it. */
  more: boolean;
  /** Why the page is empty. Absent when the fetch worked. */
  note?: string;
}

/**
 * The filters the site's form actually offers.
 *
 * Only these. A filter applied here instead would run over one page of forty
 * and quietly give the wrong answer about the other thousand, so the screen
 * offers what the server can do and nothing more.
 */
export interface BattleQuery {
  title?: string;
  /** Substring of the map name: `Isis` finds `Fields_Of_Isis`. */
  map?: string;
  playersFrom?: number;
  playersTo?: number;
  /** 0 any, 1 today, 2 this week, 3 this month. */
  age?: number;
  /** Minutes. */
  minLength?: number;
  maxLength?: number;
  /** 0 any, 1 yes, 2 no. */
  bots?: number;
  mission?: number;
  matchmaker?: number;
  victory?: number;
  /** Site account ids from the autocomplete. */
  players?: string[];
  offset?: number;
}

export const PAGE = 40;

const OFFLINE: ArchivePage = {
  battles: [], offset: 0, more: false,
  note: "The replay archive needs zero-k.info.",
};

export async function searchBattles(query: BattleQuery): Promise<ArchivePage> {
  if (!inTauri()) return OFFLINE;
  try {
    return await invoke<ArchivePage>("zks_search_battles", { query });
  } catch (e) {
    return { battles: [], offset: query.offset ?? 0, more: false, note: String(e) };
  }
}

/**
 * Download a battle's replay and read it.
 *
 * It lands in the demos folder, so afterwards it is simply a replay on this
 * machine: it appears in the local list, plays with the same button, and there
 * is no second place for anything to look. Downloading one already there is not
 * a download - the file is found and read.
 *
 * This is also what fills in a row. The archive's list page names nobody, so
 * teams, ratings and the result only exist once the file is here.
 */
export async function downloadReplay(
  id: number, installRoot?: string,
): Promise<{ replay?: Replay; error?: string }> {
  if (!inTauri()) return { error: "Replays can only be downloaded from the desktop app." };
  try {
    return { replay: await invoke<Replay>("zks_download_replay", { id, installRoot }) };
  } catch (e) {
    return { error: String(e) };
  }
}

/** A name the site knows, and the account id the search filters on. */
export interface PlayerMatch {
  id: string;
  name: string;
}

/**
 * Resolve a typed name to accounts the site knows.
 *
 * The archive filters on account ids rather than names - the same name can have
 * belonged to different people over fifteen years - so a typed name is resolved
 * before it can narrow anything. This is the whole reason searching for
 * somebody's games needs no download: the filtering happens on their server.
 */
export async function lookupPlayers(term: string): Promise<PlayerMatch[]> {
  if (!inTauri() || !term.trim()) return [];
  try {
    return await invoke<PlayerMatch[]>("zks_lookup_players", { term });
  } catch {
    return [];
  }
}
