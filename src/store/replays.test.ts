import assert from "node:assert/strict";
import test from "node:test";

import {
  averageRating, engineMismatch, isTrivial, matchesTerm, modeOf, opponents,
  outcomeFor, parseQuery, partition, playerCount, rowFromArchive, rowFromReplay,
  rowMode, rowRating, searchReplays, sides, sortReplays, summariseSide,
  teammates, versus,
} from "./replays.ts";
import type { Replay, ReplayPlayer } from "./replays.ts";

const player = (
  name: string, ally: number | undefined, extra: Partial<ReplayPlayer> = {},
): ReplayPlayer => ({
  name, ally, team: ally, spectator: false, bot: false, ...extra,
});

const DAY = 24 * 60 * 60;
const AUG20 = Math.floor(Date.parse("2026-08-20T12:00:00Z") / 1000);

const game = (over: Partial<Replay> = {}): Replay => ({
  path: "C:/demos/a.sdfz", file: "a.sdfz", bytes: 1000,
  map: "Canis River v1.4", game: "Zero-K v1.14.8.0", engine: "2025.06.21",
  playedAt: AUG20, duration: 30 * 60,
  players: [
    player("Qrow", 0, { elo: 2358, clan: "RSN" }),
    player("mankarse", 0, { elo: 2548 }),
    player("Aquanim", 1, { elo: 3032 }),
    player("Kadril", 1, { elo: 2554 }),
    player("watcher", undefined, { spectator: true }),
  ],
  winners: [0], hasStats: true,
  ...over,
});

// ---------------------------------------------------------------- outcome ---

test("a result is read through the ally team, not the team", () => {
  /* The engine names the winning *ally* team and a player names a team, so
     getting this backwards reports the wrong result for everyone in a game
     with more than one player per side. */
  assert.equal(outcomeFor(game(), "Qrow"), "won");
  assert.equal(outcomeFor(game(), "Aquanim"), "lost");
});

test("a name matches whatever its case", () => {
  assert.equal(outcomeFor(game(), "qrow"), "won");
});

test("a game nobody won is undecided rather than lost", () => {
  /* The engine writes no winner for a game that crashed or was left, and
     calling that a loss would put a false record in somebody's history. */
  assert.equal(outcomeFor(game({ winners: [] }), "Qrow"), "undecided");
});

test("a game you only watched is neither won nor lost", () => {
  assert.equal(outcomeFor(game(), "watcher"), "watched");
  assert.equal(outcomeFor(game(), "somebody else"), "watched");
});

test("without a name there is no outcome to report", () => {
  assert.equal(outcomeFor(game(), undefined), "undecided");
});

// ------------------------------------------------------------------ sides ---

test("sides group by ally team and leave spectators out", () => {
  const s = sides(game());
  assert.deepEqual(s.map(x => x.ally), [0, 1]);
  assert.deepEqual(s[0].players.map(p => p.name), ["Qrow", "mankarse"]);
});

test("team-mates exclude you, opponents are the other side", () => {
  assert.deepEqual(teammates(game(), "Qrow").map(p => p.name), ["mankarse"]);
  assert.deepEqual(opponents(game(), "Qrow").map(p => p.name), ["Aquanim", "Kadril"]);
});

test("with no name there are no team-mates to name", () => {
  assert.deepEqual(teammates(game(), undefined), []);
  assert.deepEqual(opponents(game(), undefined), []);
});

// ------------------------------------------------------------------ query ---

test("a bare word searches the map, the game and the players", () => {
  assert.equal(searchReplays([game()], "canis").length, 1);
  assert.equal(searchReplays([game()], "aquanim").length, 1);
  assert.equal(searchReplays([game()], "zero-k").length, 1);
  assert.equal(searchReplays([game()], "nothing here").length, 0);
});

test("a clan tag finds the games somebody played", () => {
  assert.equal(searchReplays([game()], "RSN").length, 1);
});

test("a quoted phrase stays one term", () => {
  const terms = parseQuery('map:"Canis River"');
  assert.deepEqual(terms, [{ kind: "map", value: "Canis River" }]);
});

test("with and vs are relative to you, and disagree", () => {
  const g = game();
  assert.equal(searchReplays([g], "with:mankarse", "Qrow").length, 1);
  assert.equal(searchReplays([g], "vs:mankarse", "Qrow").length, 0);
  assert.equal(searchReplays([g], "vs:aquanim", "Qrow").length, 1);
  // The same query from the other side of the same game gives the opposite.
  assert.equal(searchReplays([g], "with:mankarse", "Aquanim").length, 0);
});

test("won and lost are relative to you as well", () => {
  const g = game();
  assert.equal(searchReplays([g], "won", "Qrow").length, 1);
  assert.equal(searchReplays([g], "lost", "Qrow").length, 0);
  assert.equal(searchReplays([g], "lost", "Aquanim").length, 1);
});

test("terms narrow rather than widen", () => {
  const g = game();
  assert.equal(searchReplays([g], "canis won", "Qrow").length, 1);
  assert.equal(searchReplays([g], "canis lost", "Qrow").length, 0);
});

test("a duration term reads its unit", () => {
  assert.deepEqual(parseQuery(">20m"), [{ kind: "longer", value: "20m", number: 1200 }]);
  assert.deepEqual(parseQuery("<90s"), [{ kind: "shorter", value: "90s", number: 90 }]);
  assert.deepEqual(parseQuery(">1h"), [{ kind: "longer", value: "1h", number: 3600 }]);
  // A bare number is minutes, which is the unit anybody means about a match.
  assert.deepEqual(parseQuery(">20"), [{ kind: "longer", value: "20", number: 1200 }]);
});

test("duration filters compare against the match length", () => {
  const g = game({ duration: 30 * 60 });
  assert.equal(searchReplays([g], ">20m").length, 1);
  assert.equal(searchReplays([g], ">40m").length, 0);
  assert.equal(searchReplays([g], "<40m").length, 1);
});

test("a date term bounds the history", () => {
  const g = game();
  assert.equal(searchReplays([g], "after:2026-08-01").length, 1);
  assert.equal(searchReplays([g], "after:2026-09-01").length, 0);
  assert.equal(searchReplays([g], "before:2026-08-21").length, 1);
  assert.equal(searchReplays([g], "before:2026-08-01").length, 0);
});

test("half-typed input narrows instead of erroring", () => {
  /* Somebody on the way to `>20m` passes through `>` and `>2`. None of those
     may throw, and none may empty the list for a reason nobody can see. */
  for (const q of [">", ">2", "map:", "after:2026-", '"']) {
    assert.doesNotThrow(() => searchReplays([game()], q, "Qrow"), q);
  }
  assert.equal(searchReplays([game()], ">").length, 0, "a stray > is text, and matches nothing");
});

test("an empty query keeps everything", () => {
  assert.equal(searchReplays([game()], "").length, 1);
  assert.equal(searchReplays([game()], "   ").length, 1);
});

test("an unknown field is a plain word, not a filter", () => {
  // `elo:2000` is not a term this understands; it must not silently match all.
  assert.deepEqual(parseQuery("elo:2000"), [{ kind: "text", value: "elo:2000" }]);
  assert.equal(searchReplays([game()], "elo:2000").length, 0);
});

test("with and vs match nothing when we do not know who you are", () => {
  /* Not everything: a filter that cannot be evaluated must not quietly become
     a filter that passes. */
  assert.equal(searchReplays([game()], "with:mankarse", undefined).length, 0);
});

// ------------------------------------------------------- sorting and noise ---

test("sorting runs both ways on both keys", () => {
  const old = game({ playedAt: AUG20 - 7 * DAY, duration: 5 * 60 });
  const now = game({ playedAt: AUG20, duration: 40 * 60 });
  assert.deepEqual(sortReplays([old, now], "recent").map(r => r.playedAt), [now.playedAt, old.playedAt]);
  assert.deepEqual(sortReplays([now, old], "oldest").map(r => r.playedAt), [old.playedAt, now.playedAt]);
  assert.deepEqual(sortReplays([old, now], "longest").map(r => r.duration), [2400, 300]);
  assert.deepEqual(sortReplays([now, old], "shortest").map(r => r.duration), [300, 2400]);
});

test("launches that went nowhere are separated, not deleted", () => {
  /* A real folder is full of these - cancelled launches and scenarios opened
     to look at. They should not be the first thing in a match history, and
     throwing them away is not ours to do. */
  const aborted = game({ duration: 3, winners: [] });
  assert.equal(isTrivial(aborted), true);
  assert.equal(isTrivial(game()), false);
  const { real, trivial } = partition([game(), aborted]);
  assert.equal(real.length, 1);
  assert.equal(trivial.length, 1);
});

test("a term is evaluated against one replay at a time", () => {
  // matchesTerm is the seam a screen uses to explain why a row matched.
  const g = game();
  assert.equal(matchesTerm(g, { kind: "map", value: "canis" }, "Qrow"), true);
  assert.equal(matchesTerm(g, { kind: "map", value: "isis" }, "Qrow"), false);
});

// ------------------------------------------------------- shape of the match ---

const solo = (names: string[][]): Replay =>
  game({ players: names.map(([n, a], i) => player(n, Number(a), { elo: 1500 + i * 100 })) });

test("mode is read off the shape of the teams", () => {
  assert.equal(modeOf(solo([["a", "0"], ["b", "1"]])), "1v1");
  assert.equal(modeOf(solo([["a", "0"], ["b", "1"], ["c", "2"]])), "FFA");
  assert.equal(modeOf(game()), "Teams");
});

test("a bot makes it cooperative whatever the shape", () => {
  /* This is the distinction somebody is drawing when they filter for it - not
     "how many sides" but "was this against people". */
  const withAi = game({
    players: [player("Qrow", 0), player("Chicken", 1, { bot: true })],
  });
  assert.equal(modeOf(withAi), "Cooperative");
});

test("spectators change neither the mode nor the count", () => {
  assert.equal(playerCount(game()), 4);
  assert.equal(modeOf(game()), "Teams");
});

test("an unrated game has no average, rather than an average of zero", () => {
  /* A rating column showing 0 says everyone was a beginner, which is a
     different claim from "this game was not rated". */
  const unrated = game({ players: [player("a", 0), player("b", 1)] });
  assert.equal(averageRating(unrated), undefined);
  assert.equal(averageRating(game()), 2623);
});

test("a side is named up to a limit and then counted", () => {
  const many = [player("a", 0), player("b", 0), player("c", 0), player("d", 0), player("e", 0)];
  assert.equal(summariseSide(many), "a, b, c +2");
  assert.equal(summariseSide(many.slice(0, 2)), "a, b");
});

test("your own side is named first when we know which it is", () => {
  const v = versus(game(), "Aquanim");
  assert.ok(v.a.startsWith("Aquanim"), `expected Aquanim first, got ${v.a}`);
  assert.ok(v.b.includes("Qrow"));
  // Without a name the sides keep their own order.
  assert.ok(versus(game()).a.startsWith("Qrow"));
});

test("an FFA names every side rather than dropping the extras", () => {
  /* A six-player free-for-all shown as two names would be a lie about who was
     in the game. */
  const ffa = solo([["a", "0"], ["b", "1"], ["c", "2"], ["d", "3"]]);
  const v = versus(ffa);
  assert.equal(v.a, "a");
  assert.equal(v.b, "b, c, d");
});

test("an engine mismatch is only claimed when we know what is installed", () => {
  assert.equal(engineMismatch(game(), "2025.06.21"), false);
  assert.equal(engineMismatch(game({ engine: "2024.11.09" }), "2025.06.21"), true);
  assert.equal(engineMismatch(game({ engine: "2024.11.09" }), undefined), false);
});

// ------------------------------------------------------------------- rows ---

test("a local row carries its parsed replay, an archive row does not", () => {
  /* This is the whole distinction: the file is here, so everything is known.
     An archive row knows what the list page printed and no more. */
  const local = rowFromReplay(game());
  assert.equal(local.source, "local");
  assert.ok(local.replay);
  assert.equal(local.players, 4);
  assert.equal(local.teams, 2);

  const remote = rowFromArchive({ id: 2498170, map: "Icy Run v2", players: 16, teams: 2, bots: false });
  assert.equal(remote.source, "archive");
  assert.equal(remote.replay, undefined);
  assert.equal(remote.battleId, 2498170);
});

test("the two sources cannot collide on a key", () => {
  const local = rowFromReplay(game());
  const remote = rowFromArchive({ id: 1, bots: false });
  assert.notEqual(local.key, remote.key);
  assert.ok(remote.key.startsWith("zk:"));
});

test("mode is exact for a local row and inferred for an archive one", () => {
  assert.equal(rowMode(rowFromReplay(game())), "Teams");
  assert.equal(rowMode(rowFromArchive({ id: 1, teams: 2, players: 2, bots: false })), "1v1");
  assert.equal(rowMode(rowFromArchive({ id: 2, teams: 6, players: 6, bots: false })), "FFA");
  assert.equal(rowMode(rowFromArchive({ id: 3, teams: 2, players: 16, bots: false })), "Teams");
  assert.equal(rowMode(rowFromArchive({ id: 4, teams: 2, players: 4, bots: true })), "Cooperative");
});

test("a mode that cannot be worked out is absent rather than guessed", () => {
  assert.equal(rowMode(rowFromArchive({ id: 5, bots: false })), undefined);
});

test("a rating needs the replay, so an archive row has none until it is opened", () => {
  /* The design shows a rating column; the list page has no ratings in it. An
     archive row must say nothing rather than invent a number. */
  assert.equal(rowRating(rowFromReplay(game())), 2623);
  assert.equal(rowRating(rowFromArchive({ id: 1, players: 8, bots: false })), undefined);
});
