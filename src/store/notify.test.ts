/**
 * Run with:  node --test src/store/notify.test.ts
 * (Node strips the types; imports need explicit .ts extensions.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "../protocol/registry.ts";
import { alertsFor } from "./notify.ts";
import type { AlertContext, AlertKind } from "./notify.ts";

function msg<K extends string>(cmd: K, data: unknown): Message {
  return { cmd, data } as unknown as Message;
}

/** Not looking at Shiro, everything switched on, no channel in backlog. */
function ctx(patch: Partial<AlertContext> = {}): AlertContext {
  return {
    me: "Qrow",
    focused: false,
    enabled: () => true,
    settled: () => true,
    ...patch,
  };
}

const kinds = (a: { kind: AlertKind }[]): AlertKind[] => a.map(x => x.kind);

test("a ready check is worth interrupting somebody for", () => {
  /* The one that matters most: it has a deadline, and missing it can earn a
     matchmaker ban. Before this existed it made no sound and no mark. */
  const out = alertsFor([msg("AreYouReady", { SecondsRemaining: 20 })], ctx());
  assert.deepEqual(kinds(out), ["readyCheck"]);
});

test("nothing fires while the window is being looked at", () => {
  const out = alertsFor([
    msg("AreYouReady", { SecondsRemaining: 20 }),
    msg("OnPartyInvite", { PartyID: 1, UserNames: ["hexed"], TimeoutSeconds: 30 }),
  ], ctx({ focused: true }));
  assert.deepEqual(out, [], "interrupted somebody who was already here");
});

test("a party invite names whoever is not us", () => {
  const out = alertsFor([msg("OnPartyInvite",
    { PartyID: 1, UserNames: ["hexed", "Qrow"], TimeoutSeconds: 30 })], ctx());
  assert.deepEqual(kinds(out), ["partyInvite"]);
  assert.equal(out[0].body, "hexed", "named us back to ourselves");
});

test("an invite with nobody else left in it still says what happened", () => {
  const out = alertsFor([msg("OnPartyInvite",
    { PartyID: 1, UserNames: ["Qrow"], TimeoutSeconds: 30 })], ctx());
  assert.deepEqual(kinds(out), ["partyInvite"]);
  assert.equal(out[0].body, undefined);
});

test("a direct message reaches us", () => {
  // Place 2 is PLACE_USER; routeSay turns it into a dm room.
  const out = alertsFor([msg("Say",
    { Place: 2, User: "hexed", Target: "Qrow", Text: "want a game?" })], ctx());
  assert.deepEqual(kinds(out), ["mention"]);
  assert.equal(out[0].title, "hexed");
  assert.equal(out[0].body, "want a game?");
});

test("our own message does not notify us", () => {
  const out = alertsFor([msg("Say",
    { Place: 2, User: "Qrow", Target: "hexed", Text: "on my way" })], ctx());
  assert.deepEqual(out, []);
});

test("a channel line only counts when it named us", () => {
  // Place 0 is PLACE_CHANNEL. 1 is battle chat, which is a different room kind.
  const quiet = alertsFor([msg("Say",
    { Place: 0, User: "hexed", Target: "zk", Text: "gg" })], ctx());
  assert.deepEqual(quiet, [], "ordinary channel traffic is not an interruption");

  /* Deliberately no Ring on this one. The server strips it for an ordinary
     player in an ordinary channel - ZkLobbyServer/ConnectedUser.cs keeps it
     only for an admin or a battle founder in battle chat - so a rule keyed on
     Ring never fires and this test would pass while the feature did nothing. */
  const named = alertsFor([msg("Say",
    { Place: 0, User: "hexed", Target: "zk", Text: "gg Qrow" })], ctx());
  assert.deepEqual(kinds(named), ["mention"]);
  assert.equal(named[0].title, "hexed in #zk");
});

test("the bot that posts every roster does not name everybody", () => {
  /* Nightwatch writes battle results into channels with the full roster in
     them, so a plain substring rule would ring the entire channel after every
     game. Upstream excludes it by name for the same reason. */
  const out = alertsFor([msg("Say",
    { Place: 0, User: "Nightwatch", Target: "zk",
      Text: "Team 1: Qrow, hexed. Team 2: lorelei, marrow." })], ctx());
  assert.deepEqual(out, []);
});

test("a name inside a longer word is not our name", () => {
  const out = alertsFor([msg("Say",
    { Place: 0, User: "hexed", Target: "zk", Text: "the Qrowd went wild" })], ctx());
  assert.deepEqual(out, []);
});

test("our name is recognised however it is typed", () => {
  const out = alertsFor([msg("Say",
    { Place: 0, User: "hexed", Target: "zk", Text: "nice one qrow!" })], ctx());
  assert.deepEqual(kinds(out), ["mention"]);
});

test("a mention replayed on rejoining a channel is not a fresh one", () => {
  /* Rejoining replays the backlog. The same call we already answered must not
     arrive again as a notification - the chat store draws exactly this line
     for its unread marks, and this asks it rather than restating the rule. */
  const out = alertsFor([msg("Say",
    { Place: 0, User: "hexed", Target: "zk", Text: "Qrow: gg" })],
    ctx({ settled: () => false }));
  assert.deepEqual(out, []);
});

test("a switched-off kind stays quiet while the others do not", () => {
  const out = alertsFor([
    msg("AreYouReady", { SecondsRemaining: 20 }),
    msg("ConnectSpring", { Ip: "1.2.3.4", Port: 8452 }),
  ], ctx({ enabled: k => k !== "readyCheck" }));
  assert.deepEqual(kinds(out), ["battleStart"]);
});

test("a server message box is not chat and does not notify", () => {
  // Place 5 is MessageBox; routeSay drops it, and so must this.
  const out = alertsFor([msg("Say",
    { Place: 5, Text: "You have been muted." })], ctx());
  assert.deepEqual(out, []);
});

test("battle chat is left to the room, not the desktop", () => {
  /* Places 1, 3 and 4 all render in the battle room. Somebody in a battle is
     about to get the battleStart alert anyway, and a room that chatters at the
     desktop through the whole setup would be the interruption this module
     exists to avoid. Stated as a test because it is a choice, not an oversight. */
  const out = alertsFor([msg("Say",
    { Place: 1, User: "hexed", Text: "Qrow ready?", Ring: true })], ctx());
  assert.deepEqual(out, []);
});

test("battle-list churn is not something to interrupt anybody for", () => {
  const out = alertsFor([
    msg("BattleAdded", { Header: { BattleID: 1 } }),
    msg("BattleUpdate", { Header: { BattleID: 1 } }),
    msg("User", { Name: "hexed", AccountID: 2 }),
  ], ctx());
  assert.deepEqual(out, []);
});
