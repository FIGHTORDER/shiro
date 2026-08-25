/**
 * Whether there is a newer Shiro, and getting it.
 *
 * A store rather than a hook because two places need the same answer: Settings,
 * where you ask for it deliberately, and the shell, which mentions it quietly
 * when one is waiting. Two independent checks would mean two downloads.
 *
 * Nothing here restarts the app on its own. An update that interrupts a game
 * you are in the middle of is worse than an update that waits, so the last step
 * is always the player's.
 */
import { create } from "zustand";

import { checkForUpdate, installUpdate, relaunch, type Available } from "../net/update.ts";

export type UpdateState =
  /** Not asked yet. */
  | { kind: "idle" }
  | { kind: "checking" }
  /** Asked, and this is the newest there is. */
  | { kind: "current" }
  | { kind: "available"; update: Available }
  | { kind: "downloading"; update: Available; percent?: number }
  /** Installed. The new build runs after a restart. */
  | { kind: "ready"; update: Available }
  | { kind: "failed"; why: string };

export interface UpdateStore {
  state: UpdateState;
  /** Ask the endpoint. Safe to call repeatedly; ignored while busy. */
  check: () => Promise<void>;
  /** Download and install what the last check found. */
  install: () => Promise<void>;
  /** Restart into the new build. */
  restart: () => Promise<void>;
}

/** Busy states must not be interrupted by another check or a second install. */
function busy(s: UpdateState): boolean {
  return s.kind === "checking" || s.kind === "downloading";
}

export const useUpdate = create<UpdateStore>((set, get) => ({
  state: { kind: "idle" },

  check: async () => {
    if (busy(get().state)) return;
    set({ state: { kind: "checking" } });
    try {
      const update = await checkForUpdate();
      set({ state: update ? { kind: "available", update } : { kind: "current" } });
    } catch (e) {
      /* An update check is the least important thing the app does. It failing
         is worth saying in Settings and worth saying nowhere else. */
      set({ state: { kind: "failed", why: String((e as Error)?.message ?? e) } });
    }
  },

  install: async () => {
    const current = get().state;
    if (current.kind !== "available") return;
    const { update } = current;
    set({ state: { kind: "downloading", update } });
    try {
      await installUpdate(percent => {
        // Only while we are still the ones downloading - a failure in between
        // must not be overwritten by a late progress event.
        if (get().state.kind === "downloading") {
          set({ state: { kind: "downloading", update, percent } });
        }
      });
      set({ state: { kind: "ready", update } });
    } catch (e) {
      set({ state: { kind: "failed", why: String((e as Error)?.message ?? e) } });
    }
  },

  restart: async () => {
    await relaunch();
  },
}));
