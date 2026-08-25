/**
 * The battle room you are currently in.
 *
 * This is a feature slice - it registers with store/slices.ts at module load
 * and receives the same per-animation-frame batch the core lobby store gets.
 *
 * Membership lives here rather than in store/lobby.ts because the two are
 * answering different questions. `lobby.battles` is the public directory: one
 * `BattleHeader` per open room, with a player *count* and no roster. This store
 * is the room you joined, and it exists only between `JoinBattleSuccess` and
 * leaving. The protocol offers no roster for any other battle, so there is
 * deliberately no way to hold more than one.
 *
 * Two things are worth knowing before extending this:
 *
 * - `JoinBattleSuccess` is a full snapshot and replaces state outright.
 *   Everything after it is a partial patch and is merged (see wire.mergePatch).
 * - There is no inbound "player left the room" message that names the player.
 *   `LeaveBattle` carries a BattleID and nothing else, so it cannot be used to
 *   drop one member - it is only ever about us. Departures show up as the
 *   server re-sending `User` with a different BattleID, which the core store
 *   already tracks, so the roster reader intersects the two.
 */
import { create } from "zustand";

import type { CommandName, Message, MessageMap } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import type { SyncStatuses, AutohostMode } from "../protocol/enums.ts";

/* Spelled out rather than imported as values: `enums.ts` declares TypeScript
   `enum`s, which are a runtime construct that Node's type stripping refuses to
   execute - so the stores here take the type and name the numbers, and the
   member types make tsc the check that upstream has not renumbered them. */
export const SYNC_UNKNOWN: SyncStatuses.Unknown = 0;
export const SYNC_SYNCED: SyncStatuses.Synced = 1;
export const SYNC_UNSYNCED: SyncStatuses.Unsynced = 2;
import { mergePatch } from "../protocol/wire.ts";
import { registerSlice } from "./slices.ts";

/**
 * Send a command without dragging `net/session` (and therefore Tauri) into this
 * module's import graph, so the reducer stays testable in plain Node. Failures
 * are logged, never thrown: a dropped command must not take a store action down.
 */
function tx<K extends CommandName>(cmd: K, data: MessageMap[K]): void {
  void import("../net/session")
    .then(m => m.send(cmd, data))
    .catch(err => console.error(`room: ${cmd} failed:`, err));
}

/**
 * A bot name not already in use in this room: `"CAI (1)"`, `"CAI (2)"`, and so
 * on, which is the scheme the ZK client uses.
 *
 * Exported for the test rather than for callers - `addBot` picks the name.
 */
/**
 * The match, as the loading screen shows it.
 *
 * Built from the room rather than the start script: the script names teams by
 * number and says nothing about who is on them, and the roster is the thing
 * worth reading while a game loads.
 *
 * Spectators are left out - they are not in the match - and bots are included,
 * because a screen that lists three humans for a 4v4 against AI is wrong in a
 * way somebody will notice. Ally numbers are zero-based on the wire and
 * one-based on screen.
 *
 * Returns undefined when there is nothing worth writing, which the caller
 * passes straight through: no match is a supported state, not a failure.
 */
export function matchInfoFor(state: {
  players: Record<string, T.UpdateUserBattleStatus>;
  bots: Record<string, T.UpdateBotStatus>;
  title?: string;
  map?: string;
}): { map: string; title: string; teams: { label: string; players: string[] }[] } | undefined {
  const sides = new Map<number, string[]>();
  const add = (ally: number | undefined, name: string | undefined) => {
    if (ally == null || !name) return;
    const list = sides.get(ally);
    if (list) list.push(name);
    else sides.set(ally, [name]);
  };

  for (const p of Object.values(state.players)) {
    if (p.IsSpectator) continue;
    add(p.AllyNumber, p.Name);
  }
  for (const b of Object.values(state.bots)) add(b.AllyNumber, b.Name);

  if (!sides.size) return undefined;

  const teams = [...sides.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ally, players]) => ({
      label: `Team ${ally + 1}`,
      players: [...players].sort((a, b) => a.localeCompare(b)),
    }));

  return { map: state.map ?? "", title: state.title ?? "", teams };
}

export function freeBotName(aiLib: string, bots: Record<string, unknown>): string {
  for (let n = 1; ; n++) {
    const name = `${aiLib} (${n})`;
    if (!(name in bots)) return name;
  }
}

/** What the host dialog collects. Engine comes from `Welcome`, so the room we
 *  open runs what everyone else is running; game and options come from the
 *  chosen custom mode, when there is one. */
export interface HostOptions {
  title: string;
  map: string;
  maxPlayers: number;
  /**
   * What kind of room this is - Teams, 1v1, FFA, Cooperative, Custom.
   *
   * The wire calls it `Mode` and it is a number. It decides how the room
   * presents itself in the list and what an autohost does with it, and leaving
   * it out meant every room hosted from here was whatever the server defaulted
   * to rather than what the person asked for.
   */
  mode?: AutohostMode;
  password?: string;
  engine?: string;
  game?: string;
  /**
   * Modoptions the chosen mode asks for. They cannot ride along with
   * `OpenBattle` - there is no field for them - so they are held until the
   * server puts us in the room. Tech-K is nothing but one of these, so a mode
   * picker that ignored them would silently host a plain Zero-K room.
   */
  options?: Record<string, string>;
}

export interface RoomState {
  /** The battle we are in, or undefined when we are not in one. */
  battleID?: number;
  /** Our own account name, learned from `LoginResponse`. */
  me?: string;
  /** Battle status by player name - ally number, spectator flag, sync. */
  players: Record<string, T.UpdateUserBattleStatus>;
  /** AI bots by name. */
  bots: Record<string, T.UpdateBotStatus>;
  modOptions: Record<string, string>;
  mapOptions: Record<string, string>;
  /** Set when the join that is in flight was a request to spectate. */
  pendingSpectate: boolean;
  /** Modoptions to apply as soon as we are in the room we just opened. */
  pendingOptions?: Record<string, string>;
  /** The vote in progress, if any. */
  poll?: T.BattlePoll;
  /** How the last vote ended, until the next one starts. */
  pollOutcome?: T.BattlePollOutcome;
  /** What we last told the room about having the map. See `reportSync`. */
  sync: SyncStatuses;

  applyBatch: (messages: Message[]) => void;
  applyMessage: (m: Message) => void;
  setMe: (name?: string) => void;
  /** Ask the server to put us in a battle. The roster arrives as
      `JoinBattleSuccess`; a wrong password comes back as a `Say` from the
      server rather than an error, so nothing is optimistically applied here. */
  join: (battleID: number, password?: string, asSpectator?: boolean) => void;
  /** Leave the current room. There is no acknowledgement to wait for. */
  leave: () => void;
  /** Open a battle of our own. Success arrives as `JoinBattleSuccess`. */
  host: (opts: HostOptions) => void;
  /**
   * Vote in the current poll. There is no vote command in the protocol - the
   * official client types it into battle chat and so do we, which is also why
   * autohosts understand it.
   */
  vote: (option: number | boolean) => void;
  /** Host controls. The server ignores these from anyone but the host. */
  kick: (name: string, reason?: string) => void;
  /**
   * Replace the room's game options.
   *
   * The whole dictionary, not a delta: `ServerBattle.SetModOptions` assigns
   * what it is given, so anything left out is dropped. Build it with
   * `merge()` from src/net/modOptions.ts rather than by hand.
   *
   * The server refuses anyone but the founder - and refuses even them in an
   * autohost - with a chat line rather than an error, so callers should not
   * offer this unless `canEdit()` says so.
   */
  setModOptions: (options: Record<string, string>) => void;
  /**
   * Tell the room whether we have the map and game yet.
   *
   * Not cosmetic. `CmdStart` gathers everyone whose status is not `Synced` and
   * announces "the following users are still downloading the map, please click
   * Rejoin ASAP because you're playing", then delays the start by ten seconds.
   * A client that never sends this stays `Unknown`, so it is named every single
   * time anybody starts a game.
   *
   * Sent only when the answer changes - it is a broadcast to the whole room.
   */
  reportSync: (synced: boolean) => void;
  addBot: (aiLib: string, ally: number, name?: string) => void;
  removeBot: (name: string) => void;
  /** We left, were kicked, or the room closed. */
  clear: () => void;
  reset: () => void;
}

const EMPTY = {
  battleID: undefined as number | undefined,
  players: {} as Record<string, T.UpdateUserBattleStatus>,
  bots: {} as Record<string, T.UpdateBotStatus>,
  modOptions: {} as Record<string, string>,
  mapOptions: {} as Record<string, string>,
  pendingSpectate: false,
  pendingOptions: undefined as Record<string, string> | undefined,
  poll: undefined as T.BattlePoll | undefined,
  pollOutcome: undefined as T.BattlePollOutcome | undefined,
  sync: SYNC_UNKNOWN as SyncStatuses,
};

export const useRoom = create<RoomState>((set, get) => ({
  ...EMPTY,

  applyMessage: m => get().applyBatch([m]),

  applyBatch: messages => set(state => {
    let battleID = state.battleID;
    let players = state.players;
    let bots = state.bots;
    let modOptions = state.modOptions;
    let mapOptions = state.mapOptions;
    let pendingSpectate = state.pendingSpectate;
    let pendingOptions = state.pendingOptions;
    let poll = state.poll;
    let pollOutcome = state.pollOutcome;
    let sync = state.sync;
    let me = state.me;

    /* Copy-on-write: most batches touch none of this, and the screens
       re-render on identity. */
    const mutPlayers = () => (players === state.players ? (players = { ...players }) : players);
    const mutBots = () => (bots === state.bots ? (bots = { ...bots }) : bots);

    for (const m of messages) {
      switch (m.cmd) {
        case "LoginResponse": {
          const d = m.data as T.LoginResponse;
          if (d.ResultCode === 0 && d.Name) me = d.Name;
          break;
        }

        case "JoinBattleSuccess": {
          const d = m.data as T.JoinBattleSuccess;
          battleID = d.BattleID;
          players = {};
          bots = {};
          modOptions = d.Options ?? {};
          mapOptions = d.MapOptions ?? {};
          poll = undefined;
          pollOutcome = undefined;
          /* What we told the *last* room is not true of this one, and
             `reportSync` sends nothing when the value has not changed - so a
             `Synced` carried across meant the new room never heard one, the
             server held us at Unknown, and `!start` announced us as still
             downloading the map every game for the life of the room.

             Only room-to-room moves were affected: leaving resets everything,
             so it took joining from the battle list while already in a room, or
             a ForceJoinBattle. */
          sync = SYNC_UNKNOWN;
          for (const p of d.Players ?? []) if (p.Name) players[p.Name] = p;
          for (const b of d.Bots ?? []) if (b.Name) bots[b.Name] = b;
          /* A join we asked to spectate: the status can only be set once the
             server has actually put us in the room, so it waits until here. */
          if (pendingSpectate && me) {
            pendingSpectate = false;
            tx("UpdateUserBattleStatus", { Name: me, IsSpectator: true });
          }
          /* Same reason, same moment: a custom mode's modoptions can only be
             set once the room exists. */
          if (pendingOptions) {
            tx("SetModOptions", { Options: pendingOptions });
            // Show them immediately; the server echoes them back anyway.
            modOptions = { ...modOptions, ...pendingOptions };
            pendingOptions = undefined;
          }
          break;
        }

        /* Someone leaving the room.
         *
         * There is no "X left the battle" message. ZkLobbyServer's
         * ConnectedUser.LeaveBattle removes them and then calls SyncUserToAll,
         * which re-broadcasts their `User` with BattleID cleared - that echo IS
         * the notification. Without acting on it, everyone who ever joined
         * stays on the roster reading "offline" forever.
         *
         * Edge-triggered on the message, deliberately, rather than filtering
         * the roster against the directory on every render. A `User` we hold
         * that simply has no BattleID yet - the record predates their join, or
         * arrived in the login flood before JoinBattleSuccess - is
         * indistinguishable from one who left, so a standing filter drops real
         * players. Reacting to the update only ever removes someone the server
         * has just told us about. */
        case "User": {
          const d = m.data as T.User;
          if (battleID == null || !d.Name) break;
          if (players[d.Name] && d.BattleID !== battleID) {
            const next = { ...players };
            delete next[d.Name];
            players = next;
          }
          break;
        }

        case "UserDisconnected": {
          const d = m.data as T.UserDisconnected;
          if (battleID == null || !d.Name || !players[d.Name]) break;
          const next = { ...players };
          delete next[d.Name];
          players = next;
          break;
        }

        case "UpdateUserBattleStatus": {
          const d = m.data as T.UpdateUserBattleStatus;
          // Outside a room these are noise from a battle we just left.
          if (battleID == null || !d.Name) break;
          mutPlayers()[d.Name] = mergePatch(players[d.Name], d);
          break;
        }

        case "UpdateBotStatus": {
          const d = m.data as T.UpdateBotStatus;
          if (battleID == null || !d.Name) break;
          mutBots()[d.Name] = mergePatch(bots[d.Name], d);
          break;
        }

        case "RemoveBot": {
          const d = m.data as T.RemoveBot;
          if (d.Name && bots[d.Name]) delete mutBots()[d.Name];
          break;
        }

        case "SetModOptions":
          modOptions = (m.data as T.SetModOptions).Options ?? {};
          break;

        case "SetMapOptions":
          mapOptions = (m.data as T.SetMapOptions).Options ?? {};
          break;

        /* Polls are how a Zero-K room decides anything - map, start, kick.
           The server repeats the whole poll on every vote, so this is a
           replace, not a merge. */
        case "BattlePoll":
          poll = m.data as T.BattlePoll;
          pollOutcome = undefined;
          break;

        case "BattlePollOutcome":
          poll = undefined;
          pollOutcome = m.data as T.BattlePollOutcome;
          break;

        case "BattleRemoved": {
          // The host closed the room out from under us.
          if ((m.data as T.BattleRemoved).BattleID === battleID) {
            return { ...EMPTY, me };
          }
          break;
        }

        /* The server moves us: a matchmaker game forming, an admin, or a
           website command. Nothing to confirm - just go. */
        case "ForceJoinBattle": {
          const d = m.data as T.ForceJoinBattle;
          if (d.Name && me && d.Name !== me) break;
          pendingSpectate = false;
          tx("JoinBattle", { BattleID: d.BattleID });
          break;
        }

        case "KickFromBattle": {
          // Broadcast to the whole room, so check it is aimed at us.
          const d = m.data as T.KickFromBattle;
          if (d.Name && d.Name === me) return { ...EMPTY, me };
          break;
        }

        default:
          break;
      }
    }

    return { battleID, players, bots, modOptions, mapOptions, pendingSpectate,
      pendingOptions, poll, pollOutcome, sync, me };
  }),

  setMe: name => set({ me: name }),

  join: (battleID, password, asSpectator) => {
    // Spectating is a status change, and status can only be set once the server
    // has put us in the room - so it is remembered and applied on arrival.
    set({ pendingSpectate: Boolean(asSpectator) });
    tx("JoinBattle", { BattleID: battleID, Password: password });
  },

  host: opts => {
    // Applied on JoinBattleSuccess; see the note on HostOptions.
    set({ pendingOptions: opts.options && Object.keys(opts.options).length
      ? opts.options
      : undefined });
    tx("OpenBattle", {
      Header: {
        Title: opts.title,
        Map: opts.map,
        MaxPlayers: opts.maxPlayers,
        Mode: opts.mode,
        // Omitted rather than sent empty: the server treats an empty string as
        // a password and then refuses your own join.
        Password: opts.password ? opts.password : undefined,
        Engine: opts.engine,
        Game: opts.game,
      },
    });
  },

  leave: () => {
    const id = get().battleID;
    // Clear immediately: the server sends no acknowledgement, and leaving a
    // room we are no longer in is harmless.
    set(state => ({ ...EMPTY, me: state.me }));
    if (id != null) tx("LeaveBattle", { BattleID: id });
  },
  /** Leaving a room keeps the session; only `reset` forgets who we are. */
  vote: option => {
    const text = typeof option === "boolean" ? (option ? "!y" : "!n") : `!vote ${option}`;
    void import("../net/session")
      .then(m => m.say(text, 1))
      .catch(err => console.error("room: vote failed:", err));
  },

  kick: (name, reason) => {
    const id = get().battleID;
    if (id == null) return;
    tx("KickFromBattle", { BattleID: id, Name: name, Reason: reason });
  },

  reportSync: synced => {
    const next: SyncStatuses = synced ? SYNC_SYNCED : SYNC_UNSYNCED;
    const me = get().me;
    /* `Name` is not optional, whatever the schema says. The server looks the
       name up in a dictionary before it does anything else, so an absent one
       arrives as a null key and throws ArgumentNullException - the same trap
       the bot path below documents, seen for real in a host's server log:

         error processing line UpdateUserBattleStatus {"Sync":2}
         System.ArgumentNullException: Value cannot be null. Parameter name: key

       Sending it without a name did not report an unknown sync state; it threw
       inside the server, every time we tried. */
    if (get().battleID == null || !me || get().sync === next) return;
    set({ sync: next });
    tx("UpdateUserBattleStatus", { Name: me, Sync: next });
  },

  setModOptions: options => {
    if (get().battleID == null) return;
    tx("SetModOptions", { Options: options });
  },

  /* The name is ours to pick. The server does not generate one: it looks the
     name straight up in the room's bot dictionary, so an absent Name arrives as
     a null key and throws ArgumentNullException before anything is added -
     which is what "error processing line UpdateBotStatus" in the server log is.

     The ZK client's scheme, and now ours: "<lib> (n)" with the first n that is
     not already taken in this room. */
  addBot: (aiLib, ally, name) => {
    tx("UpdateBotStatus", {
      AiLib: aiLib,
      AllyNumber: ally,
      Name: name || freeBotName(aiLib, get().bots),
      Owner: get().me,
    });
  },

  removeBot: name => {
    tx("RemoveBot", { Name: name });
  },

  clear: () => set(state => ({ ...EMPTY, me: state.me })),
  reset: () => set({ ...EMPTY, me: undefined }),
}));

registerSlice(messages => useRoom.getState().applyBatch(messages));
