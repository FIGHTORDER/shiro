/**
 * Run with:  node --test src/store/friends.test.ts
 * (Node strips the types; imports need explicit .ts extensions and this file
 * must not import an enum - see protocol/wire.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "../protocol/registry.ts";
import { useFriends } from "./friends.ts";

function msg(cmd: string, data: unknown): Message {
  return { cmd, data } as unknown as Message;
}

function fresh() {
  useFriends.getState().reset();
  return useFriends.getState();
}

test("the friend list is the server's, sorted and name-only", () => {
  fresh();
  useFriends.getState().applyMessage(msg("FriendList", {
    Friends: [{ Name: "quantum" }, { Name: "hexed", SteamID: "7" }, { Name: undefined }],
  }));
  assert.deepEqual(useFriends.getState().friends, ["hexed", "quantum"]);
});

test("a later list replaces the earlier one - removals have to stick", () => {
  fresh();
  useFriends.getState().applyMessage(msg("FriendList", { Friends: [{ Name: "a" }, { Name: "b" }] }));
  useFriends.getState().applyMessage(msg("FriendList", { Friends: [{ Name: "a" }] }));
  assert.deepEqual(useFriends.getState().friends, ["a"]);
});

test("a single entry is added without a full refresh", () => {
  fresh();
  useFriends.getState().applyMessage(msg("FriendList", { Friends: [{ Name: "b" }] }));
  useFriends.getState().applyMessage(msg("FriendEntry", { Name: "a" }));
  assert.deepEqual(useFriends.getState().friends, ["a", "b"]);
  useFriends.getState().applyMessage(msg("FriendEntry", { Name: "a" }));
  assert.deepEqual(useFriends.getState().friends, ["a", "b"], "and not twice");
});

test("ignores are tracked separately", () => {
  fresh();
  useFriends.getState().applyMessage(msg("IgnoreList", { Ignores: ["spammer", "aaa"] }));
  assert.deepEqual(useFriends.getState().ignores, ["aaa", "spammer"]);
  assert.deepEqual(useFriends.getState().friends, []);
});
