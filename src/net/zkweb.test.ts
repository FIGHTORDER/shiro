import { test } from "node:test";
import assert from "node:assert/strict";

import { latestRating } from "./zkweb.ts";

/* The rating a player is on now, for somebody the lobby cannot tell us about.
   `/Users/Detail/<name>` carries no rating figure at all - only a link to the
   chart - so the end of the series is the whole answer, and getting it wrong
   means a number under someone's name that is not theirs. */

test("the end of the series is where they are now", () => {
  assert.equal(latestRating([
    { date: "2018-01-20", elo: 2668.475 },
    { date: "2026-08-07", elo: 3494.83 },
    { date: "2026-08-19", elo: 3494.55 },
  ]), 3494.55);
});

test("one point is still an answer", () => {
  assert.equal(latestRating([{ date: "2026-08-19", elo: 1500 }]), 1500);
});

/* Nothing, rather than zero. A new account and a category never played both
   come back as an empty series, and a zero on a rating tile reads as a player
   who is terrible instead of as an answer we do not have.
   docs/PROFILE-AND-SEARCH.md section 5. */
test("no series is not a rating of zero", () => {
  assert.equal(latestRating([]), undefined);
  assert.equal(latestRating(undefined), undefined);
});

/* Every field on that side is somebody else's markup, so a point that did not
   parse must not become NaN on screen. */
test("a point that did not parse is not a rating either", () => {
  assert.equal(latestRating([{ date: "2026-08-19" }] as never), undefined);
  assert.equal(latestRating([{ date: "2026-08-19", elo: Number.NaN }]), undefined);
});
