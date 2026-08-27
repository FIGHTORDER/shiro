/**
 * Run with:  node --test src/store/chat.test.ts
 *
 * The mention rule earns most of this file because it is the one piece of chat
 * that is not obvious from reading it: the flag the protocol appears to offer
 * is not the flag you get. The reconnect tests at the bottom are the other
 * one - what the server replays on a join is not new.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "../protocol/registry.ts";
import { BACKLOG_SETTLE_MS, mentionsMe, roomKey, useChat } from "./chat.ts";

function msg(cmd: string, data: unknown): Message {
  return { cmd, data } as unknown as Message;
}

/* The mark beside a tab had never once appeared. It was keyed on `Say.Ring`,
   and `ZkLobbyServer/ConnectedUser.cs` strips that for any ordinary player in
   any ordinary channel - it survives only for an admin, or for the founder of a
   battle saying it in battle chat. So the flag exists, arrives false, and
   anything built on it silently does nothing. */

test("our name in a line is a mention, however it is cased", () => {
  assert.equal(mentionsMe("nice one Qrow", "Qrow", "hexed"), true);
  assert.equal(mentionsMe("nice one qrow", "Qrow", "hexed"), true,
    "people do not type other people's capitals");
});

test("our name inside a longer word is not", () => {
  assert.equal(mentionsMe("the Qrowd went wild", "Qrow", "hexed"), false);
  assert.equal(mentionsMe("xQrow won", "Qrow", "hexed"), false);
});

test("a clan tag runs into the name, so the edges have to include it", () => {
  assert.equal(mentionsMe("gg [ZKF]Qrow", "Qrow", "hexed"), false,
    "that is a different player, not us");
  assert.equal(mentionsMe("gg [ZKF]Qrow", "[ZKF]Qrow", "hexed"), true);
});

test("the roster bot does not mention everybody it lists", () => {
  /* Nightwatch posts battle results with the whole roster in them. A plain
     substring rule would ring the entire channel after every game, which is
     why upstream excludes it by name too. */
  assert.equal(mentionsMe("Team 1: Qrow, hexed", "Qrow", "Nightwatch"), false);
  assert.equal(mentionsMe("Team 1: Qrow, hexed", "Qrow", "hexed"), true,
    "the same words from a person still count");
});

test("nothing to match against is not a mention", () => {
  assert.equal(mentionsMe(undefined, "Qrow", "hexed"), false);
  assert.equal(mentionsMe("gg Qrow", undefined, "hexed"), false);
  assert.equal(mentionsMe("", "Qrow", "hexed"), false);
});

test("punctuation around a name still leaves it a name", () => {
  assert.equal(mentionsMe("Qrow: ready?", "Qrow", "hexed"), true);
  assert.equal(mentionsMe("(Qrow)", "Qrow", "hexed"), true);
  assert.equal(mentionsMe("gg, Qrow.", "Qrow", "hexed"), true);
});

/* The scan used to stop at the first occurrence, so one embedded near-match
   hid a real mention behind it and the conversation never lit up. */
test("a real mention still rings when an embedded one comes first", () => {
  assert.equal(mentionsMe("Qrowd and Qrow both played", "Qrow", "hexed"), true);
  assert.equal(mentionsMe("the Qrowd went wild, nice one Qrow", "Qrow", "hexed"), true);
  // And the guard it must not lose.
  assert.equal(mentionsMe("the Qrowd went wild", "Qrow", "hexed"), false);
});

test("words the player asked about ring like their name does", () => {
  assert.equal(mentionsMe("anyone up for teams?", "Qrow", "hexed", ["teams"]), true);
  assert.equal(mentionsMe("TEAMS starting", "Qrow", "hexed", ["teams"]), true,
    "matching is case-insensitive, the same as for a name");
});

test("a highlight is a word, not a substring", () => {
  assert.equal(mentionsMe("steamroller inbound", "Qrow", "hexed", ["teams"]), false);
  assert.equal(mentionsMe("bteams", "Qrow", "hexed", ["teams"]), false);
});

test("blank and absent rules ring nothing", () => {
  assert.equal(mentionsMe("hello there", "Qrow", "hexed", ["  ", ""]), false);
  assert.equal(mentionsMe("hello there", "Qrow", "hexed", []), false);
  assert.equal(mentionsMe("hello there", "Qrow", "hexed"), false);
});

test("Nightwatch stays silent even for a highlight", () => {
  assert.equal(mentionsMe("teams up", "Qrow", "Nightwatch", ["teams"]), false);
});

/* ------------------------------------------------------------ reconnect ---
   A reconnect re-joins every channel, and the server answers a join with that
   channel's backlog. Those lines have all been read already. */

const joined = (channel: string) => useChat.getState().applyMessage(
  msg("JoinChannelResponse", { Success: true, ChannelName: channel }));

const said = (channel: string, user: string, text: string, time: string) =>
  msg("Say", { Place: 0, Target: channel, User: user, Text: text, Time: time,
    IsEmote: false, Ring: false });

/** Push a room's clock back, the way sitting in a channel for an hour does. */
function age(id: string, ms: number): void {
  const room = useChat.getState().rooms[id];
  useChat.setState({ rooms: { ...useChat.getState().rooms,
    [id]: { ...room, openedAt: room.openedAt - ms } } });
}

test("the backlog replayed on a reconnect does not light every tab up", () => {
  const chat = useChat.getState();
  chat.reset();
  chat.setMe("Qrow");
  joined("zk");
  joined("sy");
  const lines = [
    said("sy", "hexed", "anyone for teams", "2026-08-18T09:00:00Z"),
    said("sy", "lorelei", "in a bit", "2026-08-18T09:00:05Z"),
    said("sy", "hexed", "nice one Qrow", "2026-08-18T09:00:09Z"),
  ];
  useChat.getState().applyBatch(lines);
  useChat.getState().setActive(roomKey("channel", "zk"));

  const sy = roomKey("channel", "sy");
  assert.equal(useChat.getState().rooms[sy].unread, 0, "read inside the settle window");
  age(sy, 60 * 60 * 1000);
  age(roomKey("channel", "zk"), 60 * 60 * 1000);

  // Dropped and back. Every channel is asked for again and replayed at us.
  useChat.getState().rejoinChannels();
  joined("zk");
  joined("sy");
  useChat.getState().applyBatch(lines);

  const room = useChat.getState().rooms[sy];
  assert.equal(room.unread, 0, "the tab lit up for lines already read");
  assert.equal(room.mention, false, "and rang for a mention already answered");
  assert.equal(room.messages.length, 3, "the scrollback was said twice");
});

test("a line said again for real after a reconnect still counts", () => {
  const chat = useChat.getState();
  chat.reset();
  chat.setMe("Qrow");
  joined("zk");
  joined("sy");
  useChat.getState().setActive(roomKey("channel", "zk"));
  const sy = roomKey("channel", "sy");
  age(sy, 60 * 60 * 1000);

  useChat.getState().rejoinChannels();
  joined("sy");
  useChat.getState().applyBatch([said("sy", "hexed", "gg", "2026-08-18T09:00:00Z")]);
  useChat.getState().applyBatch([said("sy", "hexed", "wp", "2026-08-18T09:00:00Z")]);
  assert.equal(useChat.getState().rooms[sy].messages.length, 2,
    "different words at the same time are a different line");

  // Out of the settle window, so this is the channel talking, not a replay.
  age(sy, BACKLOG_SETTLE_MS + 1000);
  useChat.getState().applyBatch([said("sy", "hexed", "gg", "2026-08-18T09:00:00Z")]);
  const room = useChat.getState().rooms[sy];
  assert.equal(room.messages.length, 3, "a live line was swallowed as a replay");
  assert.equal(room.unread, 1);
});
