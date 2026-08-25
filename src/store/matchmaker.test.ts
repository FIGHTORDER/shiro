/**
 * Run with:  node --test src/store/matchmaker.test.ts
 * (Node strips the types; imports need explicit .ts extensions and this file
 * must not import an enum - see protocol/wire.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "../protocol/registry.ts";
import { useMatchmaker, secondsLeft, groupQueues } from "./matchmaker.ts";

function msg(cmd: string, data: unknown): Message {
  return { cmd, data } as unknown as Message;
}

const T0 = 1_700_000_000_000;

/* Anything that sends reaches `net/session`, which reaches Tauri at import time
   and so cannot resolve under `node --test`. The store logs that and carries on,
   which is the right behaviour and the wrong thing to print here - a stack trace
   in a passing run reads as a failure. Drop that one line and nothing else. */
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("matchmaker: ")) return;
  realError(...args);
};

function fresh() {
  useMatchmaker.getState().reset();
  return useMatchmaker.getState();
}

const SETUP = msg("MatchMakerSetup", {
  PossibleQueues: [
    /* Exactly the five fields the server serialises. The rest of Queue is
       `[JsonIgnore]` upstream, and a fixture carrying them would be a fixture
       of a server that does not exist - which is how they got read in the
       first place. */
    { Name: "1v1", Description: "1v1", MaxPartySize: 1 },
  ],
});

test("the queue list is whatever the server offers", () => {
  fresh();
  useMatchmaker.getState().applyMessage(SETUP, T0);
  assert.equal(useMatchmaker.getState().queues.length, 1);
  assert.equal(useMatchmaker.getState().queues[0].Name, "1v1");
});

test("status is the authority on which queues we are in", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("MatchMakerStatus", {
    JoinedQueues: ["Teams"], QueueCounts: { Teams: 21 }, IngameCounts: { Teams: 14 },
    JoinedTime: "2026-08-18T10:00:00Z", UserCount: 100, UserCountDiscord: 0,
  }), T0);
  const s = useMatchmaker.getState();
  assert.deepEqual(s.joined, ["Teams"]);
  assert.equal(s.counts.Teams, 21);
  assert.equal(s.ingame.Teams, 14);
  assert.equal(s.joinedTime, "2026-08-18T10:00:00Z");
});

/* The screen is switches because of this: the request is the whole set, so
   there is no join and no leave to send, only "these are the ones I want". */
test("setting the queues replaces the set rather than adding to it", () => {
  fresh();
  useMatchmaker.getState().setQueues(["Teams"]);
  assert.deepEqual(useMatchmaker.getState().joined, ["Teams"]);
  useMatchmaker.getState().setQueues(["Teams", "1v1"]);
  assert.deepEqual(useMatchmaker.getState().joined, ["Teams", "1v1"]);
  useMatchmaker.getState().setQueues(["1v1"]);
  assert.deepEqual(useMatchmaker.getState().joined, ["1v1"], "the others are dropped, not kept");
  useMatchmaker.getState().setQueues([]);
  assert.deepEqual(useMatchmaker.getState().joined, [], "and empty leaves the matchmaker");
});

test("a zero ban is no ban, not a zero-second one", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("MatchMakerStatus", {
    BannedSeconds: 0, UserCount: 1, UserCountDiscord: 0,
  }), T0);
  assert.equal(useMatchmaker.getState().bannedSeconds, undefined);
});

test("the ready check deadline is computed once, on arrival", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("AreYouReady", {
    SecondsRemaining: 30, QuickPlay: false, MinimumWinChance: 0.4,
  }), T0);
  const check = useMatchmaker.getState().check!;
  assert.equal(check.expiresAt, T0 + 30_000);
  assert.equal(secondsLeft(check, T0), 30);
  assert.equal(secondsLeft(check, T0 + 25_000), 5);
  assert.equal(secondsLeft(check, T0 + 60_000), 0, "never counts past zero");
});

test("updates refine the check without restating the countdown", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("AreYouReady", {
    SecondsRemaining: 30, QuickPlay: false, MinimumWinChance: 0.4,
  }), T0);
  useMatchmaker.getState().applyMessage(msg("AreYouReadyUpdate", {
    ReadyAccepted: true, LikelyToPlay: false, YourBattleSize: 4, YourBattleReady: 2,
  }), T0 + 5_000);
  const check = useMatchmaker.getState().check!;
  assert.equal(check.expiresAt, T0 + 30_000, "the deadline is not restarted");
  assert.equal(check.accepted, true);
  assert.equal(check.likelyToPlay, false);
  assert.equal(check.battleReady, 2);
});

test("an update outside a check is ignored rather than inventing one", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("AreYouReadyUpdate", {
    ReadyAccepted: true, LikelyToPlay: true,
  }), T0);
  assert.equal(useMatchmaker.getState().check, undefined);
});

test("a started match clears the check without an excuse", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("AreYouReady", {
    SecondsRemaining: 30, QuickPlay: false, MinimumWinChance: 0,
  }), T0);
  useMatchmaker.getState().applyMessage(msg("AreYouReadyResult", {
    IsBattleStarting: true, AreYouBanned: false,
  }), T0);
  assert.equal(useMatchmaker.getState().check, undefined);
  assert.equal(useMatchmaker.getState().lastFailure, undefined);
});

test("a collapsed match says why", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("AreYouReady", {
    SecondsRemaining: 30, QuickPlay: false, MinimumWinChance: 0,
  }), T0);
  useMatchmaker.getState().applyMessage(msg("AreYouReadyResult", {
    IsBattleStarting: false, AreYouBanned: false,
  }), T0);
  assert.match(useMatchmaker.getState().lastFailure!, /back in the queue/);

  useMatchmaker.getState().applyMessage(msg("AreYouReady", {
    SecondsRemaining: 30, QuickPlay: false, MinimumWinChance: 0,
  }), T0);
  assert.equal(useMatchmaker.getState().lastFailure, undefined, "a new check clears the old excuse");
  useMatchmaker.getState().applyMessage(msg("AreYouReadyResult", {
    IsBattleStarting: false, AreYouBanned: true,
  }), T0);
  assert.match(useMatchmaker.getState().lastFailure!, /banned/);
});

test("secondsLeft with no check is zero, not NaN", () => {
  assert.equal(secondsLeft(undefined, T0), 0);
});

// ------------------------------------------------------------ categories ---

/* Every queue ZkLobbyServer runs, name and description verbatim out of
   MatchMaker.cs. The grouping is only worth anything if it holds against the
   real list, and the real list is the awkward shape: four of the seventeen are
   named for something other than their size, and one has no size at all. */
const REAL = [
  { id: "Sortie", description: "Play 2v2 or 3v3 with players of similar skill." },
  { id: "Sortie Wide", description: "Play 2v2 or 3v3 with anyone." },
  { id: "Battle", description: "Play 4v4, 5v5 or 6v6 with players of similar skill." },
  { id: "Battle Wide", description: "Play 4v4, 5v5 or 6v6 with anyone." },
  { id: "Coop", description: "Play together, against AI or chickens." },
  { id: "1v1", description: "Play 1v1 with an opponent of similar skill. Games beyond the "
    + "matching range of '1v1 Narrow' are unranked and have a bonus for the lower ranked player." },
  { id: "1v1 Narrow", description: "Play 1v1 with a closely matched opponent." },
  { id: "1v1 Wide", description: "Play 1v1 with a potentially not-so-closely matched opponent. "
    + "The matching range is the same as standard '1v1'." },
  { id: "2v2+", description: "Play a casual 2v2 or larger with anyone." },
  { id: "3v3+", description: "Play a casual 3v3 or larger with anyone." },
  { id: "4v4+", description: "Play a casual 4v4 or larger with anyone." },
  { id: "5v5+", description: "Play a casual 5v5 or larger with anyone." },
  { id: "6v6+", description: "Play a casual 6v6 or larger with anyone." },
  { id: "7v7+", description: "Play a casual 7v7 or larger with anyone." },
  { id: "8v8+", description: "Play a casual 8v8 or larger with anyone." },
  { id: "9v9+", description: "Play a casual 9v9 or larger with anyone." },
  { id: "10v10+", description: "Play a casual 10v10 or larger with anyone." },
];

test("the server's seventeen queues come out as three kinds of game", () => {
  const groups = groupQueues(REAL);
  assert.deepEqual(groups.map(g => g.label), ["1v1", "Teams", "Coop"]);
  assert.equal(groups.reduce((n, g) => n + g.queues.length, 0), REAL.length,
    "every queue lands in exactly one category");
});

test("a queue named for its size is grouped by the name", () => {
  const groups = groupQueues(REAL);
  assert.deepEqual(groups.find(g => g.id === "1v1")!.queues.map(q => q.id),
    ["1v1", "1v1 Narrow", "1v1 Wide"]);
});

/* Sortie and Battle are the two named for something else. Both state their size
   in the first line of the description, and both are team games, so both land
   in Teams beside the casual queues rather than in a category of their own. */
test("a queue named for something else is grouped by what its description says", () => {
  const groups = groupQueues(REAL);
  assert.deepEqual(groups.find(g => g.id === "Teams")!.queues.map(q => q.id), [
    "Sortie", "Sortie Wide", "Battle", "Battle Wide",
    "2v2+", "3v3+", "4v4+", "5v5+", "6v6+", "7v7+", "8v8+", "9v9+", "10v10+",
  ]);
});

/* The name is read first on purpose. "1v1"'s own description mentions "1v1
   Narrow", so description-first would happen to give the same answer here and
   would be relying on luck; a queue whose description named another size would
   land in the wrong place. */
test("the name wins over a description that mentions another queue", () => {
  const groups = groupQueues([
    { id: "1v1 Narrow", description: "Like 5v5 but smaller." },
  ]);
  assert.deepEqual(groups.map(g => g.label), ["1v1"]);
});

/* Coop's description ends "against AI or chickens", which is exactly the trap:
   read that first and the one coop queue the server runs disappears into a
   chickens category. */
test("coop is coop, not chickens, however its description ends", () => {
  const groups = groupQueues(REAL);
  assert.deepEqual(groups.find(g => g.id === "Coop")!.queues.map(q => q.id), ["Coop"]);
});

/* Nothing here is a chickens queue - upstream's Coop is `GameChickens` but is
   named and described as coop - so the category is declared and stays off the
   screen until a queue turns up for it. */
test("chickens is empty today, and empty means not shown", () => {
  assert.equal(groupQueues(REAL).some(g => g.id === "Chickens"), false);
  const groups = groupQueues([...REAL, { id: "Chicken Rush", description: "Survive the flock." }]);
  assert.deepEqual(groups.map(g => g.label), ["1v1", "Teams", "Coop", "Chickens"]);
});

/* Zero-K adds queues, and the four rules will not recognise all of them. An
   unrecognised queue is a row at the end of the list, because a queue nobody
   can see is a queue nobody can join. */
test("a queue matching none of the four is shown under Other, last", () => {
  const groups = groupQueues([...REAL, { id: "Planetwars", description: "Fight for a planet." }]);
  assert.deepEqual(groups.map(g => g.label), ["1v1", "Teams", "Coop", "Other"]);
  assert.deepEqual(groups[groups.length - 1].queues.map(q => q.id), ["Planetwars"]);
});

test("nothing offered groups to nothing", () => {
  assert.deepEqual(groupQueues([]), []);
});
