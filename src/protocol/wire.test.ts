/**
 * Run with:  node --test src/protocol/wire.test.ts
 * (Node strips the types; this file deliberately imports no enums, because
 * `enum` is a runtime construct that plain type-stripping cannot handle.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLine, serialize, mergePatch } from "./wire.ts";

test("parseLine splits on the first space only", () => {
  const m = parseLine('Say {"Text":"hello world","Place":0}');
  assert.equal(m?.cmd, "Say");
  assert.equal((m?.data as { Text: string }).Text, "hello world");
});

test("parseLine handles a payload-less command", () => {
  const m = parseLine("PwCancel {}");
  assert.equal(m?.cmd, "PwCancel");
});

test("parseLine returns null for junk rather than throwing", () => {
  assert.equal(parseLine(""), null);
  assert.equal(parseLine("   "), null);
  assert.equal(parseLine("NotARealCommand {}"), null);
  assert.equal(parseLine("Say {not json"), null);
});

test("serialize round-trips through parseLine", () => {
  const line = serialize("BattleRemoved", { BattleID: 42 });
  assert.equal(line, 'BattleRemoved {"BattleID":42}');
  assert.deepEqual(parseLine(line)?.data, { BattleID: 42 });
});

// --- the merge rule --------------------------------------------------------

test("mergePatch preserves fields the server omitted", () => {
  const base = { BattleID: 1, Title: "Teams 8v8", Map: "Argent_Strata_1.1", PlayerCount: 11 };
  // A real BattleUpdate: only the count changed, so only the count is sent.
  const merged = mergePatch(base, { PlayerCount: 12 });
  assert.deepEqual(merged, {
    BattleID: 1, Title: "Teams 8v8", Map: "Argent_Strata_1.1", PlayerCount: 12,
  });
});

test("mergePatch treats an explicitly-undefined key as unchanged", () => {
  // This is the case a naive spread gets wrong: {...base, ...patch} would set
  // Title to undefined and blank the battle title in the UI.
  const base = { BattleID: 1, Title: "Teams 8v8", PlayerCount: 11 };
  const patch = { PlayerCount: 12, Title: undefined };
  assert.equal(mergePatch(base, patch).Title, "Teams 8v8");
  assert.equal({ ...base, ...patch }.Title, undefined); // documents the trap
});

test("mergePatch writes an explicit null through", () => {
  const base = { BattleID: 1, Password: "secret" };
  const merged = mergePatch(base, { Password: null } as unknown as Partial<typeof base>);
  assert.equal(merged.Password, null);
});

test("mergePatch on unknown base yields the patch", () => {
  assert.deepEqual(mergePatch<{ a?: number }>(undefined, { a: 1 }), { a: 1 });
});
