#!/usr/bin/env node
/**
 * Generates src/protocol/{enums,types,registry}.ts from the ZkLobbyServer
 * protocol definitions.
 *
 * The upstream source is the authority for the wire format, so we parse it
 * rather than hand-maintaining 84 interfaces. Re-run after bumping PIN_SHA;
 * the TypeScript compiler then tells you exactly what changed.
 *
 *   node tools/gen-protocol.mjs
 *
 * Deliberate mapping decisions:
 *   - C# enums serialize as NUMBERS (UseEnumString is off upstream).
 *   - DateTime serializes as an ISO-8601 string.
 *   - Nullable members are emitted optional, because the server sets
 *     NullValueHandling.Ignore and omits unchanged fields entirely.
 *   - Expression-bodied properties (public bool IsAway => ...) are computed
 *     server-side and never appear on the wire, so they are skipped.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PIN_SHA = "48f6f09bc1d0266f204026580671ce867f75d6bd";
const REPO = "ZeroK-RTS/Zero-K-Infrastructure";
const FILES = [
  "Shared/LobbyClient/Protocol/Messages.cs",
  "Shared/LobbyClient/Protocol/MatchMakerMessages.cs",
  "Shared/LobbyClient/Protocol/PartyMessages.cs",
  // Referenced by Messages.cs but declared in another namespace. Without it
  // BattleHeader.Mode and ConnectSpring.Mode degrade to `unknown`.
  "Shared/PlasmaShared/ISpringieService/AutohostMode.cs",
  // Same story for SetAccountRelation.Relation, which is how friends and
  // ignores are set - guessing at those numbers would be unforgivable.
  "Shared/PlasmaShared/Relation.cs",
  // And for UpdateUserBattleStatus.Sync, which is how you tell the room you
  // have the map. Left as `unknown` it looks optional; it is not - a client
  // that never sends it stays Unknown forever, and the server announces you as
  // still downloading every time somebody starts a game.
  "Shared/LobbyClient/UserBattleStatus.cs",
  // NewsList, LadderList and ForumList are declared in Messages.cs as lists of
  // NewsItem, LadderItem and ForumItem, and those three DTOs live over here, in
  // the content service's API surface that the website and the lobby server
  // share. Without this file all three lists degrade to `unknown[]` - including
  // the news ZkLobbyServer pushes to every client on connect, which is real,
  // maintained content nobody could read without hand-copying five fields that
  // would then drift. Reading the file brings that API's other request and
  // response shapes along, which nothing here uses; unread interfaces in a
  // generated file are a cheaper problem than a hand-maintained copy.
  "Shared/PlasmaShared/IContentService/IContentService.cs",
];

/* Files we read for the types they contribute rather than the commands they
   declare. The protocol files declare commands at the top level, so a top-level
   class in one of them is something the server sends; that is not true of
   these, whose classes are ordinary server types and would otherwise be
   published as commands nobody can ever receive. Everything in them is still
   emitted into types.ts - that is what they are here for. */
const NOT_COMMANDS = new Set([
  "Shared/LobbyClient/UserBattleStatus.cs",
  "Shared/PlasmaShared/IContentService/IContentService.cs",
]);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "protocol");

// ---------------------------------------------------------------- fetch ----

async function fetchSource(path) {
  const url = `https://raw.githubusercontent.com/${REPO}/${PIN_SHA}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------- lexing ---

/** Strip // line comments, /* block *\/ comments and /// doc comments. */
function stripComments(src) {
  let out = "";
  let i = 0;
  let inStr = false;
  let strCh = "";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === strCh) inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c;
    i++;
  }
  return out;
}

/** Index of the matching close brace for the open brace at `open`. */
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return i; }
  }
  throw new Error("unbalanced braces");
}

// --------------------------------------------------------------- parsing ---

const enums = [];   // { name, qualified, members: [{name, value}] }
const classes = []; // { name, qualified, members: [{name, tsType, optional}], isAttribute }

const DECL = /(?:\[[^\]]*\]\s*)*public\s+(?:sealed\s+|static\s+|partial\s+|abstract\s+)*(class|enum)\s+([A-Za-z_]\w*)\s*(?::\s*([^{]+?))?\s*\{/g;

function parseBlock(body, prefix) {
  DECL.lastIndex = 0;
  const nested = [];
  let m;
  while ((m = DECL.exec(body))) {
    const [, kind, name, bases] = m;
    const open = body.indexOf("{", m.index + m[0].length - 1);
    const close = matchBrace(body, open);
    const inner = body.slice(open + 1, close);
    const qualified = prefix ? `${prefix}_${name}` : name;
    nested.push({ kind, name, qualified, inner, bases: bases || "" });
    DECL.lastIndex = close;
  }
  return nested;
}

/** Split on commas that are not inside quotes or brackets. Enum [Description]
 *  strings contain commas ("banned, too many connection attempts"). */
function splitMembers(s) {
  const out = [];
  let cur = "", depth = 0, inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { cur += c; if (c === '"' && s[i - 1] !== "\\") inStr = false; continue; }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === "[" || c === "(") depth++;
    if (c === "]" || c === ")") depth--;
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function parseEnumMembers(inner) {
  const members = [];
  let next = 0;
  for (const raw of splitMembers(inner)) {
    const desc = raw.match(/\[Description\("((?:[^"\\]|\\.)*)"\)\]/);
    const line = raw.replace(/\[[^\]]*\]/gs, "").trim();
    if (!line) continue;
    const mm = line.match(/^([A-Za-z_]\w*)\s*(?:=\s*(-?\d+))?$/);
    if (!mm) continue;
    const value = mm[2] !== undefined ? parseInt(mm[2], 10) : next;
    members.push({ name: mm[1], value, description: desc ? desc[1] : null });
    next = value + 1;
  }
  return members;
}

/** Remove nested type declarations so member parsing does not see their bodies. */
function stripNested(inner) {
  let out = inner;
  for (;;) {
    DECL.lastIndex = 0;
    const m = DECL.exec(out);
    if (!m) return out;
    const open = out.indexOf("{", m.index + m[0].length - 1);
    const close = matchBrace(out, open);
    let end = close + 1;
    // swallow a trailing initializer/semicolon after the closing brace
    while (end < out.length && /[\s;]/.test(out[end])) end++;
    out = out.slice(0, m.index) + out.slice(end);
  }
}

// The leading group captures the attributes rather than merely skipping past
// them, because one of them decides whether the member exists at all.
const MEMBER =
  /((?:\[[^\]]*\]\s*)*)public\s+(?!class|enum|struct|interface)((?:[A-Za-z_][\w.]*)(?:\s*<[^>;{]*>)?\??(?:\[\])?)\s+([A-Za-z_]\w*)\s*(=>|\{\s*get\s*;\s*set\s*;\s*\}|\{\s*get\s*;\s*\}|=|;)/g;

function parseMembers(inner, ctx) {
  const stripped = stripNested(inner);
  const members = [];
  let m;
  MEMBER.lastIndex = 0;
  while ((m = MEMBER.exec(stripped))) {
    const [, attrs, rawType, name, tail] = m;
    if (tail === "=>") continue;                 // computed, never on the wire
    if (/\(/.test(rawType)) continue;            // method
    /* [JsonIgnore] means the serializer drops it, so it is never on the wire
       whatever the class says. Emitting it anyway produced fields that were
       always undefined and typed as though they were not: MatchMakerSetup's
       Queue declares Mode, MinSize and MaxSize - exactly what a client would
       group queues by - and marks all three [JsonIgnore], so a screen written
       against them read undefined and said nothing about it. User.PartyID is
       the same. The attributes were already being matched here; they just were
       not being read. */
    if (/\[\s*JsonIgnore\s*(\([^)]*\))?\s*\]/.test(attrs)) continue;
    const { ts, optional } = mapType(rawType.trim(), ctx);
    members.push({ name, tsType: ts, optional });
  }
  return members;
}

// ------------------------------------------------------------ type mapping --

// ts type, plus whether the C# type is a *reference* type. This matters: the
// server sets NullValueHandling.Ignore, so any reference-typed member that is
// null is omitted from the JSON entirely. Value types (int, bool, enum, and
// the DateTime/Guid structs) are never null and are always present.
const PRIMITIVES = {
  string: ["string", true], object: ["unknown", true],
  bool: ["boolean", false], DateTime: ["string", false],
  TimeSpan: ["string", false], Guid: ["string", false],
  byte: ["number", false], sbyte: ["number", false], short: ["number", false],
  ushort: ["number", false], int: ["number", false], uint: ["number", false],
  long: ["number", false], ulong: ["number", false], float: ["number", false],
  double: ["number", false], decimal: ["number", false],
};

function mapType(raw, ctx) {
  let t = raw.trim();
  let nullable = false;
  if (t.endsWith("?")) { nullable = true; t = t.slice(0, -1).trim(); }
  const done = (ts, isRef) => ({ ts, optional: nullable || isRef });

  const arr = t.match(/^(.+)\[\]$/);
  if (arr) return done(`${mapType(arr[1], ctx).ts}[]`, true);

  const gen = t.match(/^([A-Za-z_][\w.]*)\s*<(.+)>$/s);
  if (gen) {
    const outer = gen[1].split(".").pop();
    const args = splitGenericArgs(gen[2]);
    if (/^(List|IList|ICollection|IEnumerable|HashSet)$/.test(outer))
      return done(`${mapType(args[0], ctx).ts}[]`, true);
    if (/^(Dictionary|IDictionary)$/.test(outer))
      return done(`Record<${mapType(args[0], ctx).ts}, ${mapType(args[1], ctx).ts}>`, true);
    return done("unknown", true);
  }

  if (PRIMITIVES[t]) { const [ts, isRef] = PRIMITIVES[t]; return done(ts, isRef); }

  // Resolve a possibly-qualified reference (Welcome.FactionInfo) against the
  // types we know about, preferring one nested in the current class.
  const parts = t.split(".");
  const last = parts[parts.length - 1];
  const candidates = [
    parts.length > 1 ? parts.join("_") : null,
    ctx.self ? `${ctx.self}_${last}` : null,
    last,
  ].filter(Boolean);
  // An enum is a value type; a class reference is not.
  for (const c of candidates) if (ctx.known.has(c)) return done(c, !ctx.enums.has(c));
  return done("unknown", true);
}

function splitGenericArgs(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "<") depth++;
    if (ch === ">") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ------------------------------------------------------------------ main ----

const sources = [];
for (const f of FILES) sources.push({ path: f, src: stripComments(await fetchSource(f)) });

// Pass 1 - discover every type name (top level and nested) so references resolve.
const discovered = [];
for (const { path, src } of sources) {
  const walk = (body, prefix, topLevel) => {
    for (const d of parseBlock(body, prefix)) {
      discovered.push({ ...d, path, topLevel });
      walk(d.inner, d.qualified, false);
    }
  };
  walk(src, "", true);
}
const known = new Set(discovered.map(d => d.qualified));
const enumSet = new Set(discovered.filter(d => d.kind === "enum").map(d => d.qualified));

// Pass 2 - build the models.
for (const d of discovered) {
  if (d.kind === "enum") {
    enums.push({ qualified: d.qualified, members: parseEnumMembers(d.inner) });
  } else {
    const isAttribute = /(^|[\s,:])Attribute\b/.test(d.bases);
    classes.push({
      qualified: d.qualified,
      name: d.name,
      path: d.path,
      topLevel: d.topLevel,
      isAttribute,
      members: parseMembers(d.inner, { known, enums: enumSet, self: d.qualified }),
    });
  }
}

// Wire commands are the top-level classes; nested types are payload DTOs.
const commands = classes
  .filter(c => c.topLevel && !c.isAttribute && !NOT_COMMANDS.has(c.path))
  .map(c => c.name)
  .sort();

const banner = `// GENERATED by tools/gen-protocol.mjs - DO NOT EDIT.
// Source: github.com/${REPO} @ ${PIN_SHA}
// Regenerate: node tools/gen-protocol.mjs
`;

// -- enums.ts
let enumsTs = banner + "\n";
for (const e of enums) {
  enumsTs += `export enum ${e.qualified} {\n`;
  for (const m of e.members) enumsTs += `  ${m.name} = ${m.value},\n`;
  enumsTs += "}\n\n";

  // Upstream annotates many enum members with [Description("...")]. Those are
  // the strings the official client shows, so carry them across rather than
  // inventing our own labels.
  if (e.members.some(m => m.description)) {
    const seen = new Set();
    enumsTs += `/** Display labels from the upstream [Description] attributes. */\n`;
    enumsTs += `export const ${e.qualified}Label: Record<${e.qualified}, string> = {\n`;
    for (const m of e.members) {
      if (seen.has(m.value)) continue;
      seen.add(m.value);
      enumsTs += `  [${e.qualified}.${m.name}]: ${JSON.stringify(m.description ?? m.name)},\n`;
    }
    enumsTs += "};\n\n";
  }
}

// -- types.ts
let typesTs = banner + "\nimport type * as E from \"./enums\";\n\n";
const enumNames = new Set(enums.map(e => e.qualified));
const ref = t => {
  // qualify enum references into the E namespace
  const base = t.replace(/\[\]$/, "");
  if (enumNames.has(base)) return t.replace(base, `E.${base}`);
  const rec = t.match(/^Record<([^,]+), (.+)>$/);
  if (rec) return `Record<${ref(rec[1])}, ${ref(rec[2])}>`;
  return t;
};
for (const c of classes) {
  if (c.isAttribute) continue;
  typesTs += `export interface ${c.qualified} {\n`;
  if (!c.members.length) typesTs += "  // no members\n";
  for (const m of c.members) typesTs += `  ${m.name}${m.optional ? "?" : ""}: ${ref(m.tsType)};\n`;
  typesTs += "}\n\n";
}

// -- registry.ts
let regTs = banner + "\nimport type * as T from \"./types\";\n\n";
regTs += "/** Every top-level protocol command, keyed by the name that precedes the JSON on the wire. */\n";
regTs += "export interface MessageMap {\n";
for (const name of commands) regTs += `  ${name}: T.${name};\n`;
regTs += "}\n\n";
regTs += "export type CommandName = keyof MessageMap;\n\n";
regTs += "/** Discriminated union of every decoded message. */\n";
regTs += "export type Message = { [K in CommandName]: { cmd: K; data: MessageMap[K] } }[CommandName];\n\n";
regTs += `export const COMMAND_NAMES = ${JSON.stringify(commands, null, 2)} as const;\n\n`;
regTs += "const COMMAND_SET: ReadonlySet<string> = new Set(COMMAND_NAMES);\n\n";
regTs += "export function isCommandName(s: string): s is CommandName {\n  return COMMAND_SET.has(s);\n}\n";

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "enums.ts"), enumsTs, "utf8");
writeFileSync(join(OUT, "types.ts"), typesTs, "utf8");
writeFileSync(join(OUT, "registry.ts"), regTs, "utf8");

const nested = classes.filter(c => !c.topLevel).length;
const noMembers = classes.filter(c => !c.isAttribute && !c.members.length).map(c => c.qualified);
console.log(`pinned    ${PIN_SHA.slice(0, 12)}`);
console.log(`enums     ${enums.length}`);
console.log(`classes   ${classes.length} (${commands.length} commands, ${nested} nested DTOs)`);
console.log(`members   ${classes.reduce((n, c) => n + c.members.length, 0)}`);
if (noMembers.length) console.log(`WARN empty interfaces: ${noMembers.join(", ")}`);
