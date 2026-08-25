/**
 * Run with:  node --test src/store/update.test.ts
 *
 * The transitions matter more than they look. An update that reports progress
 * after failing, or that can be started twice, ends with two downloads racing
 * over the same file - and the thing being downloaded is the application.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { useUpdate } from "./update.ts";

const fresh = () => useUpdate.setState({ state: { kind: "idle" } });

test("nothing has been asked before it is asked", () => {
  fresh();
  assert.equal(useUpdate.getState().state.kind, "idle");
});

test("installing without a check does nothing rather than throwing", async () => {
  fresh();
  await useUpdate.getState().install();
  assert.equal(useUpdate.getState().state.kind, "idle");
});

test("a second check while one is running is ignored", async () => {
  /* Two checks would be harmless; two installs would not, and they share this
     guard. Cheaper to make both single-flight than to explain which is which. */
  fresh();
  useUpdate.setState({ state: { kind: "checking" } });
  await useUpdate.getState().check();
  assert.equal(useUpdate.getState().state.kind, "checking");
});

test("a download in progress is not restarted by another install", async () => {
  fresh();
  const update = { version: "0.1.9" };
  useUpdate.setState({ state: { kind: "downloading", update, percent: 40 } });
  await useUpdate.getState().install();
  const s = useUpdate.getState().state;
  assert.equal(s.kind, "downloading");
  assert.equal(s.kind === "downloading" && s.percent, 40, "progress was not reset");
});

test("ready is a state of its own, because restarting is the player's call", () => {
  /* An update that closes the app mid-game is worse than one that waits. */
  fresh();
  const update = { version: "0.1.9" };
  useUpdate.setState({ state: { kind: "ready", update } });
  const s = useUpdate.getState().state;
  assert.equal(s.kind, "ready");
  assert.equal(s.kind === "ready" && s.update.version, "0.1.9");
});

test("a failure keeps its reason, which is the only place it is shown", () => {
  fresh();
  useUpdate.setState({ state: { kind: "failed", why: "network unreachable" } });
  const s = useUpdate.getState().state;
  assert.equal(s.kind === "failed" && s.why, "network unreachable");
});
