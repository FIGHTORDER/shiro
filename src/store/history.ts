/**
 * Battle history / post-game debriefing.
 *
 * SCOPE NOTE - read this before adding a "load more" button.
 *
 * There is no request in this protocol for past battles. `registry.ts` lists
 * every command the server speaks and none of them fetches match history; the
 * server simply PUSHES one `BattleDebriefing` after a match you played in. So
 * this store holds exactly what arrived over this connection - nothing more -
 * and `BattleDebriefing.Url` is the link out to the permanent record on
 * zero-k.info. Do not invent a query command; there isn't one.
 *
 * Consequences:
 *   - The empty list is the normal case, not an error. Most sessions never see
 *     a debriefing at all.
 *   - A reconnect loses the list. That is correct: it was never ours to keep.
 *
 * Merge semantics: the server serializes with NullValueHandling.Ignore, so a
 * repeated debriefing for the same battle may carry only the fields that
 * changed. Records are merged with mergePatch, never replaced, and the nested
 * per-user map is merged key by key for the same reason. See protocol/wire.ts.
 */
import { create } from "zustand";

import type { Message } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { mergePatch } from "../protocol/wire.ts";
import { rankName } from "../net/ranks.ts";
import { registerSlice } from "./slices.ts";

/** Session-only ring buffer. Deep enough for a long evening of games. */
export const MAX_RECORDS = 25;

/**
 * What we knew about the match at launch. `BattleDebriefing` carries no map,
 * no title and no mode - only the players and their progression - so the
 * `ConnectSpring` that started the game is the only source for them.
 *
 * This is the one command handled here beyond BattleDebriefing/UserProfile. It
 * is purely decorative: strip the `ConnectSpring` case and everything still
 * works, minus the map image and the mode label.
 */
export interface MatchContext {
  map?: string;
  title?: string;
  /** AutohostMode, numeric - label it with AutohostModeLabel at the edge. */
  mode?: number;
  spectator: boolean;
  launchedAt: number;
}

export interface MatchRecord {
  serverBattleId: number;
  /** Wall clock when the debriefing landed; used for ordering and elapsed time. */
  receivedAt: number;
  /** The merged server payload, kept verbatim so nothing is lost in adaptation. */
  data: T.BattleDebriefing;
  context?: MatchContext;
}

interface HistoryState {
  /** Newest first. */
  records: MatchRecord[];
  /** Index into `records` of the match on screen. 0 is the newest. */
  index: number;
  /** Profiles keyed by account name; the only source of the current level. */
  profiles: Record<string, T.UserProfile>;
  /** The launch we have not yet matched to a debriefing. */
  pendingLaunch?: MatchContext;

  applyBatch: (ms: Message[]) => void;
  applyMessage: (m: Message) => void;
  select: (i: number) => void;
  /** Step one match further back through this session. */
  older: () => void;
  newer: () => void;
  reset: () => void;
}

const EMPTY = {
  records: [] as MatchRecord[],
  index: 0,
  profiles: {} as Record<string, T.UserProfile>,
  pendingLaunch: undefined as MatchContext | undefined,
};

/** Merge a debriefing patch into an existing record, users map included. */
function mergeDebriefing(
  base: T.BattleDebriefing | undefined,
  patch: T.BattleDebriefing,
): T.BattleDebriefing {
  const merged = mergePatch(base, patch);
  const baseUsers = base?.DebriefingUsers;
  const patchUsers = patch.DebriefingUsers;
  if (baseUsers && patchUsers) {
    const users: Record<string, T.BattleDebriefing_DebriefingUser> = { ...baseUsers };
    for (const name of Object.keys(patchUsers)) {
      users[name] = mergePatch(users[name], patchUsers[name]);
    }
    merged.DebriefingUsers = users;
  }
  return merged;
}

export const useHistory = create<HistoryState>((set, get) => ({
  ...EMPTY,

  applyMessage: m => get().applyBatch([m]),

  applyBatch: messages => set(state => {
    let records = state.records;
    let index = state.index;
    let profiles = state.profiles;
    let pendingLaunch = state.pendingLaunch;
    let added = 0;

    for (const m of messages) {
      switch (m.cmd) {
        case "ConnectSpring": {
          const d = m.data as T.ConnectSpring;
          pendingLaunch = {
            map: d.Map,
            title: d.Title,
            mode: d.Mode,
            spectator: Boolean(d.IsSpectator),
            launchedAt: Date.now(),
          };
          break;
        }

        case "BattleDebriefing": {
          const d = m.data as T.BattleDebriefing;
          if (d.ServerBattleID == null) break;
          if (records === state.records) records = [...records];

          const at = records.findIndex(r => r.serverBattleId === d.ServerBattleID);
          if (at >= 0) {
            // A second debriefing for the same battle is a patch, not a replacement.
            const prev = records[at];
            records[at] = {
              ...prev,
              receivedAt: Date.now(),
              data: mergeDebriefing(prev.data, d),
              context: prev.context ?? pendingLaunch,
            };
          } else {
            records.unshift({
              serverBattleId: d.ServerBattleID,
              receivedAt: Date.now(),
              data: mergeDebriefing(undefined, d),
              context: pendingLaunch,
            });
            added += 1;
          }
          // The launch context belongs to exactly one match.
          pendingLaunch = undefined;
          break;
        }

        case "UserProfile": {
          const p = m.data as T.UserProfile;
          if (p.Name) {
            if (profiles === state.profiles) profiles = { ...profiles };
            profiles[p.Name] = mergePatch(profiles[p.Name], p);
          }
          break;
        }

        default:
          break;
      }
    }

    if (records !== state.records) {
      if (records.length > MAX_RECORDS) records = records.slice(0, MAX_RECORDS);
      // Sitting on the newest? Follow the new arrival. Reading an older match?
      // Stay on the one being read rather than yanking it away mid-sentence.
      if (added && index > 0) index = Math.min(index + added, records.length - 1);
      if (index > records.length - 1) index = Math.max(0, records.length - 1);
    }

    return { records, index, profiles, pendingLaunch };
  }),

  select: i => set(state => ({
    index: state.records.length ? Math.max(0, Math.min(i, state.records.length - 1)) : 0,
  })),

  older: () => get().select(get().index + 1),
  newer: () => get().select(get().index - 1),

  reset: () => set({ ...EMPTY }),
}));

registerSlice(messages => useHistory.getState().applyBatch(messages));

/* -------------------------------------------------------------------------- */
/* Adapters: protocol shapes -> what DebriefingScreen renders.                 */
/* -------------------------------------------------------------------------- */

export interface DebriefAward {
  name: string;
  value?: number;
}

export interface DebriefRow {
  user: {
    name: string;
    clan?: string;
    country?: string;
    faction?: string;
    level?: number;
    bot?: boolean;
    admin?: boolean;
  };
  elo: number;
  change: number;
  win: boolean;
  allyNumber: number;
  you: boolean;
}

export interface DebriefRating {
  change: number;
  next: number;
  /** Absent when the debriefing carried no rank for us to name. */
  rank?: string;
  rankup: boolean;
  rankdown: boolean;
  prevRankElo: number;
  nextRankElo: number;
}

export interface DebriefXp {
  change: number;
  next: number;
  level?: number;
  levelUp: boolean;
  prevLevelXp: number;
  nextLevelXp: number;
}

export interface DebriefView {
  serverBattleId: number;
  result: "Victory" | "Defeat" | "Match";
  map?: string;
  mode?: number;
  category?: string;
  /** mm:ss from launch to result, only when we saw the launch. */
  elapsed?: string;
  message?: string;
  url?: string;
  teamLabel: string;
  opponentsLabel: string;
  team: DebriefRow[];
  opponents: DebriefRow[];
  awards: DebriefAward[];
  /** Null when you were not a player - a spectator gets no progression. */
  rating: DebriefRating | null;
  xp: DebriefXp | null;
}

/** Anything with the identity fields UserChip wants. `T.User` satisfies it. */
export interface UserLike {
  Clan?: string;
  Country?: string;
  Faction?: string;
  Level?: number;
  IsBot?: boolean;
  IsAdmin?: boolean;
}

/**
 * `DebriefingUser.Awards` is typed `unknown` by the generator (the upstream
 * field is a nested generic it does not follow), so validate at the boundary
 * instead of casting and hoping.
 */
export function readAwards(raw: unknown): DebriefAward[] {
  if (!Array.isArray(raw)) return [];
  const out: DebriefAward[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as T.BattleDebriefing_DebriefingAward;
    const name = a.Description || a.Key;
    if (!name) continue;
    out.push({ name, value: typeof a.Value === "number" ? a.Value : undefined });
  }
  return out;
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Case-insensitive fallback: the wire uses the account's canonical casing. */
function findEntry(
  users: Record<string, T.BattleDebriefing_DebriefingUser>,
  name?: string,
): string | undefined {
  if (!name) return undefined;
  if (users[name]) return name;
  const lower = name.toLowerCase();
  return Object.keys(users).find(k => k.toLowerCase() === lower);
}

/**
 * Flatten one record into the shape the screen renders. Kept out of the
 * component so it can be tested without React, and so the demo-data path can
 * produce the same shape.
 *
 * `me` is the logged-in account name; `lookup` supplies clan/country/faction
 * from the lobby store, which the debriefing itself does not carry.
 */
export function buildDebriefView(
  record: MatchRecord,
  me?: string,
  lookup?: (name: string) => UserLike | undefined,
  profiles?: Record<string, T.UserProfile>,
): DebriefView {
  const users = record.data.DebriefingUsers ?? {};
  const myName = findEntry(users, me);
  const mine = myName ? users[myName] : undefined;

  const rows: DebriefRow[] = Object.keys(users).map(name => {
    const u = users[name];
    const info = lookup?.(name);
    return {
      user: {
        name,
        clan: info?.Clan || undefined,
        country: info?.Country || undefined,
        faction: info?.Faction || undefined,
        level: info?.Level,
        bot: info?.IsBot || undefined,
        admin: info?.IsAdmin || undefined,
      },
      elo: Math.round(u.NewElo ?? 0),
      change: Math.round(u.EloChange ?? 0),
      win: Boolean(u.IsInVictoryTeam),
      allyNumber: u.AllyNumber ?? 0,
      you: name === myName,
    };
  });

  // Sort by Elo so the strongest player heads each column; ties by name so the
  // order is stable between renders.
  rows.sort((a, b) => b.elo - a.elo || a.user.name.localeCompare(b.user.name));

  // With no "you" in the payload (spectating, or a name we cannot match) fall
  // back to winners against everyone else, which is the only grouping the data
  // supports on its own.
  const team = mine
    ? rows.filter(r => r.allyNumber === mine.AllyNumber)
    : rows.filter(r => r.win);
  const teamSet = new Set(team);
  const opponents = rows.filter(r => !teamSet.has(r));

  const won = mine ? Boolean(mine.IsInVictoryTeam) : undefined;
  const level = myName ? profiles?.[myName]?.Level : undefined;

  return {
    serverBattleId: record.serverBattleId,
    result: won === undefined ? "Match" : won ? "Victory" : "Defeat",
    map: record.context?.map,
    mode: record.context?.mode,
    category: record.data.RatingCategory,
    elapsed: record.context
      ? mmss((record.receivedAt - record.context.launchedAt) / 1000)
      : undefined,
    message: record.data.Message,
    url: record.data.Url,
    teamLabel: mine ? (won ? "YOUR TEAM - WON" : "YOUR TEAM - LOST") : "VICTORY",
    opponentsLabel: mine ? "OPPONENTS" : "DEFEATED",
    team,
    opponents,
    awards: mine
      ? readAwards(mine.Awards)
      // No progression of your own to show, so surface the match's awards
      // rather than an empty panel.
      : rows.flatMap(r => readAwards(users[r.user.name]?.Awards)),
    rating: mine
      ? {
        change: Math.round(mine.EloChange ?? 0),
        next: Math.round(mine.NewElo ?? 0),
        /* The rank you ranked up into, by the name the game announces it by -
           "Rank 5" is an index into a table nobody outside the code has. */
        rank: rankName(mine.NewRank),
        rankup: Boolean(mine.IsRankup),
        rankdown: Boolean(mine.IsRankdown),
        prevRankElo: Math.round(mine.PrevRankElo ?? 0),
        nextRankElo: Math.round(mine.NextRankElo ?? 0),
      }
      : null,
    xp: mine
      ? {
        change: Math.round(mine.XpChange ?? 0),
        next: Math.round(mine.NewXp ?? 0),
        level,
        levelUp: Boolean(mine.IsLevelUp),
        prevLevelXp: Math.round(mine.PrevLevelXp ?? 0),
        nextLevelXp: Math.round(mine.NextLevelXp ?? 0),
      }
      : null,
  };
}
