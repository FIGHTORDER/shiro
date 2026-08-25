/**
 * Run with:  node --test src/store/complete.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { completeAt, matchesFor } from "./complete.ts";

const ROOM = ["Shadowfury", "hexed", "lorelei", "Qrow"];
const ZK = ["quantum", "shadowplay", "marrow"];
const GROUPS = [ROOM, ZK];

/** Complete at the end of `text`, which is where somebody is typing. */
const at = (text: string, prev?: Parameters<typeof completeAt>[3]) =>
  completeAt(text, text.length, GROUPS, prev);

test("a prefix completes to the whole name", () => {
  const c = at("Sha");
  assert.equal(c?.text, "Shadowfury");
  assert.equal(c?.caret, "Shadowfury".length);
});

test("nothing is added after the name", () => {
  /* Upstream appends no colon and no space. Adding one would be a different
     client's behaviour, and people who want it type it. */
  assert.equal(at("hex")?.text, "hexed");
});

test("completing mid-sentence leaves the sentence alone", () => {
  const c = completeAt("gg Sha well played", 6, GROUPS);
  assert.equal(c?.text, "gg Shadowfury well played");
  assert.equal(c?.caret, "gg Shadowfury".length);
});

test("Tab keeps its ordinary meaning where there is no word", () => {
  assert.equal(completeAt("", 0, GROUPS), null, "at the start of an empty box");
  assert.equal(completeAt("gg ", 3, GROUPS), null, "straight after a space");
  assert.equal(completeAt("gg Sha", 3, GROUPS), null, "caret sitting on a space");
});

test("a word nobody matches is left alone", () => {
  assert.equal(at("zzz"), null);
});

test("the room comes before the fallback, and prefixes before the rest", () => {
  /* `sha` starts Shadowfury (room) and shadowplay (fallback); it is inside
     neither of the others. All of the room before any of the fallback. */
  assert.deepEqual(matchesFor("sha", GROUPS), ["Shadowfury", "shadowplay"]);
  /* `row` starts nobody, and is inside Qrow (room) and marrow (fallback). */
  assert.deepEqual(matchesFor("row", GROUPS), ["Qrow", "marrow"]);
  /* A prefix in the room beats a substring in the room, which beats the
     fallback entirely. */
  assert.deepEqual(matchesFor("o", [["oscar", "lorelei"], ["ovid"]]),
    ["oscar", "lorelei", "ovid"]);
});

test("case does not matter to the person typing", () => {
  assert.equal(at("sHa")?.text, "Shadowfury");
  assert.equal(at("QROW")?.text, "Qrow");
});

test("pressing Tab again gets the next match, and wraps", () => {
  const first = at("sha");
  assert.equal(first?.text, "Shadowfury");

  const second = completeAt(first!.text, first!.caret, GROUPS, first!);
  assert.equal(second?.text, "shadowplay", "did not move on to the next match");

  const third = completeAt(second!.text, second!.caret, GROUPS, second!);
  assert.equal(third?.text, "Shadowfury", "did not wrap back to the first");
});

test("cycling keeps the rest of the line intact", () => {
  const first = completeAt("gg sha wp", 6, GROUPS);
  assert.equal(first?.text, "gg Shadowfury wp");
  const second = completeAt(first!.text, first!.caret, GROUPS, first!);
  assert.equal(second?.text, "gg shadowplay wp");
  assert.equal(second?.caret, "gg shadowplay".length);
});

test("typing again after a completion starts a fresh one", () => {
  /* The stale cycle must not be picked up: the box no longer holds what it
     held, so the next Tab is a new request, not the next match. */
  const first = at("sha");
  const edited = first!.text + "x";
  assert.equal(completeAt(edited, edited.length, GROUPS, first!), null,
    "Shadowfuryx matches nobody, so this is not a cycle");
});

test("the same person listed twice is offered once", () => {
  assert.deepEqual(matchesFor("qrow", [["Qrow"], ["qrow"]]), ["Qrow"]);
});
