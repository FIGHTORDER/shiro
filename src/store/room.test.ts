/**
 * Run with:  node --test src/store/room.test.ts
 * (Node strips the types; imports need explicit .ts extensions and this file
 * must not import an enum - see protocol/wire.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { useRoom, freeBotName, SYNC_UNKNOWN, SYNC_SYNCED, SYNC_UNSYNCED } from "./room.ts";

import { roomModel } from "./adapters.ts";

function msg<K extends string>(cmd: K, data: unknown): Message {
  return { cmd, data } as unknown as Message;
}

/* The room store learns our name from LoginResponse, exactly as it does in the
   app. Tests need it because `UpdateUserBattleStatus` carries a Name, and the
   server throws ArgumentNullException on a null one rather than defaulting it
   to the sender. */
const LOGGED_IN = msg("LoginResponse", { ResultCode: 0, Name: "Qrow" });

function fresh() {
  useRoom.getState().reset();
  useRoom.getState().applyMessage(LOGGED_IN);
  return useRoom.getState();
}

const JOINED = msg("JoinBattleSuccess", {
  BattleID: 7,
  // One real modoption and one the table knows nothing about.
  Options: { noelo: "1", commshare: "1" },
  Players: [
    { Name: "Qrow", AllyNumber: 0 },
    { Name: "hexed", AllyNumber: 1 },
    { Name: "watcher", IsSpectator: true },
  ],
  Bots: [{ Name: "CAI-Brutal", AllyNumber: 1, AiLib: "CAI", Owner: "Qrow" }],
});

test("JoinBattleSuccess is a snapshot and replaces the previous room", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("JoinBattleSuccess", {
    BattleID: 9,
    Players: [{ Name: "someone", AllyNumber: 0 }],
  }));
  const s = useRoom.getState();
  assert.equal(s.battleID, 9);
  assert.deepEqual(Object.keys(s.players), ["someone"]);
  assert.deepEqual(s.bots, {});
  assert.deepEqual(s.modOptions, {});
});

test("a new room starts with the sync state unknown, not the last room's", () => {
  /* `reportSync` sends nothing when the value has not changed, so a `Synced`
     carried over from the previous room means the new room never hears one.
     The server keeps that player at Unknown, and `!start` then announces them
     as still downloading the map - every game, for the life of the room.

     It bites on an ordinary path: joining a battle from the list while already
     in one, or being moved by ForceJoinBattle. Leaving first was fine, because
     that resets everything. */
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().reportSync(true);
  assert.equal(useRoom.getState().sync, SYNC_SYNCED);

  useRoom.getState().applyMessage(msg("JoinBattleSuccess", {
    BattleID: 9,
    Players: [{ Name: "Qrow", AllyNumber: 0 }],
  }));
  assert.equal(useRoom.getState().sync, SYNC_UNKNOWN,
    "the new room inherited the last room's sync state");

  useRoom.getState().reportSync(true);
  assert.equal(useRoom.getState().sync, SYNC_SYNCED,
    "and so the new room could never be told we have the map");
});

test("a battle status patch merges rather than replaces", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  // Moving team must not wipe the spectator flag we already know about.
  useRoom.getState().applyMessage(msg("UpdateUserBattleStatus", { Name: "watcher", AllyNumber: 1 }));
  const w = useRoom.getState().players["watcher"];
  assert.equal(w.AllyNumber, 1);
  assert.equal(w.IsSpectator, true, "an omitted field means unchanged");
});

test("status updates outside a room are ignored", () => {
  fresh();
  useRoom.getState().applyMessage(msg("UpdateUserBattleStatus", { Name: "stray", AllyNumber: 0 }));
  assert.deepEqual(useRoom.getState().players, {});
});

test("bots can be added and removed", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("UpdateBotStatus", { Name: "CAI-Brutal", AllyNumber: 0 }));
  assert.equal(useRoom.getState().bots["CAI-Brutal"].AllyNumber, 0);
  assert.equal(useRoom.getState().bots["CAI-Brutal"].AiLib, "CAI", "merged, not replaced");
  useRoom.getState().applyMessage(msg("RemoveBot", { Name: "CAI-Brutal" }));
  assert.deepEqual(useRoom.getState().bots, {});
});

test("the room closing under us empties the room", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("BattleRemoved", { BattleID: 7 }));
  assert.equal(useRoom.getState().battleID, undefined);
});

test("someone else being removed leaves us where we are", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("BattleRemoved", { BattleID: 8 }));
  assert.equal(useRoom.getState().battleID, 7);
});

test("a kick aimed at another player is not a kick", () => {
  fresh();
  useRoom.getState().setMe("Qrow");
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("KickFromBattle", { BattleID: 7, Name: "hexed" }));
  assert.equal(useRoom.getState().battleID, 7);
  useRoom.getState().applyMessage(msg("KickFromBattle", { BattleID: 7, Name: "Qrow" }));
  assert.equal(useRoom.getState().battleID, undefined);
  assert.equal(useRoom.getState().me, "Qrow", "a kick is not a logout");
});

test("mod options are replaced wholesale, because SetModOptions is a snapshot", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("SetModOptions", { Options: { deathmode: "allunits" } }));
  assert.deepEqual(useRoom.getState().modOptions, { deathmode: "allunits" });
});

/* There is no "left the battle" message: the server re-broadcasts the leaver's
   User record with BattleID cleared, and that echo is the only notification. */
test("a User update with a different battle drops them from the roster", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  assert.ok(useRoom.getState().players.hexed, "precondition: hexed is in the room");
  useRoom.getState().applyMessage(msg("User", { Name: "hexed", BattleID: undefined }));
  assert.equal(useRoom.getState().players.hexed, undefined, "left the battle");
  assert.ok(useRoom.getState().players.Qrow, "and nobody else moved");
});

test("a full disconnect drops them too", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("UserDisconnected", { Name: "hexed" }));
  assert.equal(useRoom.getState().players.hexed, undefined);
});

/* The trap this fell into first time. A standing filter that compared the
   roster against the directory dropped everyone, because a User record with no
   BattleID yet - it predates the join, or arrived in the login flood - looks
   exactly like one who left. Only an update about someone already on the
   roster may remove them. */
test("a User update that still names this battle keeps them", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("User", { Name: "hexed", BattleID: 7 }));
  assert.ok(useRoom.getState().players.hexed, "still here");
});

test("a User update about someone not in the room changes nothing", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  const before = Object.keys(useRoom.getState().players).sort();
  useRoom.getState().applyMessage(msg("User", { Name: "a-stranger", BattleID: 99 }));
  assert.deepEqual(Object.keys(useRoom.getState().players).sort(), before);
});

// ------------------------------------------------------------------ view ---

const HEADER: T.BattleHeader = {
  BattleID: 7,
  Title: "Teams 8v8",
  Map: "Comet Catcher Redux",
  Founder: "Qrow",
  IsRunning: false,
} as T.BattleHeader;

const USERS: Record<string, T.User> = {
  Qrow: { Name: "Qrow", Clan: "ZKF", Country: "GB", EffectiveElo: 1842.4, Level: 41 } as T.User,
  hexed: { Name: "hexed", Country: "US", EffectiveElo: 1790, Level: 33, AwaySince: "2026-08-18T10:00:00Z" } as T.User,
  watcher: { Name: "watcher" } as T.User,
};

test("the room view splits players, spectators and bots into columns", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  const s = useRoom.getState();
  const room = roomModel(HEADER, s.players, s.bots, USERS, s.modOptions)!;

  assert.equal(room.map, "Comet Catcher Redux", "display keeps the spaces");
  assert.deepEqual(room.teams.map(t => t.ally), [0, 1]);
  assert.deepEqual(room.teams[0].players.map(p => p.user.name), ["Qrow"]);
  assert.deepEqual(room.teams[1].players.map(p => p.user.name).sort(), ["CAI-Brutal", "hexed"]);
  assert.deepEqual(room.spectators.map(p => p.user.name), ["watcher"]);
  assert.equal(room.teams[0].players[0].host, true, "the founder is marked");
});

test("the view enriches players from the user directory", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  const s = useRoom.getState();
  const room = roomModel(HEADER, s.players, s.bots, USERS, s.modOptions)!;
  const qrow = room.teams[0].players[0].user;
  assert.equal(qrow.clan, "ZKF");
  assert.equal(qrow.elo, 1842, "elo is rounded for display");
  const hexed = room.teams[1].players.find(p => p.user.name === "hexed")!.user;
  assert.equal(hexed.presence, "away");
  const bot = room.teams[1].players.find(p => p.user.name === "CAI-Brutal")!.user;
  assert.equal(bot.bot, true);
  assert.equal(bot.elo, undefined, "a bot has no account to enrich from");
});

test("a gap between ally numbers is teams you can join, not a hole", () => {
  /* This used to assert [0, 3] - the allies actually occupied. That made a
     joinable team one somebody was already on: the columns between were never
     drawn, so there was no way to move into them. */
  fresh();
  useRoom.getState().applyMessage(msg("JoinBattleSuccess", {
    BattleID: 7,
    Players: [{ Name: "a", AllyNumber: 0 }, { Name: "b", AllyNumber: 3 }],
  }));
  const s = useRoom.getState();
  const room = roomModel(HEADER, s.players, s.bots, {}, {})!;
  assert.deepEqual(room.teams.map(t => t.ally), [0, 1, 2, 3]);
  assert.deepEqual(room.teams[1].players, [], "an empty team is still a column");
});

test("a room always offers a second team to join", () => {
  /* The reported failure: a fresh room drew one column, so there was nowhere to
     put a second side and hosting a 1v1 was impossible from this screen.
     `!balance 2` looked broken for the same reason - with everyone still on
     ally 0 there was only ever one column to show. */
  fresh();
  useRoom.getState().applyMessage(msg("JoinBattleSuccess", {
    BattleID: 7,
    Players: [{ Name: "a", AllyNumber: 0 }],
  }));
  const s = useRoom.getState();
  const room = roomModel(HEADER, s.players, s.bots, {}, {})!;
  assert.deepEqual(room.teams.map(t => t.ally), [0, 1]);
});

test("options are shown by name, and a key we do not know is still shown", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  const s = useRoom.getState();
  const room = roomModel(HEADER, s.players, s.bots, USERS, s.modOptions)!;

  // Known options come first, by their upstream name rather than their key.
  assert.deepEqual(room.options.map(o => [o.label, o.value, o.known]), [
    ["No Elo", "1", true],
    ["commshare", "1", false],
  ]);
});

test("an option left at its default is not worth listing", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("SetModOptions", { Options: { noelo: "0" } }));
  const s = useRoom.getState();
  const room = roomModel(HEADER, s.players, s.bots, USERS, s.modOptions)!;
  assert.deepEqual(room.options, [], "noelo defaults to off");
});

// ------------------------------------------------------------------ sync ---

test("we start out having told the room nothing about the map", () => {
  fresh();
  assert.equal(useRoom.getState().sync, SYNC_UNKNOWN);
});

test("reporting sync outside a room says nothing", () => {
  fresh();
  useRoom.getState().reportSync(true);
  assert.equal(useRoom.getState().sync, SYNC_UNKNOWN);
});

test("having the content is Synced, missing it is Unsynced", () => {
  /* Not cosmetic: CmdStart names everyone who is not Synced as "still
     downloading the map" and delays the start ten seconds. Unknown counts. */
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().reportSync(true);
  assert.equal(useRoom.getState().sync, SYNC_SYNCED);
  useRoom.getState().reportSync(false);
  assert.equal(useRoom.getState().sync, SYNC_UNSYNCED);
});

test("without a name there is nothing safe to report", () => {
  /* `UpdateUserBattleStatus` carries a Name, and the server looks it up in a
     dictionary before doing anything else - an omitted one is not "the sender",
     it is an ArgumentNullException in the host's log. Seen for real:
       error processing line UpdateUserBattleStatus {"Sync":2}
       System.ArgumentNullException: Value cannot be null. Parameter name: key
     The wire form is asserted in the e2e suite, which can see what was sent. */
  useRoom.getState().reset();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().reportSync(true);
  assert.equal(useRoom.getState().sync, SYNC_UNKNOWN,
    "reported a sync status before knowing who we are");
});

test("leaving forgets what we told the room, so a rejoin says it again", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().reportSync(true);
  useRoom.getState().leave();
  assert.equal(useRoom.getState().sync, SYNC_UNKNOWN,
    "a new room has not been told anything yet");
});

// ------------------------------------------------------------------ bots ---

test("a bot is named by us, because the server will not name it", () => {
  /* UpdateBotStatus without a Name reached the server as a null dictionary
     key: "error processing line UpdateBotStatus ... ArgumentNullException:
     Parameter name: key". Nothing was added, and the room saw no error. */
  assert.equal(freeBotName("CAI", {}), "CAI (1)");
});

test("and the name steps past the bots already in the room", () => {
  const bots = { "CAI (1)": {}, "CAI (2)": {}, "Circuit (1)": {} };
  assert.equal(freeBotName("CAI", bots), "CAI (3)");
  assert.equal(freeBotName("Circuit", bots), "Circuit (2)");
});

test("no header means no room, rather than a half-rendered one", () => {
  assert.equal(roomModel(undefined, {}, {}, {}, {}), null);
});

// ----------------------------------------------------------------- polls ---

test("a poll is replaced on every vote, not merged", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("BattlePoll", {
    Topic: "Change map?", VotesToWin: 3, YesNoVote: true, MapSelection: false, NotifyPoll: true,
    Options: [{ Id: 1, Name: "yes", Votes: 1 }],
  }));
  useRoom.getState().applyMessage(msg("BattlePoll", {
    Topic: "Change map?", VotesToWin: 3, YesNoVote: true, MapSelection: false, NotifyPoll: true,
    Options: [{ Id: 1, Name: "yes", Votes: 2 }],
  }));
  assert.equal(useRoom.getState().poll!.Options![0].Votes, 2);
});

test("an outcome closes the poll and stays until the next one", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("BattlePoll", {
    Topic: "Change map?", VotesToWin: 3, YesNoVote: true, MapSelection: false, NotifyPoll: true,
  }));
  useRoom.getState().applyMessage(msg("BattlePollOutcome", {
    Topic: "Change map?", Message: "Map changed", Success: true, YesNoVote: true, MapSelection: false,
  }));
  assert.equal(useRoom.getState().poll, undefined);
  assert.equal(useRoom.getState().pollOutcome!.Message, "Map changed");

  useRoom.getState().applyMessage(msg("BattlePoll", {
    Topic: "Kick someone?", VotesToWin: 3, YesNoVote: true, MapSelection: false, NotifyPoll: true,
  }));
  assert.equal(useRoom.getState().pollOutcome, undefined, "a new vote clears the old result");
});

test("joining a different room drops the previous room's vote", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("BattlePoll", {
    Topic: "Change map?", VotesToWin: 3, YesNoVote: true, MapSelection: false, NotifyPoll: true,
  }));
  useRoom.getState().applyMessage(msg("JoinBattleSuccess", { BattleID: 9, Players: [] }));
  assert.equal(useRoom.getState().poll, undefined);
});

test("a join asked to spectate defers the status until the room exists", () => {
  fresh();
  useRoom.getState().setMe("Qrow");
  useRoom.getState().join(7, undefined, true);
  assert.equal(useRoom.getState().pendingSpectate, true,
    "the status cannot be set before the server has put us in the room");
  useRoom.getState().applyMessage(JOINED);
  assert.equal(useRoom.getState().pendingSpectate, false, "and is spent on arrival");
});

test("an ordinary join does not silently spectate", () => {
  fresh();
  useRoom.getState().setMe("Qrow");
  useRoom.getState().join(7);
  assert.equal(useRoom.getState().pendingSpectate, false);
});

test("a forced join is acted on, and only when it names us", () => {
  fresh();
  useRoom.getState().setMe("Qrow");
  useRoom.getState().applyMessage(JOINED);
  // Someone else being moved is not our business.
  useRoom.getState().applyMessage(msg("ForceJoinBattle", { BattleID: 42, Name: "hexed" }));
  assert.equal(useRoom.getState().battleID, 7, "we stay where we are");
  // Ours clears any pending spectate request from an earlier join.
  useRoom.getState().join(99, undefined, true);
  useRoom.getState().applyMessage(msg("ForceJoinBattle", { BattleID: 42, Name: "Qrow" }));
  assert.equal(useRoom.getState().pendingSpectate, false);
});
