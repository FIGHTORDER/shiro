/**
 * Run with:  node --test src/net/modOptions.test.ts
 *
 * Two of these tests exist because of specific ways this can go wrong on a real
 * server, not because the functions looked worth covering: `SetModOptions`
 * replaces the room's dictionary rather than merging into it, and the server
 * puts `noelo` in that dictionary itself. An editor that forgets either one
 * turns rating back on in a modded room without telling anyone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MODOPTIONS, MODOPTION_SECTIONS,
  optionFor, formatNumber, defaultFor, defaults, isDefault, clampNumber,
  encode, merge, resetToDefaults, changedOptions, sections, canEdit,
} from "./modOptions.ts";

const option = (key: string) => {
  const o = optionFor(key);
  assert.ok(o, `no such option: ${key}`);
  return o;
};

// ------------------------------------------------------------- the table ----

test("the generated table is the shape the editor assumes", () => {
  assert.equal(MODOPTIONS.length, 90);
  assert.equal(MODOPTION_SECTIONS.length, 7);

  for (const o of MODOPTIONS) {
    assert.ok(o.key && o.name, `${o.key} is missing a name`);
    assert.ok(
      MODOPTION_SECTIONS.some(s => s.key === o.section),
      `${o.key} is in unknown section ${o.section}`,
    );
    if (o.kind === "number") {
      // The editor clamps and rounds to these; a missing one cannot behave.
      assert.equal(typeof o.min, "number", `${o.key} has no min`);
      assert.equal(typeof o.max, "number", `${o.key} has no max`);
      assert.equal(typeof o.step, "number", `${o.key} has no step`);
    }
    if (o.kind === "list") {
      assert.ok(o.items?.length, `${o.key} has no items`);
      assert.ok(
        o.items!.some(i => i.key === o.def),
        `${o.key} defaults to something that is not one of its items`,
      );
    }
  }
});

test("every option belongs to exactly one section, and none are stranded", () => {
  const grouped = sections();
  const total = grouped.reduce((n, s) => n + s.options.length, 0);
  assert.equal(total, MODOPTIONS.length);
  assert.deepEqual(
    grouped.map(s => s.section.key),
    // Upstream's order, which puts the commonly-used options first.
    ["a_important", "startconds", "mapsettings", "multipliers", "silly", "experimental", "chicken"],
  );
});

test("the tweak slots did not come across", () => {
  // `noLobby` upstream: base64 blobs of Lua, not settings.
  for (const o of MODOPTIONS) {
    assert.ok(!/^tweak(units|defs)\d+$/.test(o.key), `${o.key} should be hidden`);
  }
});

// ---------------------------------------------------------- number format ----

test("formatNumber matches the ZK client's TextFromNum", () => {
  // Places come from the step, then trailing zeros and the point are stripped.
  assert.equal(formatNumber(1, 1), "1");
  assert.equal(formatNumber(1.5, 1), "2");          // 0 places, rounded by toFixed
  assert.equal(formatNumber(0.6, 0.5), "0.6");      // 1 place
  assert.equal(formatNumber(0.6, 0.05), "0.6");     // 2 places, trailing zero gone
  assert.equal(formatNumber(0.625, 0.01), "0.63");  // 2 places
  assert.equal(formatNumber(0.625, 0.005), "0.625");// 3 places
  assert.equal(formatNumber(2, 0.01), "2");         // "2.00" -> "2"
  assert.equal(formatNumber(60, 60), "60");
});

test("a float default does not arrive with float noise", () => {
  // The reason upstream does not use tostring(): 0.6 becomes "0.6000000002".
  const o = MODOPTIONS.find(x => x.kind === "number" && typeof x.def === "number"
    && !Number.isInteger(x.def));
  assert.ok(o, "expected at least one fractional default");
  assert.ok(!defaultFor(o).includes("000"), `${o.key} -> ${defaultFor(o)}`);
});

test("defaults encode by kind", () => {
  for (const o of MODOPTIONS) {
    const d = defaultFor(o);
    assert.equal(typeof d, "string");
    if (o.kind === "bool") assert.ok(d === "1" || d === "0", `${o.key} -> ${d}`);
    if (o.kind === "list") {
      assert.ok(o.items!.some(i => i.key === d), `${o.key} -> ${d}`);
    }
  }
  assert.equal(Object.keys(defaults()).length, MODOPTIONS.length);
});

test("a default fed back through encode is unchanged", () => {
  // If this drifts, options read as "changed" the moment the dialog opens.
  for (const o of MODOPTIONS) {
    assert.equal(encode(o, defaultFor(o)), defaultFor(o), o.key);
  }
});

// --------------------------------------------------------------- editing ----

test("numbers are clamped into range and rounded to the step", () => {
  const o = option("mergeresourceshare");         // 0..1, step 0.05
  assert.equal(clampNumber(o.min! - 100, o), formatNumber(o.min!, o.step!));
  assert.equal(clampNumber(o.max! + 100, o), formatNumber(o.max!, o.step!));
  assert.equal(clampNumber(0.52, o), "0.5");
  assert.equal(clampNumber(0.53, o), "0.55");
});

test("a number never leaves the range its own table declares", () => {
  /* Upstream's rounding does. `chicken_maxtech` is step 60 with max 9000, and
     `floor(v/step + 0.49)*step + 0.01*step` turns its own default into 9001 -
     so tabbing through the field edited it. */
  const o = option("chicken_maxtech");
  assert.equal(clampNumber(9000, o), "9000");
  for (const v of [o.min!, o.max!, o.max! + 1, o.min! - 1, 4477, 9000]) {
    const n = Number(clampNumber(v, o));
    assert.ok(n >= o.min! && n <= o.max!, `${v} -> ${n} is outside ${o.min}..${o.max}`);
  }
});

test("encode refuses what it cannot make sense of", () => {
  const num = MODOPTIONS.find(o => o.kind === "number")!;
  assert.equal(encode(num, "not a number"), undefined);

  const list = MODOPTIONS.find(o => o.kind === "list")!;
  assert.equal(encode(list, "no-such-item"), undefined);
  assert.equal(encode(list, list.items![0].key), list.items![0].key);

  const bool = MODOPTIONS.find(o => o.kind === "bool")!;
  assert.equal(encode(bool, true), "1");
  assert.equal(encode(bool, false), "0");
});

test("an unknown key is never default, because we have nothing to compare it to", () => {
  assert.equal(isDefault("tweakdefs1", ""), false);
  const known = MODOPTIONS[0];
  assert.equal(isDefault(known.key, defaultFor(known)), true);
});

// ------------------------------------------------- the two server traps ----

test("merging keeps keys we know nothing about", () => {
  /* The trap. `SetModOptions` assigns the dictionary rather than merging, and
     ServerBattle sets `noelo` itself for a non-vanilla game. Sending only our
     own controls would drop it and quietly re-enable rating. */
  const known = MODOPTIONS.find(o => o.kind === "bool" && o.key !== "noelo")!;
  const current = { noelo: "1", tweakdefs1: "cmVzb3VyY2Vz", [known.key]: "1" };
  const sent = merge(current, { [known.key]: "0" });

  assert.equal(sent.noelo, "1", "the server's own key was dropped");
  assert.equal(sent.tweakdefs1, "cmVzb3VyY2Vz", "a key outside our table was dropped");
  assert.equal(sent[known.key], "0");
});

test("resetting keeps them too, unlike the ZK client", () => {
  /* Upstream resets by sending {}, which also clears noelo. We drop only the
     keys we own; absent means the game decides, which is what reset means. */
  const known = MODOPTIONS.find(o => o.kind === "bool" && o.key !== "noelo")!;
  const sent = resetToDefaults({ noelo: "1", tweakdefs1: "abc", [known.key]: "1" });

  assert.deepEqual(sent, { noelo: "1", tweakdefs1: "abc" });
  assert.ok(!(known.key in sent), "a known option should be left to the game");
});

// --------------------------------------------------------------- display ----

test("only what the game would not have done anyway is worth showing", () => {
  const o = MODOPTIONS.find(x => x.kind === "list")!;
  const other = o.items!.find(i => i.key !== o.def)!;

  const shown = changedOptions({ [o.key]: defaultFor(o) });
  assert.deepEqual(shown, [], "a default should not be listed");

  const changed = changedOptions({ [o.key]: other.key });
  assert.equal(changed.length, 1);
  assert.equal(changed[0].label, o.name, "the key should be shown by name");
  assert.equal(changed[0].value, other.name, "a list value should be shown by name");
  assert.equal(changed[0].known, true);
});

test("a key we have no table for is shown rather than hidden", () => {
  const shown = changedOptions({ tweakdefs1: "abc" });
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0], { key: "tweakdefs1", label: "tweakdefs1", value: "abc", known: false });
});

test("known options sort before unrecognised ones", () => {
  const o = MODOPTIONS.find(x => x.kind === "bool" && defaultFor(x) === "0")!;
  const shown = changedOptions({ tweakdefs1: "abc", [o.key]: "1" });
  assert.deepEqual(shown.map(s => s.known), [true, false]);
});

test("an empty or absent dictionary is not an error", () => {
  assert.deepEqual(changedOptions({}), []);
  assert.deepEqual(changedOptions(undefined as never), []);
});

// ---------------------------------------------------------- permissions ----

test("only the founder may edit, which is the server's rule read backwards", () => {
  assert.equal(canEdit("qrow", "qrow"), true);
  assert.equal(canEdit("qrow", "someone"), false);
  // An autohost's founder is never a person: the server renames it.
  assert.equal(canEdit("Autohost #4211", "qrow"), false);
  // Not in a room, or not logged in.
  assert.equal(canEdit(undefined, "qrow"), false);
  assert.equal(canEdit("qrow", undefined), false);
  assert.equal(canEdit("", ""), false);
});

test("an admin may change options in a room they did not open", () => {
  // The server's rule ends `&& !IsAdmin`: the founder may, and so may an
  // admin, anywhere. Dropping that half left moderators looking at a locked
  // panel for something the server would have accepted.
  assert.equal(canEdit("hexed", "zk-admin", true), true);
  assert.equal(canEdit("hexed", "zk-admin", false), false);
  assert.equal(canEdit("hexed", "hexed"), true, "the founder still may");
  assert.equal(canEdit(undefined, "zk-admin", true), true, "even with no founder named");
  assert.equal(canEdit("hexed", undefined, true), false, "but not while logged out");
});
