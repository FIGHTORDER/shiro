/**
 * Getting from "I am in a battle" to "the engine is running".
 *
 * This is a feature slice - it registers with store/slices.ts at module load.
 * The whole flow is four steps (docs/ARCHITECTURE.md section 6):
 *
 *   RequestConnectSpring -> ConnectSpring -> write script.txt -> spawn engine
 *
 * Only the first is ours to initiate, and even that is optional: the server
 * pushes `ConnectSpring` unprompted when a matchmaker game starts or when you
 * reconnect to a match already in progress. So the launch is driven by the
 * *arrival* of `ConnectSpring`, never by the button that asked for it. Press
 * nothing and a matchmaker game still starts correctly.
 *
 * Rust owns everything past that point - locating the install, the script, the
 * process - so this module stays testable in plain Node: `net/launch.ts`
 * reaches for Tauri at import time and is therefore imported lazily.
 */
import { create } from "zustand";

import type { Message } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { registerSlice } from "./slices.ts";

export type GamePhase =
  | { kind: "idle" }
  /** Working out whether the game and map are even present. */
  | { kind: "preflight"; title?: string }
  /** Fetching what is missing before the engine is allowed to start. */
  | { kind: "downloading"; title?: string; jobId: string; jobIds?: string[];
      percent: number; what: string }
  | { kind: "launching"; title?: string }
  | { kind: "running"; pid: number; title?: string }
  | { kind: "failed"; reason: string };

export interface GameState {
  phase: GamePhase;
  /** The last connect details the server sent, kept for a retry. */
  last?: T.ConnectSpring;
  /** A battle we were in that is still running, offered by the server. */
  rejoin?: number;
  me?: string;

  /** Preflight content, download what is missing, then launch. */
  prepareAndLaunch: (c: T.ConnectSpring) => Promise<void>;
  applyBatch: (messages: Message[]) => void;
  applyMessage: (m: Message) => void;
  setMe: (name?: string) => void;
  /** Ask the server for connect details. Launching happens on the reply. */
  requestStart: (battleID: number, password?: string) => void;
  /** Accept or dismiss a `RejoinOption`. */
  takeRejoin: (accept: boolean) => void;
  /** Launch from connect details - called on arrival, or again by a retry. */
  launch: (c: T.ConnectSpring) => Promise<void>;
  setPhase: (p: GamePhase) => void;
  reset: () => void;
}

/** Set once, the first time we launch; the engine outlives any one match. */
let listening = false;

/**
 * Put the window back the way the player left it.
 *
 * We never minimize or resize on launch - the engine takes exclusive fullscreen
 * and Windows hands the lobby back un-maximized on its own. So the maximized
 * state is captured just before the spawn and restored once the engine exits.
 * Restores the PRIOR state rather than always maximizing: someone who launched
 * from a small window should get a small window back.
 */
let wasMaximized = false;

async function rememberWindowState(): Promise<void> {
  try {
    const { isMaximized } = await import("../net/window.js");
    wasMaximized = await isMaximized();
  } catch {
    wasMaximized = false;
  }
}

async function restoreAfterGame(): Promise<void> {
  try {
    const { maximize, unminimize, setFocus } = await import("../net/window.js");
    await unminimize();
    if (wasMaximized) await maximize();
    await setFocus();
  } catch {
    // A window that will not come back is not worth failing the match over.
  }
}

export const useGame = create<GameState>((set, get) => ({
  phase: { kind: "idle" },

  applyMessage: m => get().applyBatch([m]),

  applyBatch: messages => {
    for (const m of messages) {
      if (m.cmd === "LoginResponse") {
        const d = m.data as T.LoginResponse;
        if (d.ResultCode === 0 && d.Name) set({ me: d.Name });
      }
      if (m.cmd === "RejoinOption") {
        // Sent after login when a game we were in is still going. Purely an
        // offer: nothing happens until the player takes it.
        set({ rejoin: (m.data as T.RejoinOption).BattleID });
      }
      if (m.cmd === "ConnectSpring") {
        const d = m.data as T.ConnectSpring;
        set({ last: d, phase: { kind: "launching", title: d.Title } });
        /* Through the content gate, not straight past it. This called `launch`
           directly, so `prepareAndLaunch` had no callers at all: the preflight,
           the download and the "Launch anyway" dialog were unreachable, and a
           matchmaker game on a map the player lacked spawned an engine that sat
           on "waiting for connection" forever. */
        void get().prepareAndLaunch(d);
      }
    }
  },

  setMe: name => set({ me: name }),

  /** Take the server up on a rejoin offer, or drop it. */
  takeRejoin: (accept: boolean) => {
    const battleID = get().rejoin;
    set({ rejoin: undefined });
    if (accept && battleID != null) get().requestStart(battleID);
  },

  requestStart: (battleID, password) => {
    set({ phase: { kind: "launching" } });
    void import("../net/session.ts").then(({ send }) =>
      send("RequestConnectSpring", { BattleID: battleID, Password: password }));
  },

  /**
   * Acquire whatever is missing, then launch.
   *
   * Content has to be settled before the engine starts: an engine told to join a
   * game whose archive it does not have sits on "waiting for connection" forever
   * with nothing to explain why. That was the actual reported bug.
   *
   * Everything here degrades to a plain launch. A preflight that cannot run, a
   * downloader that is missing, an unwritable install - none of those are worth
   * blocking a player who probably already has the content. We only hard-stop
   * when a download was genuinely needed and genuinely failed.
   */
  prepareAndLaunch: async c => {
    const title = c.Title;
    try {
      const { contentPreflight } = await import("../net/content.ts");
      const { useSettings } = await import("./settings.ts");
      const root = useSettings.getState().installRoot;

      const pre = await contentPreflight(c.Engine ?? "", c.Game, c.Map, root);

      // Nothing missing, or nothing we could do about it: go.
      if (!pre.items.length || !pre.downloader || !pre.writable) {
        set({ phase: { kind: "launching", title } });
        await get().launch(c);
        return;
      }

      const { useContent } = await import("./content.ts");
      const what = pre.items.map(i => i.name).join(", ");
      // One job per item, because pr-downloader's exit code is not per-item -
      // see the note on `fetch`. The game and the map now succeed or fail on
      // their own, which is the whole point.
      const ids = await useContent.getState().fetch(c.Engine ?? "", pre.items, root);

      set({ phase: { kind: "downloading", title, jobId: ids[0], jobIds: ids, percent: 0, what } });
      const unsub = useContent.subscribe((s: { jobs: Record<string, { percent: number }> }) => {
        const phase = get().phase;
        if (phase.kind !== "downloading" || phase.jobIds?.[0] !== ids[0]) return;
        // One bar for the lot: the mean of what each job reports.
        const seen = ids.map((i: string) => s.jobs[i]).filter(Boolean);
        if (!seen.length) return;
        const percent = Math.round(
          seen.reduce((n: number, j: { percent: number }) => n + j.percent, 0) / ids.length);
        if (percent !== phase.percent) set({ phase: { ...phase, percent } });
      });

      const job = await useContent.getState().settledAll(ids);
      unsub();

      if (job.state !== "done") {
        set({ phase: { kind: "failed", reason: job.reason ?? "Could not get the content." } });
        return;
      }
      set({ phase: { kind: "launching", title } });
      await get().launch(c);
    } catch (e) {
      // A broken preflight must not cost a match. Try the launch anyway; if the
      // content really is missing the engine will say so soon enough.
      set({ phase: { kind: "launching", title } });
      await get().launch(c);
    }
  },

  launch: async c => {
    const me = get().me;
    if (!me) {
      set({ phase: { kind: "failed", reason: "Not logged in." } });
      return;
    }
    try {
      const { launchSpring, onGame } = await import("../net/launch.ts");
      if (!listening) {
        /* Set *after* the registration succeeds. Setting it first meant a
           failed registration was never retried, and nothing after it ever
           learned that a game had exited - the lobby sat on "Game running"
           for the rest of the session. */
        await onGame(s => {
          if (s.kind === "launched") {
            set(state => ({ phase: { kind: "running", pid: s.pid, title: titleOf(state.phase) } }));
          } else if (s.kind === "exited") {
            // The debriefing arrives separately, on its own store slice.
            set({ phase: { kind: "idle" } });
            void restoreAfterGame();
          } else {
            set({ phase: { kind: "failed", reason: s.reason } });
          }
        });
        listening = true;
      }
      await rememberWindowState();
      /* What the loading screen may say about this match. Gathered here
         rather than in Rust because the roster is the lobby's, and best-effort
         because a caption is not worth failing a launch over - `matchInfo`
         being absent is a state the screen already handles. */
      let matchInfo;
      try {
        const { useRoom, matchInfoFor } = await import("./room.ts");
        const { useLobby } = await import("./lobby.ts");
        const room = useRoom.getState();
        const battle = room.battleID == null
          ? undefined
          : useLobby.getState().battles[room.battleID];
        matchInfo = matchInfoFor({
          players: room.players,
          bots: room.bots,
          title: battle?.Title,
          map: battle?.Map,
        });
      } catch {
        matchInfo = undefined;
      }

      const pid = await launchSpring({
        engine: c.Engine ?? "",
        ip: c.Ip ?? "",
        port: c.Port,
        myPlayerName: me,
        scriptPassword: c.ScriptPassword ?? "",
        matchInfo,
      });
      /* Only if nothing has happened to the game since. An engine with a bad
         script or missing content exits immediately, and that event can arrive
         before this promise resolves - in which case the phase is already
         `idle` or `failed`, and announcing "running" over the top of it left
         the lobby claiming a game that ended before it started. */
      set(state => (state.phase.kind === "launching"
        ? { phase: { kind: "running", pid, title: titleOf(state.phase) } }
        : state));
    } catch (err) {
      set({ phase: { kind: "failed", reason: String((err as Error)?.message ?? err) } });
    }
  },

  setPhase: p => set({ phase: p }),
  reset: () => set({ phase: { kind: "idle" }, last: undefined, rejoin: undefined, me: undefined }),
}));

function titleOf(p: GamePhase): string | undefined {
  return p.kind === "launching" || p.kind === "running" ? p.title : undefined;
}

registerSlice(messages => useGame.getState().applyBatch(messages));
