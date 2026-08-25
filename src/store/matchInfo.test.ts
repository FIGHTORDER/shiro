/**
 * Run with:  node --test src/store/matchInfo.test.ts
 *
 * What the loading screen is told about the match. The screen itself cannot be
 * tested from here - it runs inside the engine - so this pins the one part that
 * is ordinary code: turning a room's roster into two named sides.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { matchInfoFor } from "./room.ts";

const player = (name: string, ally: number, spectator = false) =>
  ({ Name: name, AllyNumber: ally, IsSpectator: spectator });

test("players are grouped by side, and the sides are numbered from one", () => {
  // Ally numbers are zero-based on the wire; "Team 0" would be nobody's idea of
  // a team name.
  const out = matchInfoFor({
    players: {
      Qrow: player("Qrow", 0),
      hexed: player("hexed", 1),
      klon: player("klon", 0),
    },
    bots: {},
    title: "Teams 8v8",
    map: "Comet Catcher Redux",
  });
  assert.ok(out);
  assert.deepEqual(out.teams.map(t => t.label), ["Team 1", "Team 2"]);
  assert.deepEqual(out.teams[0].players, ["klon", "Qrow"]);
  assert.equal(out.map, "Comet Catcher Redux");
});

test("spectators are not in the match", () => {
  // They are in the room, which is a different thing, and a screen that lists
  // them is wrong about who is playing.
  const out = matchInfoFor({
    players: {
      Qrow: player("Qrow", 0),
      watcher: player("watcher", 1, true),
    },
    bots: {},
  });
  assert.ok(out);
  assert.deepEqual(out.teams.map(t => t.label), ["Team 1"]);
  assert.deepEqual(out.teams[0].players, ["Qrow"]);
});

test("bots are, because a 4v4 against AI is still a 4v4", () => {
  const out = matchInfoFor({
    players: { Qrow: player("Qrow", 0) },
    bots: { "CAI (1)": { Name: "CAI (1)", AllyNumber: 1, AiLib: "CAI" } },
  });
  assert.ok(out);
  assert.equal(out.teams.length, 2);
  assert.deepEqual(out.teams[1].players, ["CAI (1)"]);
});

test("a room with nobody in it writes nothing at all", () => {
  /* Absent is a state the screen handles - it draws the plate. An empty match
     would be a caption that says nothing, which is worse than no caption. */
  assert.equal(matchInfoFor({ players: {}, bots: {} }), undefined);
  assert.equal(
    matchInfoFor({ players: { a: player("a", 0, true) }, bots: {} }),
    undefined,
    "a room of only spectators is not a match",
  );
});

test("a missing title or map is empty, not the word undefined", () => {
  const out = matchInfoFor({ players: { Qrow: player("Qrow", 0) }, bots: {} });
  assert.ok(out);
  assert.equal(out.map, "");
  assert.equal(out.title, "");
});
