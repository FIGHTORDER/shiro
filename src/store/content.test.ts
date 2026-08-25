/**
 * Run with:  node --test src/store/content.test.ts
 *
 * These cover the one thing about downloads that has actually bitten: a batch
 * that reported success while half of it never arrived.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { useContent } from "./content.ts";

/* The Tauri bridge is not available under the test runner, so `fetch` cannot be
   exercised end to end here. What can be pinned is the reducer: the store must
   turn a failing outcome into a failing job, and `settledAll` must report the
   failure rather than the last result. */

function finish(id: string, outcome: string, message = "") {
  // The shape src/net/content.ts hands over for a Finished event.
  useContent.setState(s => ({
    jobs: {
      ...s.jobs,
      [id]: {
        ...(s.jobs[id] ?? { id, items: [], percent: 0 }),
        state: outcome === "ok" ? "done" : outcome === "killed" ? "cancelled" : "failed",
        percent: outcome === "ok" ? 100 : (s.jobs[id]?.percent ?? 0),
        reason: outcome === "ok" ? undefined : message,
      },
    },
    order: s.order.includes(id) ? s.order : [...s.order, id],
  }));
}

test("a failing outcome is a failing job, not a finished one", () => {
  useContent.getState().reset();
  finish("j1", "notFoundOrFailed", "The downloader could not find it.");
  const job = useContent.getState().jobs.j1;
  assert.equal(job.state, "failed");
  assert.equal(job.percent, 0, "a failure must not read as complete");
  assert.equal(job.reason, "The downloader could not find it.");
});

test("settledAll reports the failure, not the last job to finish", async () => {
  /* This is the bug in miniature. The game was already present and succeeded;
     the map did not exist and failed. Batched into one pr-downloader process
     the exit code was 0 - it exits 0 if ANY item succeeded - so the launch went
     ahead and the engine threw "Dependent archive not found". Split into one
     job per item, the map's failure is visible, and it has to win. */
  useContent.getState().reset();
  finish("game", "ok");
  finish("map", "notFoundOrFailed", "Hide and Seek 2.2.3 could not be downloaded.");
  const settled = await useContent.getState().settledAll(["game", "map"]);
  assert.equal(settled.state, "failed");
  assert.match(settled.reason ?? "", /Hide and Seek/);
});

test("settledAll is content when everything actually arrived", async () => {
  useContent.getState().reset();
  finish("game", "ok");
  finish("map", "ok");
  const settled = await useContent.getState().settledAll(["game", "map"]);
  assert.equal(settled.state, "done");
  assert.equal(settled.reason, undefined);
});

test("a cancelled job is not a failed one", async () => {
  useContent.getState().reset();
  finish("j", "killed");
  assert.equal(useContent.getState().jobs.j.state, "cancelled");
});
