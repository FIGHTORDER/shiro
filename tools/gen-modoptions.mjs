#!/usr/bin/env node
/**
 * Generates src/protocol/modoptions.ts from Zero-K's ModOptions.lua.
 *
 * A room's modoptions are the game's own settings - deathmode, resource
 * multipliers, chicken difficulty - and the list of them is declared in one Lua
 * table in the game repo. Zero-K's client does not read that table out of the
 * game archive for Zero-K itself: it ships a copy and reads that, deliberately,
 * so that "the functioning of the base game" does not depend on the engine's
 * virtual filesystem working. We do the same thing, from the same file.
 *
 *   node tools/gen-modoptions.mjs
 *
 * The pin is the game repo rather than Chobby's bundled copy. The two are
 * byte-identical today - Chobby's copy *is* this file - and the game repo is
 * the source both of them come from.
 *
 * What comes across and what does not:
 *   - `type = 'section'` entries become the tab structure, in file order.
 *   - `noLobby` entries do not come across at all. They are the eighteen
 *     tweakunits/tweakdefs slots: base64 blobs of Lua, not settings, hidden
 *     from the lobby upstream for the same reason we hide them.
 *   - `def` is emitted raw - number, boolean or string. Encoding it to the
 *     string the wire wants is src/net/modOptions.ts's job, because the exact
 *     formatting decides whether an option reads as changed, and that deserves
 *     one implementation with tests rather than two.
 *
 * The eighteen skipped entries are appended by `for` loops *after* the literal
 * table, which a reader of the literal cannot see. That is the right outcome
 * today and a silent hole tomorrow, so the generator scans the tail of the file
 * and fails if a loop ever appends something the lobby is meant to show.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readAssignment } from "./lua.mjs";

const PIN_SHA = "dee52f70f02a3875f1e02da7f863581b2fe3127c";
const REPO = "ZeroK-RTS/Zero-K";
const FILE = "ModOptions.lua";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "protocol");

/** The four types the lobby knows how to render. */
const KINDS = new Set(["bool", "number", "list", "string"]);

// ----------------------------------------------------------------- read ----

const url = `https://raw.githubusercontent.com/${REPO}/${PIN_SHA}/${FILE}`;
const res = await fetch(url);
if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
const src = await res.text();

const entries = readAssignment(src, "options");
if (!Array.isArray(entries)) throw new Error("`local options` is not an array");

/* Everything appended after the literal table. These live inside `for` loops
   and are built from expressions - `name = "Tweak Units " .. i` - so they
   cannot be read as values; the reader is a table reader, not an interpreter.
   We only need to know whether each one is lobby-visible, so find the extent of
   the table by matching braces and look for `noLobby` inside it.

   If one of them lacks it, upstream has grown a lobby option this generator
   cannot see. Shipping a menu quietly missing an option is worse than failing
   the build here. */
function tableAt(text, open) {
  let i = open, depth = 0;
  for (;;) {
    const c = text[i];
    if (c === undefined) throw new Error("unterminated table literal");
    if (c === "-" && text.startsWith("--", i)) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
    } else if (c === '"' || c === "'") {
      i++;
      while (text[i] !== c) i += text[i] === "\\" ? 2 : 1;
      i++;
    } else {
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return text.slice(open, i + 1);
      i++;
    }
  }
}

const APPEND = /options\[#options \+ 1\]\s*=\s*(?=\{)/g;
let hidden = 0;
for (const m of src.matchAll(APPEND)) {
  const body = tableAt(src, m.index + m[0].length);
  if (!/\bnoLobby\s*=\s*true\b/.test(body)) {
    const key = /\bkey\s*=\s*"([^"]*)"/.exec(body)?.[1] ?? "?";
    throw new Error(
      `ModOptions.lua appends a lobby-visible option (${key}) after the literal `
      + `table. The generator only reads the literal, so this would be silently `
      + `dropped - teach it to expand the loop, or hide the option.`,
    );
  }
  hidden++;
}

// -------------------------------------------------------------- convert ----

const sections = [];
const options = [];
const skipped = [];

for (const e of entries) {
  if (!e || typeof e !== "object" || Array.isArray(e)) continue;

  if (e.type === "section") {
    sections.push({ key: e.key, name: e.name, desc: e.desc ?? "" });
    continue;
  }
  if (e.noLobby) { skipped.push(e.key); continue; }

  if (!KINDS.has(e.type)) {
    throw new Error(`option ${e.key} has unknown type ${JSON.stringify(e.type)}`);
  }
  if (!e.section) throw new Error(`option ${e.key} has no section`);

  const out = {
    key: e.key,
    name: e.name,
    desc: e.desc ?? "",
    section: e.section,
    kind: e.type,
    def: e.def,
  };

  if (e.type === "number") {
    /* Every number upstream carries all three today. The editor clamps and
       rounds to them, so a missing one is a control that cannot behave. */
    for (const k of ["min", "max", "step"]) {
      if (typeof e[k] !== "number") throw new Error(`number option ${e.key} has no ${k}`);
      out[k] = e[k];
    }
  }

  if (e.type === "list") {
    if (!Array.isArray(e.items) || !e.items.length) {
      throw new Error(`list option ${e.key} has no items`);
    }
    out.items = e.items.map(i => ({ key: i.key, name: i.name, desc: i.desc ?? "" }));
    if (!out.items.some(i => i.key === e.def)) {
      throw new Error(`list option ${e.key} defaults to ${JSON.stringify(e.def)}, which is not one of its items`);
    }
  }

  options.push(out);
}

const known = new Set(sections.map(s => s.key));
for (const o of options) {
  if (!known.has(o.section)) throw new Error(`option ${o.key} is in unknown section ${o.section}`);
}

// ---------------------------------------------------------------- write ----

const lit = v => JSON.stringify(v);

const lines = [];
lines.push("/* Generated by tools/gen-modoptions.mjs. Do not edit.");
lines.push(` * ${REPO}@${PIN_SHA.slice(0, 12)} ${FILE}`);
lines.push(" *");
lines.push(" * Zero-K's modoptions: what a room's host can change about the game.");
lines.push(` * ${options.length} options in ${sections.length} sections. The tweakunits and`);
lines.push(" * tweakdefs slots are `noLobby` upstream and are not here.");
lines.push(" */");
lines.push("");
lines.push('export type ModOptionKind = "bool" | "number" | "list" | "string";');
lines.push("");
lines.push("export interface ModOptionItem {");
lines.push("  key: string;");
lines.push("  name: string;");
lines.push("  desc: string;");
lines.push("}");
lines.push("");
lines.push("export interface ModOption {");
lines.push("  key: string;");
lines.push("  name: string;");
lines.push("  desc: string;");
lines.push("  section: string;");
lines.push("  kind: ModOptionKind;");
lines.push("  /** Raw, as declared. `src/net/modOptions.ts` encodes it for the wire. */");
lines.push("  def: string | number | boolean;");
lines.push("  min?: number;");
lines.push("  max?: number;");
lines.push("  step?: number;");
lines.push("  items?: ModOptionItem[];");
lines.push("}");
lines.push("");
lines.push("export interface ModOptionSection {");
lines.push("  key: string;");
lines.push("  name: string;");
lines.push("  desc: string;");
lines.push("}");
lines.push("");
lines.push("/** Tab order, as declared upstream. */");
lines.push("export const MODOPTION_SECTIONS: readonly ModOptionSection[] = [");
for (const s of sections) {
  lines.push(`  { key: ${lit(s.key)}, name: ${lit(s.name)}, desc: ${lit(s.desc)} },`);
}
lines.push("];");
lines.push("");
lines.push("/** Every lobby-editable option, in declaration order. */");
lines.push("export const MODOPTIONS: readonly ModOption[] = [");
for (const o of options) {
  const parts = [
    `key: ${lit(o.key)}`,
    `name: ${lit(o.name)}`,
    `desc: ${lit(o.desc)}`,
    `section: ${lit(o.section)}`,
    `kind: ${lit(o.kind)}`,
    `def: ${lit(o.def)}`,
  ];
  if (o.kind === "number") parts.push(`min: ${o.min}`, `max: ${o.max}`, `step: ${o.step}`);
  lines.push(`  {`);
  for (const p of parts) lines.push(`    ${p},`);
  if (o.items) {
    lines.push("    items: [");
    for (const i of o.items) {
      lines.push(`      { key: ${lit(i.key)}, name: ${lit(i.name)}, desc: ${lit(i.desc)} },`);
    }
    lines.push("    ],");
  }
  lines.push(`  },`);
}
lines.push("];");
lines.push("");

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "modoptions.ts"), lines.join("\n"), "utf8");

const byKind = options.reduce((a, o) => ((a[o.kind] = (a[o.kind] ?? 0) + 1), a), {});
console.log(`sections  ${sections.map(s => `${s.name}(${options.filter(o => o.section === s.key).length})`).join(" ")}`);
console.log(`options   ${options.length} - ${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")}`);
console.log(`hidden    ${hidden} noLobby loop${hidden === 1 ? "" : "s"} (tweakunits/tweakdefs)`);
console.log(`pinned    ${PIN_SHA.slice(0, 12)}`);
