/**
 * Run with:  node --test src/store/adapters.test.ts
 * (Node strips the types; imports need explicit .ts extensions and this file
 * must not import an enum - see protocol/wire.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type * as T from "../protocol/types.ts";
import { battleList, battleToRow, userToChip, chatLines, shortTime, describeFailure, statusBarKind, describeRegisterFailure, roomModel, syncMark, newsList, newsImage, shortDate } from "./adapters.ts";

const USERS: Record<string, T.User> = {
  hexed: { Name: "hexed", Clan: "ZKF", Country: "US", EffectiveElo: 1790.6, Level: 33 } as T.User,
  afk: { Name: "afk", AwaySince: "2026-08-18T09:00:00Z" } as T.User,
  playing: { Name: "playing", InGameSince: "2026-08-18T09:00:00Z" } as T.User,
  inroom: { Name: "inroom", BattleID: 4 } as T.User,
};

test("presence is derived, because the protocol has no status field", () => {
  assert.equal(userToChip(USERS.hexed, "hexed").presence, "online");
  assert.equal(userToChip(USERS.afk, "afk").presence, "away");
  assert.equal(userToChip(USERS.playing, "playing").presence, "ingame");
  assert.equal(userToChip(USERS.inroom, "inroom").presence, "room");
  assert.equal(userToChip(undefined, "gone").presence, "offline",
    "absent from the directory means not connected");
});

test("an unknown user still renders under their name", () => {
  const chip = userToChip(undefined, "someone");
  assert.equal(chip.name, "someone");
  assert.equal(chip.elo, undefined);
});

test("the rating is tinted by the rank the server sent, not by the rating", () => {
  /* Rank is a percentile standing and Elo is not, so the two disagree - and
     the game tints by rank. hexed is 1790 Elo, which Chobby's Elo fallback
     would call Subgiant; the server says Red Dwarf, and the server is right. */
  assert.equal(userToChip({ ...USERS.hexed, Rank: 2 } as T.User, "hexed").eloTint, "#CC661A");
  assert.equal(userToChip({ ...USERS.hexed, Rank: 2, Icon: "5_6" } as T.User, "hexed").eloTint,
    "#0099FF", "the icon the server picked outranks the rank field, as in Chobby");
  assert.equal(userToChip(USERS.hexed, "hexed").eloTint, "#FFA600",
    "and with neither, the Elo band is still better than no colour at all");
  assert.equal(userToChip(undefined, "gone").eloTint, undefined,
    "nobody we have a record for is not somebody at the bottom");
});

test("a faction the design kit has no mark for gets no mark", () => {
  assert.equal(userToChip({ Faction: "Dynasty" } as T.User, "x").faction, undefined);
  assert.equal(userToChip({ Faction: "Machines" } as T.User, "x").faction, "machines");
});

test("chat lines carry a whole chip, because that is what ChatLine spreads", () => {
  const [line] = chatLines([{ id: 1, user: "hexed", text: "hi", emote: false, ring: false, system: false }], USERS);
  assert.equal(typeof line.user, "object", "a bare name would spread into a chip as characters");
  assert.equal(line.user!.clan, "ZKF");
  assert.equal(line.user!.elo, 1791);
});

test("a system notice has no sender and must not get an empty chip", () => {
  const [line] = chatLines([{ id: 2, text: "x joined", emote: false, ring: false, system: true }], USERS);
  assert.equal(line.user, undefined);
});

test("timestamps render as local HH:MM, or not at all", () => {
  assert.equal(shortTime(undefined), undefined);
  assert.equal(shortTime("nonsense"), undefined);
  assert.match(shortTime("2026-08-18T09:51:00Z")!, /^\d{2}:\d{2}$/);
});

test("the battle list is busiest first", () => {
  const rows = battleList({
    1: { BattleID: 1, PlayerCount: 3 } as T.BattleHeader,
    2: { BattleID: 2, PlayerCount: 12 } as T.BattleHeader,
    3: { BattleID: 3, PlayerCount: 9 } as T.BattleHeader,
  });
  assert.deepEqual(rows.map(r => r.id), [2, 3, 1]);
});

test("spectators count as being in the room", () => {
  /* A 1v1 with a crowd watching is a busier room than a half-empty lobby,
     which is what "where is everybody" is really asking. */
  const rows = battleList({
    1: { BattleID: 1, PlayerCount: 8, SpectatorCount: 0 } as T.BattleHeader,
    2: { BattleID: 2, PlayerCount: 2, SpectatorCount: 12 } as T.BattleHeader,
  });
  assert.deepEqual(rows.map(r => r.id), [2, 1]);
});

test("a tie puts the room you can join first", () => {
  const rows = battleList({
    1: { BattleID: 1, Title: "a", PlayerCount: 4, Password: "x" } as T.BattleHeader,
    2: { BattleID: 2, Title: "b", PlayerCount: 4 } as T.BattleHeader,
  });
  assert.deepEqual(rows.map(r => r.id), [2, 1], "passworded sorts after open");
});

test("and a room tied on both still lands somewhere predictable", () => {
  // Otherwise the order is whatever the server happened to mention them in.
  const rows = battleList({
    7: { BattleID: 7, Title: "zulu", PlayerCount: 4 } as T.BattleHeader,
    9: { BattleID: 9, Title: "alpha", PlayerCount: 4 } as T.BattleHeader,
  });
  assert.deepEqual(rows.map(r => r.id), [9, 7]);
});

test("a running game is no longer pushed to the bottom", () => {
  /* It used to sort below everything. The list has a "Hide running" filter for
     people who do not want them, which is a better tool than a hidden rule. */
  const rows = battleList({
    1: { BattleID: 1, IsRunning: true, PlayerCount: 12 } as T.BattleHeader,
    2: { BattleID: 2, PlayerCount: 3 } as T.BattleHeader,
  });
  assert.deepEqual(rows.map(r => r.id), [1, 2]);
});

test("a locked battle is one with a password", () => {
  const [row] = battleList({ 1: { BattleID: 1, Password: "x" } as T.BattleHeader });
  assert.equal(row.locked, true);
});

test("login failures say what the official client says", () => {
  assert.match(describeFailure({ kind: "rejected", code: 2, message: "" }), /capitalisation/);
  assert.match(describeFailure({ kind: "rejected", code: 4, message: "cheating" }), /^Banned: cheating$/);
  assert.match(describeFailure({ kind: "rejected", code: 9, message: "" }), /server is full/);
  assert.match(describeFailure({ kind: "disconnected", reason: "timeout" }), /timeout/);
});

test("a drop with a retry pending is reconnecting, not offline", () => {
  const dropped = { kind: "disconnected" as const, reason: "reset by peer" };
  assert.equal(statusBarKind(dropped, 0), "offline", "nothing pending is genuinely offline");
  assert.equal(statusBarKind(dropped, 1), "reconnecting", "something is being done about it");
  assert.equal(statusBarKind({ kind: "online" }, 3), "online");
  assert.equal(statusBarKind({ kind: "loggingIn" }), "reconnecting");
});

test("registration failures name the actual problem", () => {
  assert.match(describeRegisterFailure(2), /name is taken/i);
  assert.match(describeRegisterFailure(4, "cheating"), /^Banned: cheating$/);
  assert.match(describeRegisterFailure(11), /log in with your password/i);
  assert.match(describeRegisterFailure(99), /error 99/);
});

/* ------------------------------------------------------------------ sync ---
   Three protocol states, three marks. The one that matters is `Unknown`: it is
   what a client that has never reported looks like, and `!start` treats it as
   unready without it being a claim that anybody lacks the map. */

test("the three sync states get three different marks", () => {
  assert.equal(syncMark(1), "ok");
  assert.equal(syncMark(2), "missing");
  assert.equal(syncMark(0), "downloading", "never reported is not the same as reported missing");
  assert.equal(syncMark(undefined), "downloading", "and neither is a status we were never sent");
});

const ROOM: T.BattleHeader = { BattleID: 5, Title: "t", Founder: "host", MaxPlayers: 8 } as T.BattleHeader;

function room(players: Record<string, Partial<T.UpdateUserBattleStatus>>,
  bots: Record<string, Partial<T.UpdateBotStatus>> = {},
  header: Partial<T.BattleHeader> = {}) {
  return roomModel({ ...ROOM, ...header } as T.BattleHeader,
    players as Record<string, T.UpdateUserBattleStatus>,
    bots as Record<string, T.UpdateBotStatus>, {}, {})!;
}

test("players carry their sync mark into the row", () => {
  const r = room({
    ready: { Name: "ready", AllyNumber: 0, Sync: 1 },
    missing: { Name: "missing", AllyNumber: 0, Sync: 2 },
    quiet: { Name: "quiet", AllyNumber: 0 },
  });
  const marks = Object.fromEntries(r.teams[0].players.map(p => [p.user.name, p.sync]));
  assert.deepEqual(marks, { ready: "ok", missing: "missing", quiet: "downloading" });
});

test("the people in our party are marked as being in it", () => {
  /* This never worked. The marker read `User.PartyID`, which the server
     declares and never serialises, so it was undefined for everybody and the
     row `PlayerRow` draws for it has not once appeared. `OnPartyStatus` is
     where membership actually comes from. */
  const r = roomModel({ ...ROOM } as T.BattleHeader, {
    Qrow: { Name: "Qrow", AllyNumber: 0 },
    hexed: { Name: "hexed", AllyNumber: 0 },
    stranger: { Name: "stranger", AllyNumber: 1 },
  } as Record<string, T.UpdateUserBattleStatus>, {}, {}, {},
  { id: 7, members: ["Qrow", "hexed"] })!;
  const marks = Object.fromEntries(
    [...r.teams[0].players, ...r.teams[1].players].map(p => [p.user.name, p.party]));
  assert.deepEqual(marks, { Qrow: 7, hexed: 7, stranger: undefined });
});

test("with no party, nobody is marked as being in one", () => {
  const r = room({ Qrow: { Name: "Qrow", AllyNumber: 0 } });
  assert.equal(r.teams[0].players[0].party, undefined);
});

test("a bot is always ready, because it has nothing to download", () => {
  const r = room({}, { "CAI (1)": { Name: "CAI (1)", AllyNumber: 0, AiLib: "CAI" } });
  assert.equal(r.teams[0].players[0].sync, "ok");
});

test("a spectator gets no mark, because nobody is waiting for one", () => {
  const r = room({ watcher: { Name: "watcher", IsSpectator: true, Sync: 2 } });
  assert.equal(r.spectators[0].sync, undefined);
  assert.deepEqual(r.waitingOn, [], "and is never named as holding the start up");
});

test("the room names everyone !start would name, and nobody else", () => {
  const r = room({
    ready: { Name: "ready", AllyNumber: 0, Sync: 1 },
    zed: { Name: "zed", AllyNumber: 1, Sync: 2 },
    alice: { Name: "alice", AllyNumber: 1 },
    watcher: { Name: "watcher", IsSpectator: true },
  });
  // CmdStart gathers every non-spectator whose status is not Synced.
  assert.deepEqual(r.waitingOn, ["alice", "zed"]);
});

/* -------------------------------------------------------------- capacity ---
   There is no waitlist in the protocol. A full room silently spectates the
   arrival, so the least a list can do is say which rooms those are. */

test("a room is full when every player slot is taken", () => {
  const row = (PlayerCount: number, MaxPlayers: number) =>
    battleToRow({ BattleID: 1, PlayerCount, MaxPlayers } as T.BattleHeader)!;
  assert.equal(row(7, 8).full, false);
  assert.equal(row(8, 8).full, true);
  assert.equal(row(8, 8).queued, 0);
});

test("a room that never said how big it is cannot be full", () => {
  // Otherwise 0 >= 0 makes every unsized room look shut.
  const row = battleToRow({ BattleID: 1, PlayerCount: 0 } as T.BattleHeader)!;
  assert.equal(row.full, false);
});

test("players past the cap are the time queue, which is the nearest thing to a waitlist", () => {
  /* Only reachable with the server's time queue on: everyone counts as a
     player until `StartGame` spectates whoever claimed a slot last. */
  const row = battleToRow({ BattleID: 1, PlayerCount: 18, MaxPlayers: 16 } as T.BattleHeader)!;
  assert.equal(row.full, true);
  assert.equal(row.queued, 2);
});

test("the room counts its own slots rather than waiting for the server's number", () => {
  /* PlayerCount is re-broadcast on a five-second timer, and the roster beside
     it is instant. Bots take no slot - the server counts them separately. */
  const r = room({
    a: { Name: "a", AllyNumber: 0 },
    b: { Name: "b", AllyNumber: 1 },
    watcher: { Name: "watcher", IsSpectator: true },
  }, { "CAI (1)": { Name: "CAI (1)", AllyNumber: 1 } }, { MaxPlayers: 2, PlayerCount: 99 });
  assert.equal(r.players, 2);
  assert.equal(r.maxPlayers, 2);
  assert.equal(r.full, true);
  assert.equal(r.queued, 0);
});

/* ----------------------------------------------------------- ally teams ---
   The cap is ZkLobbyServer's `ScriptGenerator.MaxAllies`, not the engine's
   team limit. Sixteen ALLYTEAM blocks get written, numbered 0 to 15, and a
   player above that produces a script the engine refuses outright. */

test("teams are contiguous, so a gap between occupied allies is joinable", () => {
  /* Ally 1 is empty between an occupied 0 and 2. That is a team somebody can
     take, not a hole to skip - which is what a sparse list made it. */
  const r = room({ a: { Name: "a", AllyNumber: 0 }, b: { Name: "b", AllyNumber: 2 } });
  assert.deepEqual(r.teams.map(t => t.ally), [0, 1, 2]);
});

test("a room never shows fewer than two teams, or a 1v1 cannot be set up", () => {
  const r = room({ a: { Name: "a", AllyNumber: 0 } });
  assert.deepEqual(r.teams.map(t => t.ally), [0, 1]);
});

/* Issue #13: a player clicked "Join team 2" in an FFA room and nothing
   happened. `ServerBattle.ValidateBattleStatus` is the reason, and it runs on
   every battle status the server accepts:

       if (Mode != AutohostMode.None) ubs.AllyNumber = 0;

   So only a Custom room lets anyone choose a side. The room has to know that,
   or the screen keeps offering a button the server undoes. */
test("only a custom room lets a player choose their own side", () => {
  const custom = room({ a: { Name: "a", AllyNumber: 0 } }, {}, { Mode: 0 });
  assert.equal(custom.picksTeams, true, "Custom is AutohostMode.None");

  // Every mode the server overwrites: 1v1, FFA, Chickens, Teams, Planetwars.
  for (const mode of [3, 4, 5, 6, 2]) {
    const r = room({ a: { Name: "a", AllyNumber: 0 } }, {}, { Mode: mode });
    assert.equal(r.picksTeams, false, `mode ${mode} is decided by the host`);
  }
});

test("a room with no mode at all is treated as custom", () => {
  // MODE_NONE is the fallback modeLabel already uses for an absent Mode.
  assert.equal(room({ a: { Name: "a", AllyNumber: 0 } }).picksTeams, true);
});

test("teams stop at the sixteen the script generator declares", () => {
  /* `!balance N` is bounded only by the player count, so a room really can
     report ally 19. Ally 16 is Gaia in a running game and joins nothing. */
  const r = room({ a: { Name: "a", AllyNumber: 19 } });
  assert.equal(r.teams.length, 16);
  assert.equal(r.teams[r.teams.length - 1].ally, 15, "no column the engine would reject");
});

test("a team holds the room's own share of its cap, not a hardcoded eight", () => {
  // Sixteen players over two teams is eight a side; over sixteen it is one.
  assert.equal(room({ a: { Name: "a", AllyNumber: 1 } }, {}, { MaxPlayers: 16 }).teamSize, 8);
  assert.equal(room({ a: { Name: "a", AllyNumber: 15 } }, {}, { MaxPlayers: 16 }).teamSize, 1);
});

test("a room that never said its cap falls back rather than showing nothing", () => {
  assert.equal(room({ a: { Name: "a", AllyNumber: 0 } }, {}, { MaxPlayers: 0 }).teamSize, 8);
});

test("a team already fuller than its share reports what it actually holds", () => {
  /* Allyteams need not be balanced. A column of ten cannot claim to hold
     eight, or the last two players render outside their own capacity. */
  const r = room({
    a: { Name: "a", AllyNumber: 0 }, b: { Name: "b", AllyNumber: 0 },
    c: { Name: "c", AllyNumber: 0 }, d: { Name: "d", AllyNumber: 1 },
  }, {}, { MaxPlayers: 4 });
  assert.equal(r.teamSize, 3);
});

/* --------------------------------------------------- who is waiting -------
   `QueueOrder` is a serialized field of `UpdateUserBattleStatus`, so the
   ordering the server sorts by is on the wire per person. `ValidateBattleStatus`
   stamps a positive one on anyone who entered wanting to play - including
   somebody it then flips to spectator - and -1 on anyone who arrived
   spectating. That difference is what names a waitlist. */

const names = (r: ReturnType<typeof room>) =>
  (r.waitingToPlay?.players ?? []).map(p => p.user.name);

test("nobody is waiting in a room with room to spare", () => {
  const r = room({ a: { Name: "a", AllyNumber: 0, QueueOrder: 1 } }, {}, { MaxPlayers: 8 });
  assert.equal(r.waitingToPlay, null);
});

test("a spectator who asked to play is named, and one who chose it is not", () => {
  /* The forced spectator falls through to the QueueOrder stamp; the voluntary
     one takes the `else` and is set to -1. Same IsSpectator, different reason. */
  const r = room({
    playing: { Name: "playing", AllyNumber: 0, QueueOrder: 1 },
    turnedAway: { Name: "turnedAway", IsSpectator: true, QueueOrder: 4 },
    watching: { Name: "watching", IsSpectator: true, QueueOrder: -1 },
  }, {}, { MaxPlayers: 1 });
  assert.deepEqual(names(r), ["turnedAway"]);
  assert.equal(r.waitingToPlay?.kind, "refused");
});

test("someone named as waiting is not also listed as a spectator", () => {
  const r = room({
    turnedAway: { Name: "turnedAway", IsSpectator: true, QueueOrder: 4 },
    watching: { Name: "watching", IsSpectator: true, QueueOrder: -1 },
  }, {}, { MaxPlayers: 1 });
  assert.deepEqual(r.spectators.map(s => s.user.name), ["watching"]);
});

test("a spectator we were sent no QueueOrder for is not accused of waiting", () => {
  // Absent is not the same as positive, and guessing here invents a queue.
  const r = room({ quiet: { Name: "quiet", IsSpectator: true } }, {}, { MaxPlayers: 1 });
  assert.equal(r.waitingToPlay, null);
});

test("the waiting are ordered the way the server will cut them", () => {
  const r = room({
    late: { Name: "late", IsSpectator: true, QueueOrder: 9 },
    early: { Name: "early", IsSpectator: true, QueueOrder: 2 },
    middle: { Name: "middle", IsSpectator: true, QueueOrder: 5 },
  }, {}, { MaxPlayers: 1 });
  assert.deepEqual(names(r), ["early", "middle", "late"]);
});

/* With the time queue on, nobody is refused on the way in. Everyone stays a
   player and `StartGame` spectates the overflow by QueueOrder, so the exact
   set is computable rather than merely countable. */

test("a time queue names exactly who StartGame would cut", () => {
  const r = room({
    a: { Name: "a", AllyNumber: 0, QueueOrder: 1 },
    b: { Name: "b", AllyNumber: 1, QueueOrder: 2 },
    c: { Name: "c", AllyNumber: 0, QueueOrder: 7 },
    d: { Name: "d", AllyNumber: 1, QueueOrder: 9 },
  }, {}, { MaxPlayers: 2, TimeQueueEnabled: true });
  assert.deepEqual(names(r), ["c", "d"]);
  assert.equal(r.waitingToPlay?.kind, "queue");
});

test("the time queue cut counts a returning player's penalty, as the server does", () => {
  /* `PrevBattleQueueOffset` is +100000 for whoever just played, which pushes
     them behind everyone who has been waiting. Sorting numerically is the
     whole of it - but only if we sort by QueueOrder and not by arrival. */
  const r = room({
    justPlayed: { Name: "justPlayed", AllyNumber: 0, QueueOrder: 100001 },
    waited: { Name: "waited", AllyNumber: 1, QueueOrder: 3 },
  }, {}, { MaxPlayers: 1, TimeQueueEnabled: true });
  assert.deepEqual(names(r), ["justPlayed"]);
});

test("a time queue drops to an even number of players under MaxEvenPlayers", () => {
  /* allowedPlayers = count & ~1 when the count is at or under MaxEvenPlayers:
     an odd game is worse than a smaller one, so the last player sits out. */
  const r = room({
    a: { Name: "a", AllyNumber: 0, QueueOrder: 1 },
    b: { Name: "b", AllyNumber: 1, QueueOrder: 2 },
    c: { Name: "c", AllyNumber: 0, QueueOrder: 3 },
  }, {}, { MaxPlayers: 16, TimeQueueEnabled: true, MaxEvenPlayers: 4 });
  assert.deepEqual(names(r), ["c"]);
});

test("a time queue room that never said its cap claims nobody is waiting", () => {
  /* Without MaxPlayers the skip count is zero, which would name the entire
     room. Saying nothing is the only honest answer to a number we lack. */
  const r = room({
    a: { Name: "a", AllyNumber: 0, QueueOrder: 1 },
    b: { Name: "b", AllyNumber: 1, QueueOrder: 2 },
  }, {}, { MaxPlayers: 0, TimeQueueEnabled: true });
  assert.equal(r.waitingToPlay, null);
});

test("a time queue ignores spectators, who are not in the running anyway", () => {
  const r = room({
    a: { Name: "a", AllyNumber: 0, QueueOrder: 1 },
    b: { Name: "b", AllyNumber: 1, QueueOrder: 2 },
    watching: { Name: "watching", IsSpectator: true, QueueOrder: -1 },
  }, {}, { MaxPlayers: 2, TimeQueueEnabled: true });
  assert.equal(r.waitingToPlay, null);
});

/* --------------------------------------------------------------- news --- */

test("an item with no picture does not get one, even though the field is there", () => {
  /* The server writes `$"{BaseSiteUrl}{x.ImageRelativeUrl}"` and the relative
     part is null when the row has no image, so "no picture" arrives as the bare
     site URL rather than as an absent field. Drawn as an <img> that is a
     request for the front page and a broken picture in the strip. */
  assert.equal(newsImage("http://zero-k.info"), undefined);
  assert.equal(newsImage("http://zero-k.info/"), undefined);
  assert.equal(newsImage(undefined), undefined);
});

test("a news picture is asked for over TLS, because the CSP allows nothing else", () => {
  /* GlobalConst hands out http://zero-k.info in live mode; tauri.conf.json
     allows `img-src https://zero-k.info`. Upgrading here beats widening that. */
  assert.equal(newsImage("http://zero-k.info/img/lobbynews/1.png"),
    "https://zero-k.info/img/lobbynews/1.png");
  assert.equal(newsImage("https://zero-k.info/img/lobbynews/1.png"),
    "https://zero-k.info/img/lobbynews/1.png");
});

test("something that is not a web address is not a picture", () => {
  assert.equal(newsImage("javascript:alert(1)"), undefined);
  assert.equal(newsImage("/img/lobbynews/1.png"), undefined, "relative to what?");
  assert.equal(newsImage("not a url at all"), undefined);
});

test("a news stamp says the year only when it is not this one", () => {
  /* Local-time inputs on purpose. The stamp is rendered in local time, as chat
     timestamps are, so an instant written in UTC falls on a different date
     depending on where the test runs - hence the shape check for that one. */
  const now = new Date(2026, 7, 21);
  assert.equal(shortDate("2026-08-19T18:30:00", now), "19 Aug");
  assert.equal(shortDate("2019-12-03T09:00:00", now), "3 Dec 2019",
    "a pinned item stays pinned, so the top of the list is routinely the oldest");
  assert.match(shortDate("2026-08-19T18:30:00Z", now)!, /^\d{1,2} [A-Z][a-z]{2}$/);
  assert.equal(shortDate(undefined, now), undefined, "Time is nullable upstream");
  assert.equal(shortDate("whenever", now), undefined);
});

test("a news item with only a headline still renders", () => {
  /* NullValueHandling.Ignore means absent, not empty - an announcement with no
     link, no picture and no body arrives as a single field. */
  assert.deepEqual(newsList([{ Header: "Map contest results are up" }]), [
    { header: "Map contest results are up", text: undefined, when: undefined,
      url: undefined, image: undefined },
  ]);
});

test("a news item with nothing to draw is dropped rather than left as a gap", () => {
  assert.deepEqual(newsList([{ Url: "https://zero-k.info", Time: "2026-08-19T18:30:00Z" }]), []);
  assert.deepEqual(newsList(undefined), []);
});

/* Issue #14. In a time-queue room a person over the cap is still a player -
   IsSpectator is false and they hold an ally slot - and is simultaneously in
   the set StartGame will cut. Both are true, and the room used to state them
   in two places with nothing tying them together, so people read the team
   column and believed they were in. */
test("a queued player is marked in the team column they are sitting in", () => {
  const r = room({
    a: { Name: "a", AllyNumber: 0, QueueOrder: 1 },
    b: { Name: "b", AllyNumber: 1, QueueOrder: 2 },
    c: { Name: "c", AllyNumber: 0, QueueOrder: 3 },
  }, {}, { MaxPlayers: 2, MaxEvenPlayers: 0, TimeQueueEnabled: true });

  assert.deepEqual(names(r), ["c"], "c is the one over the cap");
  const seated = r.teams.flatMap(t => t.players);
  const c = seated.find(p => p.user.name === "c");
  assert.ok(c, "c still holds a slot, because the server has not cut them yet");
  assert.equal(c.waiting, true, "and the column says so");
  // Nobody under the cap is marked, or the flag means nothing.
  for (const name of ["a", "b"]) {
    assert.equal(seated.find(p => p.user.name === name)!.waiting, undefined, name);
  }
});

/* The other half of #14: once the server actually seats them, the mark has to
   go. It is derived per update rather than stored, so this is the check that
   it is derived from the right thing. */
test("and the mark clears when the room makes room for them", () => {
  const full = room({
    a: { Name: "a", AllyNumber: 0, QueueOrder: 1 },
    c: { Name: "c", AllyNumber: 0, QueueOrder: 3 },
  }, {}, { MaxPlayers: 1, MaxEvenPlayers: 0, TimeQueueEnabled: true });
  assert.deepEqual(names(full), ["c"]);

  // Same people, a cap that now fits them.
  const roomier = room({
    a: { Name: "a", AllyNumber: 0, QueueOrder: 1 },
    c: { Name: "c", AllyNumber: 0, QueueOrder: 3 },
  }, {}, { MaxPlayers: 4, MaxEvenPlayers: 0, TimeQueueEnabled: true });
  assert.equal(roomier.waitingToPlay, null, "nobody is over the cap now");
  const c = roomier.teams.flatMap(t => t.players).find(p => p.user.name === "c");
  assert.equal(c!.waiting, undefined, "so nothing is left marked");
});

/* A refused player is a spectator, so the mark would be wrong: they hold no
   slot to qualify. They are kept out of the spectator list instead, which is
   covered above. */
test("a refused player carries no queue mark, because they hold no seat", () => {
  const r = room({
    a: { Name: "a", AllyNumber: 0 },
    late: { Name: "late", IsSpectator: true, QueueOrder: 7 },
  });
  assert.equal(r.waitingToPlay?.kind, "refused");
  assert.ok(!r.teams.flatMap(t => t.players).some(p => p.user.name === "late"));
  assert.equal(r.waitingToPlay!.players[0].waiting, undefined);
});
