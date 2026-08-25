/**
 * Run with:  node --test src/net/ranks.test.ts
 *
 * Both tables are upstream's, transcribed rather than derived, so the only
 * thing that can go wrong with them is a typo. Every name and every hex is
 * written out here so a typo fails a test instead of shipping a rank that
 * Zero-K does not have in a colour Zero-K does not use.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_RANK, RANK_COLOURS, RANK_NAMES, RANK_RGB,
  playerRank, rankColour, rankFromIcon, rankName, skillBracket,
} from "./ranks.ts";

/* ZeroK-RTS/Zero-K-Infrastructure ZkData/Ef/WHR/Ranks.cs, Ranks.RankNames. */
const UPSTREAM_NAMES = [
  "Nebulous", "Brown Dwarf", "Red Dwarf", "Subgiant",
  "Giant", "Supergiant", "Neutron Star", "Singularity",
  "Space Lobster",
];

/* ZeroK-RTS/Zero-K LuaUI/Widgets/gui_chili_share.lua, rankColors, as CSS. */
const UPSTREAM_COLOURS = [
  "#808080", "#FF0000", "#CC661A", "#FFA600",
  "#FFFF00", "#B3CCFF", "#0099FF", "#FF00FF",
];

test("the names are Zero-K's, in Zero-K's order", () => {
  assert.deepEqual([...RANK_NAMES], UPSTREAM_NAMES);
});

test("the colours are Zero-K's, in Zero-K's order", () => {
  assert.deepEqual([...RANK_COLOURS], UPSTREAM_COLOURS);
});

test("and the hex really is those floats, not a hand-typed approximation", () => {
  // The floats are what upstream writes; the hex is only how CSS says them.
  assert.equal(RANK_RGB.length, RANK_COLOURS.length);
  RANK_RGB.forEach(([r, g, b], i) => {
    const [, rr, gg, bb] = /^#(..)(..)(..)$/.exec(RANK_COLOURS[i]) as RegExpExecArray;
    assert.equal(parseInt(rr, 16), Math.round(r * 255), `red of rank ${i}`);
    assert.equal(parseInt(gg, 16), Math.round(g * 255), `green of rank ${i}`);
    assert.equal(parseInt(bb, 16), Math.round(b * 255), `blue of rank ${i}`);
  });
});

test("eight ranks are attainable, and Space Lobster is not one of them", () => {
  /* Upstream's ValidateRank stops at 7; the ninth name exists only as the rank
     above the top one, which the website's progress bar names as a joke. */
  assert.equal(MAX_RANK, 7);
  assert.equal(RANK_COLOURS.length, 8);
  assert.equal(RANK_NAMES.length, 9);
  assert.equal(rankName(7), "Singularity");
  assert.equal(rankColour(8), undefined);
});

test("no two ranks share a colour", () => {
  assert.equal(new Set(RANK_COLOURS).size, 8);
  for (const c of RANK_COLOURS) assert.match(c, /^#[0-9A-F]{6}$/);
});

test("every rank a name, every name a rank", () => {
  UPSTREAM_NAMES.forEach((n, i) => assert.equal(rankName(i), n));
  assert.equal(rankName(undefined), undefined);
  assert.equal(rankName(9), undefined);
  assert.equal(rankName(-1), undefined);
  assert.equal(rankName(3.5), undefined);
});

test("the icon id names its own rank, the way the game reads it", () => {
  // `rankColors[icon:sub(3,3)]` - the digit after the underscore.
  assert.equal(rankFromIcon("7_7"), 7);
  assert.equal(rankFromIcon("0_0"), 0);
  assert.equal(rankFromIcon("3_5"), 5);
  assert.equal(rankFromIcon(undefined), undefined);
  assert.equal(rankFromIcon(""), undefined);
  assert.equal(rankFromIcon("robot"), undefined);
  assert.equal(rankFromIcon("7_9"), undefined);
});

test("the Elo bands are Chobby's: 200 apart, from 1000, clamped", () => {
  assert.equal(skillBracket(1000), 0);
  assert.equal(skillBracket(1199), 0);
  assert.equal(skillBracket(1200), 1);
  assert.equal(skillBracket(1400), 2);
  assert.equal(skillBracket(1600), 3);
  assert.equal(skillBracket(1800), 4);
  assert.equal(skillBracket(2000), 5);
  assert.equal(skillBracket(2200), 6);
  assert.equal(skillBracket(2400), 7);
  // There are only eight icons per row; the formula would index past them.
  assert.equal(skillBracket(0), 0);
  assert.equal(skillBracket(-500), 0);
  assert.equal(skillBracket(9000), 7);
});

test("what the server sent beats what we would have guessed", () => {
  /* The Elo band is Chobby's fallback for picking an icon, not the rank. When
     the server has told us the rank, guessing it from a rating is a downgrade,
     and the two genuinely disagree - rank is a percentile, Elo is not. */
  assert.equal(playerRank({ icon: "7_1", rank: 6, elo: 2500 }), 1);
  assert.equal(playerRank({ rank: 6, elo: 1100 }), 6);
  assert.equal(playerRank({ elo: 1100 }), 0);
  assert.equal(playerRank({ rank: 0, elo: 2500 }), 0);
});

test("an out-of-range rank is not a rank", () => {
  // Rather than indexing off the end of the table and colouring nothing.
  assert.equal(playerRank({ rank: 8 }), undefined);
  assert.equal(playerRank({ rank: -1 }), undefined);
  assert.equal(playerRank({ rank: 3.5 }), undefined);
  // ...but a bad rank does not throw away a usable Elo.
  assert.equal(playerRank({ rank: 99, elo: 1850 }), 4);
});

test("nothing known is not rank zero", () => {
  /* A player we know nothing about and a player at Nebulous would otherwise
     look identical, and only one of those is a fact. */
  assert.equal(playerRank({}), undefined);
  assert.equal(playerRank({ elo: NaN }), undefined);
  assert.equal(rankColour(undefined), undefined);
  assert.equal(rankName(undefined), undefined);
  assert.notEqual(rankColour(0), undefined);
});

test("a rating maps to the colour the game tints that rating with", () => {
  assert.equal(rankColour(playerRank({ elo: 1100 })), "#808080");   // Nebulous
  assert.equal(rankColour(playerRank({ elo: 1250 })), "#FF0000");   // Brown Dwarf
  assert.equal(rankColour(playerRank({ elo: 1850 })), "#FFFF00");   // Giant
  assert.equal(rankColour(playerRank({ elo: 2500 })), "#FF00FF");   // Singularity
});
