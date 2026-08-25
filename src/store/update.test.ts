/**
 * Run with:  node --test src/store/update.test.ts
 *
 * The transitions matter more than they look. An update that reports progress
 * after failing, or that can be started twice, ends with two downloads racing
 * over the same file - and the thing being downloaded is the application.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { explain, useUpdate } from "./update.ts";

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

/* The message a rotated signing key produces is precise and useless: it names
   the cause and not the remedy, and no amount of retrying helps, so the app has
   to say "install once by hand" itself. This is the exact string the plugin
   raised on the 1.0.0 builds. */
test("a key mismatch is explained rather than quoted", () => {
  const out = explain(new Error(
    "The signature was created with a different key than the one provided"));
  assert.match(out, /older key/);
  assert.match(out, /latest installer/);
  assert.doesNotMatch(out, /signature was created/);
});

test("anything else is passed through unchanged", () => {
  assert.equal(explain(new Error("Network unreachable")), "Network unreachable");
  assert.equal(
    explain(new Error("Could not fetch a valid release JSON from the remote")),
    "Could not fetch a valid release JSON from the remote");
});

test("a thrown non-error still reads as something", () => {
  assert.equal(explain("plain string"), "plain string");
});
