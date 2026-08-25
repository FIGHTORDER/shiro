/**
 * Run with:  node --test src/store/chat.test.ts
 *
 * Just the mention rule for now. It earns a file of its own because it is the
 * one piece of chat that is not obvious from reading it: the flag the protocol
 * appears to offer is not the flag you get.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mentionsMe } from "./chat.ts";

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
