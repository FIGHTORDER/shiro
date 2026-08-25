/**
 * Run with:  node --test src/store/party.test.ts
 * (Node strips the types; imports need explicit .ts extensions and this file
 * must not import an enum - see protocol/wire.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "../protocol/registry.ts";
import { useParty, inviteSecondsLeft } from "./party.ts";

function msg(cmd: string, data: unknown): Message {
  return { cmd, data } as unknown as Message;
}

const T0 = 1_700_000_000_000;
const fresh = () => useParty.getState().reset();

test("a party needs someone else in it", () => {
  fresh();
  useParty.getState().applyMessage(msg("OnPartyStatus", { PartyID: 7, UserNames: ["Qrow"] }), T0);
  assert.equal(useParty.getState().partyID, undefined, "a party of one is not a party");

  useParty.getState().applyMessage(msg("OnPartyStatus", { PartyID: 7, UserNames: ["Qrow", "hexed"] }), T0);
  assert.equal(useParty.getState().partyID, 7);
  assert.deepEqual(useParty.getState().members, ["Qrow", "hexed"]);
});

test("the empty list dissolves the party", () => {
  fresh();
  useParty.getState().applyMessage(msg("OnPartyStatus", { PartyID: 7, UserNames: ["Qrow", "hexed"] }), T0);
  useParty.getState().applyMessage(msg("OnPartyStatus", { PartyID: 7, UserNames: [] }), T0);
  assert.equal(useParty.getState().partyID, undefined);
  assert.deepEqual(useParty.getState().members, []);
});

test("an invite carries its own deadline", () => {
  fresh();
  useParty.getState().applyMessage(msg("OnPartyInvite", {
    PartyID: 8, UserNames: ["lorelei", "Qrow"], TimeoutSeconds: 20,
  }), T0);
  const invite = useParty.getState().invite!;
  assert.equal(invite.expiresAt, T0 + 20_000);
  assert.equal(inviteSecondsLeft(invite, T0 + 15_000), 5);
  assert.equal(inviteSecondsLeft(invite, T0 + 40_000), 0);
  assert.equal(inviteSecondsLeft(undefined, T0), 0);
});

test("status for the invited party settles the invite", () => {
  fresh();
  useParty.getState().applyMessage(msg("OnPartyInvite", {
    PartyID: 8, UserNames: ["lorelei", "Qrow"], TimeoutSeconds: 20,
  }), T0);
  useParty.getState().applyMessage(msg("OnPartyStatus", {
    PartyID: 8, UserNames: ["lorelei", "Qrow"],
  }), T0);
  assert.equal(useParty.getState().invite, undefined, "we are in it now; stop asking");
  assert.equal(useParty.getState().partyID, 8);
});

test("status for a different party leaves the invite standing", () => {
  fresh();
  useParty.getState().applyMessage(msg("OnPartyInvite", {
    PartyID: 8, UserNames: ["lorelei", "Qrow"], TimeoutSeconds: 20,
  }), T0);
  useParty.getState().applyMessage(msg("OnPartyStatus", { PartyID: 9, UserNames: [] }), T0);
  assert.equal(useParty.getState().invite?.partyID, 8);
});
