/**
 * Parties - the group you queue with.
 *
 * This is a feature slice - it registers with store/slices.ts at module load.
 *
 * Four messages and no ambiguity: `OnPartyStatus` is the whole membership
 * (empty means the party dissolved), `OnPartyInvite` is an offer with a
 * deadline, and the two client commands are the invite and the response.
 *
 * Like the matchmaker's ready check, the invite deadline is computed on arrival
 * because nothing restates it afterwards, and `now` is a parameter so tests do
 * not depend on the clock.
 */
import { create } from "zustand";

import type { CommandName, Message, MessageMap } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { registerSlice } from "./slices.ts";

export interface PartyInvite {
  partyID: number;
  /** Who would be in it, us included. */
  members: string[];
  /** Wall-clock ms when the offer lapses. */
  expiresAt: number;
}

export interface PartyState {
  partyID?: number;
  members: string[];
  invite?: PartyInvite;

  applyBatch: (messages: Message[], now?: number) => void;
  applyMessage: (m: Message, now?: number) => void;
  /** Ask someone to join. They get an `OnPartyInvite`; we hear back on status. */
  sendInvite: (name: string) => void;
  respond: (accepted: boolean) => void;
  leave: () => void;
  reset: () => void;
}

const EMPTY = {
  partyID: undefined as number | undefined,
  members: [] as string[],
  invite: undefined as PartyInvite | undefined,
};

function tx<K extends CommandName>(cmd: K, data: MessageMap[K]): void {
  void import("../net/session")
    .then(m => m.send(cmd, data))
    .catch(err => console.error(`party: ${cmd} failed:`, err));
}

export const useParty = create<PartyState>((set, get) => ({
  ...EMPTY,

  applyMessage: (m, now) => get().applyBatch([m], now),

  applyBatch: (messages, now = Date.now()) => set(state => {
    let partyID = state.partyID;
    let members = state.members;
    let invite = state.invite;

    for (const m of messages) {
      switch (m.cmd) {
        case "OnPartyStatus": {
          const d = m.data as T.OnPartyStatus;
          const names = d.UserNames ?? [];
          // A party of one is not a party: the server sends the empty list when
          // the last other member leaves.
          if (names.length < 2) {
            partyID = undefined;
            members = [];
          } else {
            partyID = d.PartyID;
            members = names;
          }
          // Any status for this party settles a pending invite to it.
          if (invite && invite.partyID === d.PartyID) invite = undefined;
          break;
        }

        case "OnPartyInvite": {
          const d = m.data as T.OnPartyInvite;
          invite = {
            partyID: d.PartyID,
            members: d.UserNames ?? [],
            expiresAt: now + d.TimeoutSeconds * 1000,
          };
          break;
        }

        default:
          break;
      }
    }

    return { partyID, members, invite };
  }),

  sendInvite: name => tx("InviteToParty", { UserName: name }),

  respond: accepted => {
    const invite = get().invite;
    if (!invite) return;
    set({ invite: undefined });
    tx("PartyInviteResponse", { PartyID: invite.partyID, Accepted: accepted });
  },

  leave: () => {
    const id = get().partyID;
    if (id == null) return;
    set({ ...EMPTY });
    tx("LeaveParty", { PartyID: id });
  },

  reset: () => set({ ...EMPTY }),
}));

/** Seconds left on a party invite, floored at zero. */
export function inviteSecondsLeft(invite: PartyInvite | undefined, now: number = Date.now()): number {
  if (!invite) return 0;
  return Math.max(0, Math.ceil((invite.expiresAt - now) / 1000));
}

registerSlice(messages => useParty.getState().applyBatch(messages));
