/**
 * Reaching the replays on disk. Mirrors net/ais.ts: the Rust side does the
 * reading, this module owns the invoke plumbing and what to show when there is
 * nothing to read.
 *
 * The searching itself is `store/replays.ts`, which is pure and knows nothing
 * about Tauri. See `src-tauri/src/replays.rs` for the file format.
 */
import { invoke } from "@tauri-apps/api/core";
// With the extension, because this module is exercised by `node --test` and
// node does not resolve an extensionless specifier the way Vite does.
import { inTauri } from "./connection.ts";
import type { Replay, ReplayList, Row } from "../store/replays.ts";

export type { Replay, ReplayList, Row };

/* Re-exported so a screen has one import for the whole subject rather than
   reaching past this module into the store for half of it. */
export {
  averageRating, engineMismatch, isTrivial, outcomeFor, partition, playerCount,
  rowFromArchive, rowFromReplay, rowMode, rowRating, searchReplays, sides,
  sortReplays, summariseSide, teammates, opponents, versus,
} from "../store/replays.ts";

/** One team's sampled statistics, as the engine recorded them. */
export interface TeamSeries {
  team: number;
  /** Seconds from the start, one per sample. */
  at: number[];
  damageDealt: number[];
  damageReceived: number[];
  unitsProduced: number[];
  unitsDied: number[];
  unitsKilled: number[];
  /**
   * The twelve resource slots as they sit in the file.
   *
   * Not named here on purpose. The element is a frame, twelve floats and seven
   * counts, and which float is metal and which is energy was not confirmed
   * against the engine's own struct - the two damage slots and the counts were.
   * A mislabelled axis is worse than an unlabelled one, so the rest travel as
   * numbers until somebody checks.
   */
  other: number[][];
}

export interface ReplayStats {
  /** Seconds between samples. */
  period: number;
  teams: TeamSeries[];
}

const EMPTY: ReplayList = { replays: [] };

/**
 * Every replay in the install's `demos` folder.
 *
 * Outside Tauri there is no disk to read, so this answers with nothing rather
 * than throwing - the browser demo runs the same screen.
 */
export async function listReplays(installRoot?: string): Promise<ReplayList> {
  if (!inTauri()) return EMPTY;
  try {
    return await invoke<ReplayList>("zks_list_replays", { installRoot });
  } catch (e) {
    return { replays: [], note: `Reading replays failed: ${String(e)}` };
  }
}

/**
 * Watch a replay.
 *
 * The engine version is the replay's own: a demo is a stream of orders replayed
 * against a specific build, and another one desynchronises or refuses to load.
 * When that engine is not installed the Rust side says so by name rather than
 * quietly substituting whatever is here.
 */
export async function watchReplay(path: string, engine?: string): Promise<string | undefined> {
  if (!inTauri()) return "Replays can only be watched from the desktop app.";
  try {
    await invoke("zks_watch_replay", { path, engine });
    return undefined;
  } catch (e) {
    return String(e);
  }
}

/**
 * The statistics for one replay.
 *
 * Separate from the listing because it decompresses the whole file - megabytes,
 * against the few kilobytes a row needs - so it happens when somebody opens
 * one, never while scrolling.
 */
export async function replayStats(path: string): Promise<ReplayStats | undefined> {
  if (!inTauri()) return undefined;
  try {
    return (await invoke<ReplayStats | null>("zks_replay_stats", { path })) ?? undefined;
  } catch {
    /* A replay that will not open is a broken file, and the summary beside it
       was read from the same one - so the screen keeps the row and drops the
       chart rather than reporting the whole thing as unreadable. */
    return undefined;
  }
}
