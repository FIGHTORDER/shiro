/**
 * Run with:  node --test src/store/history.test.ts
 * (Node strips the types; imports need explicit .ts extensions and this file
 * must not import an enum, which is a runtime construct type-stripping cannot
 * handle - see protocol/wire.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { useHistory, buildDebriefView, readAwards, MAX_RECORDS } from "./history.ts";

type DUser = T.BattleDebriefing_DebriefingUser;

/** A fully populated player, so tests only state what they care about. */
function player(over: Partial<DUser> = {}): DUser {
  return {
    AccountID: 1,
    AllyNumber: 0,
    Awards: [],
    EloChange: 0,
    IsInVictoryTeam: false,
    IsLevelUp: false,
    IsRankup: false,
    IsRankdown: false,
    NewElo: 1500,
    NextRankElo: 1600,
    PrevRankElo: 1400,
    NewRank: 3,
    LoseTime: 0,
    XpChange: 0,
    NewXp: 1000,
    NextLevelXp: 2000,
    PrevLevelXp: 500,
    ...over,
  };
}

function debriefing(id: number, users: Record<string, DUser>, over: Partial<T.BattleDebriefing> = {}): Message {
  return {
    cmd: "BattleDebriefing",
    data: { ServerBattleID: id, DebriefingUsers: users, ...over },
  };
}

function apply(...ms: Message[]): void {
  useHistory.getState().applyBatch(ms);
}

function fresh(): void {
  useHistory.getState().reset();
}

// --- accumulation ----------------------------------------------------------

test("debriefings accumulate newest first", () => {
  fresh();
  apply(debriefing(1, { a: player() }), debriefing(2, { a: player() }));
  const { records } = useHistory.getState();
  assert.deepEqual(records.map(r => r.serverBattleId), [2, 1]);
});

test("the list is capped and drops the oldest", () => {
  fresh();
  const many: Message[] = [];
  for (let i = 1; i <= MAX_RECORDS + 5; i++) many.push(debriefing(i, { a: player() }));
  apply(...many);
  const { records } = useHistory.getState();
  assert.equal(records.length, MAX_RECORDS);
  assert.equal(records[0].serverBattleId, MAX_RECORDS + 5);
  assert.equal(records[records.length - 1].serverBattleId, 6);
});

test("a repeated debriefing patches the record rather than replacing it", () => {
  fresh();
  apply(debriefing(7, { alice: player({ NewElo: 1500 }) }, { Url: "https://zero-k.info/Battles/Detail/7", RatingCategory: "Casual" }));
  // NullValueHandling.Ignore: the follow-up carries only what changed.
  apply({ cmd: "BattleDebriefing", data: { ServerBattleID: 7, Message: "Match finished" } });

  const { records } = useHistory.getState();
  assert.equal(records.length, 1);
  assert.equal(records[0].data.Url, "https://zero-k.info/Battles/Detail/7");
  assert.equal(records[0].data.RatingCategory, "Casual");
  assert.equal(records[0].data.Message, "Match finished");
  assert.equal(records[0].data.DebriefingUsers?.alice.NewElo, 1500);
});

test("a per-player patch merges into the existing player, keeping omitted fields", () => {
  fresh();
  apply(debriefing(8, { alice: player({ NewElo: 1500, EloChange: 12 }), bob: player() }));
  apply(debriefing(8, { alice: { EloChange: 18 } as DUser }));

  const alice = useHistory.getState().records[0].data.DebriefingUsers?.alice;
  assert.equal(alice?.EloChange, 18);
  assert.equal(alice?.NewElo, 1500, "an omitted field must survive the patch");
  assert.ok(useHistory.getState().records[0].data.DebriefingUsers?.bob, "other players must survive");
});

// --- selection -------------------------------------------------------------

test("viewing the newest follows new arrivals; viewing an older one does not move", () => {
  fresh();
  apply(debriefing(1, { a: player() }));
  apply(debriefing(2, { a: player() }));
  assert.equal(useHistory.getState().index, 0);
  assert.equal(useHistory.getState().records[0].serverBattleId, 2);

  useHistory.getState().older();
  assert.equal(useHistory.getState().records[useHistory.getState().index].serverBattleId, 1);

  apply(debriefing(3, { a: player() }));
  const s = useHistory.getState();
  assert.equal(s.records[s.index].serverBattleId, 1, "the match being read must stay on screen");

  s.newer();
  s.newer();
  assert.equal(useHistory.getState().index, 0);
});

test("select clamps to the available range", () => {
  fresh();
  apply(debriefing(1, { a: player() }));
  useHistory.getState().select(99);
  assert.equal(useHistory.getState().index, 0);
  useHistory.getState().select(-5);
  assert.equal(useHistory.getState().index, 0);
});

// --- launch context --------------------------------------------------------

test("the ConnectSpring that started the game supplies the map, once", () => {
  fresh();
  apply({ cmd: "ConnectSpring", data: { Map: "Adamantine Mountain 2", Mode: 6, Port: 8452, IsSpectator: false } });
  apply(debriefing(1, { a: player() }));
  apply(debriefing(2, { a: player() }));

  const { records } = useHistory.getState();
  assert.equal(records[1].context?.map, "Adamantine Mountain 2");
  assert.equal(records[1].context?.mode, 6);
  assert.equal(records[0].context, undefined, "the context belongs to one match only");
});

// --- profiles --------------------------------------------------------------

test("UserProfile is merged, not replaced", () => {
  fresh();
  apply({ cmd: "UserProfile", data: { Name: "alice", Level: 41, Rank: 3, EffectiveElo: 1842, EffectiveMmElo: 0, EffectivePwElo: 0, Kudos: 0 } });
  apply({ cmd: "UserProfile", data: { Name: "alice", Kudos: 5 } as T.UserProfile });

  const p = useHistory.getState().profiles.alice;
  assert.equal(p.Kudos, 5);
  assert.equal(p.Level, 41, "an omitted field must survive the patch");
});

// --- the view model --------------------------------------------------------

const MATCH: Record<string, DUser> = {
  alice: player({ AccountID: 1, AllyNumber: 0, IsInVictoryTeam: true, NewElo: 1842.4, EloChange: 17.6, NewRank: 5, IsRankup: true, PrevRankElo: 1750, NextRankElo: 1900, XpChange: 640, NewXp: 12480, PrevLevelXp: 9000, NextLevelXp: 16000, Awards: [{ Key: "mostDamage", Description: "Most damage dealt", Value: 148320 }] }),
  quantum: player({ AccountID: 2, AllyNumber: 0, IsInVictoryTeam: true, NewElo: 1521 }),
  hexed: player({ AccountID: 3, AllyNumber: 1, IsInVictoryTeam: false, NewElo: 1773, EloChange: -17.2 }),
  marrow: player({ AccountID: 4, AllyNumber: 1, IsInVictoryTeam: false, NewElo: 1938 }),
};

function view(me?: string) {
  fresh();
  apply({ cmd: "ConnectSpring", data: { Map: "Lonely Oasis v1.1", Mode: 6, Port: 1, IsSpectator: false } });
  apply(debriefing(42, MATCH, { Url: "https://zero-k.info/Battles/Detail/42", RatingCategory: "Casual" }));
  const s = useHistory.getState();
  return buildDebriefView(s.records[0], me, name => (name === "alice" ? { Clan: "ZKF", Country: "DE", Level: 41 } : undefined), s.profiles);
}

test("your ally team and your result drive the view", () => {
  const v = view("alice");
  assert.equal(v.result, "Victory");
  assert.equal(v.teamLabel, "YOUR TEAM - WON");
  assert.deepEqual(v.team.map(r => r.user.name), ["alice", "quantum"]);
  assert.deepEqual(v.opponents.map(r => r.user.name), ["marrow", "hexed"]);
  assert.equal(v.team[0].you, true);
  assert.equal(v.map, "Lonely Oasis v1.1");
  assert.equal(v.category, "Casual");
  assert.equal(v.url, "https://zero-k.info/Battles/Detail/42");
});

test("a losing player sees the same match from the other side", () => {
  const v = view("hexed");
  assert.equal(v.result, "Defeat");
  assert.equal(v.teamLabel, "YOUR TEAM - LOST");
  assert.deepEqual(v.team.map(r => r.user.name), ["marrow", "hexed"]);
  assert.equal(v.rating?.change, -17, "fractional Elo is rounded for display");
});

test("identity comes from the lobby store, progression from the debriefing", () => {
  const v = view("alice");
  const alice = v.team[0];
  assert.equal(alice.user.clan, "ZKF");
  assert.equal(alice.user.country, "DE");
  assert.equal(alice.elo, 1842);
  assert.equal(alice.change, 18);
  assert.deepEqual(v.awards, [{ name: "Most damage dealt", value: 148320 }]);
  assert.equal(v.rating?.rankup, true);
  // The rank Zero-K announces, not the index it stores it under.
  assert.equal(v.rating?.rank, "Supergiant");
  assert.equal(v.xp?.change, 640);
});

test("the account name is matched case-insensitively", () => {
  const v = view("ALICE");
  assert.equal(v.result, "Victory");
  assert.equal(v.rating?.next, 1842);
});

test("a spectator gets the match without progression", () => {
  const v = view("someoneElse");
  assert.equal(v.result, "Match");
  assert.equal(v.rating, null);
  assert.equal(v.xp, null);
  assert.equal(v.teamLabel, "VICTORY");
  assert.deepEqual(v.team.map(r => r.user.name), ["alice", "quantum"]);
  assert.deepEqual(v.opponents.map(r => r.user.name), ["marrow", "hexed"]);
  assert.equal(v.awards.length, 1, "awards from the whole match, since none are yours");
});

test("elapsed time is only claimed when we saw the launch", () => {
  const v = view("alice");
  assert.match(v.elapsed ?? "", /^\d+:\d\d$/);

  fresh();
  apply(debriefing(1, MATCH));
  assert.equal(buildDebriefView(useHistory.getState().records[0], "alice").elapsed, undefined);
});

test("the profile supplies the level the debriefing does not carry", () => {
  fresh();
  apply({ cmd: "UserProfile", data: { Name: "alice", Level: 41, Rank: 5, EffectiveElo: 1842, EffectiveMmElo: 0, EffectivePwElo: 0, Kudos: 0 } });
  apply(debriefing(1, MATCH));
  const s = useHistory.getState();
  assert.equal(buildDebriefView(s.records[0], "alice", undefined, s.profiles).xp?.level, 41);
  assert.equal(buildDebriefView(s.records[0], "alice").xp?.level, undefined);
});

test("readAwards survives whatever the untyped Awards field turns out to be", () => {
  assert.deepEqual(readAwards(undefined), []);
  assert.deepEqual(readAwards("nope"), []);
  assert.deepEqual(readAwards([null, 3, {}, { Key: "k" }, { Description: "d", Value: 2 }]), [
    { name: "k", value: undefined },
    { name: "d", value: 2 },
  ]);
});
