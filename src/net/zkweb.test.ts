import { test } from "node:test";
import assert from "node:assert/strict";

import { latestRating, profileUrl } from "./zkweb.ts";

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
   who is terrible instead of as an answer we do not have. */
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

/* The "zero-k.info" button on a profile.
   `/Users/Detail?name=sugondese` is what it used to build, and a query string
   does not bind to that route - so it arrived with nothing to resolve and every
   player, looked up or not, landed on `Invalid account (neither an ID nor
   name)`. The account goes in the path segment. */

test("a player page is addressed by path, not by query", () => {
  assert.equal(profileUrl("Zythid"), "https://zero-k.info/Users/Detail/Zythid");
  assert.equal(profileUrl("Zythid", 450611), "https://zero-k.info/Users/Detail/450611");
});

/* The id when there is one: their name lookup is case-sensitive, and a name of
   nothing but digits resolves as somebody else's account. */
test("the account id wins over the name", () => {
  assert.equal(profileUrl("12345"), "https://zero-k.info/Users/Detail/12345");
  assert.equal(profileUrl("12345", 450611), "https://zero-k.info/Users/Detail/450611");
});

/* A `User` record with no id in it reads as 0, which addresses nobody. */
test("an id we do not have falls back to the name rather than to zero", () => {
  assert.equal(profileUrl("Zythid", 0), "https://zero-k.info/Users/Detail/Zythid");
  assert.equal(profileUrl("Zythid", undefined), "https://zero-k.info/Users/Detail/Zythid");
  assert.equal(profileUrl("Zythid", Number.NaN), "https://zero-k.info/Users/Detail/Zythid");
  assert.equal(profileUrl("Zythid", -1), "https://zero-k.info/Users/Detail/Zythid");
});

/* Nobody has no page, and the site root is not a profile. */
test("nobody is not a link", () => {
  assert.equal(profileUrl(""), undefined);
  assert.equal(profileUrl("   "), undefined);
  assert.equal(profileUrl(undefined), undefined);
});

/* A name is somebody's own text going into a path segment. */
test("a name that needs escaping is escaped", () => {
  assert.equal(profileUrl("a b"), "https://zero-k.info/Users/Detail/a%20b");
  assert.equal(profileUrl("../Admin"), "https://zero-k.info/Users/Detail/..%2FAdmin");
});
