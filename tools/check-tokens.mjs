/**
 * Fail on `var(--token)` for a token nothing defines.
 *
 * The sibling of `check-names.mjs`, for the same reason. A missing CSS custom
 * property is not a style opinion either - `var(--nope)` with no fallback makes
 * the whole declaration invalid at computed-value time, so the property falls
 * back to its initial value and the element is drawn wrong rather than not at
 * all. Nothing warns.
 *
 * It shipped: the galaxy map drew its planets with `fill: var(--surface-sunken)`
 * and `stroke: var(--border-faint)`. There is no `--border-faint`, so the
 * stroke computed to `none` and every planet became a near-white circle with no
 * edge on a near-white background. The screen looked empty. Every test passed -
 * the tests read data, and the data was fine.
 *
 * ## Existing is not enough
 *
 * The first fix swapped it for `--border-strong`, which exists - and is
 * `1px solid rgba(0,0,0,.22)`, a whole `border` shorthand rather than a colour.
 * `stroke` was invalid again, and `1px solid var(--border-line)` expanded to
 * `1px solid 1px solid rgba(...)`. So this also checks the *kind* of value: a
 * shorthand used where a colour belongs is the same bug wearing a name that
 * resolves.
 *
 *   node tools/check-tokens.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CODE = [".js", ".jsx", ".ts", ".tsx"];
const STYLES = [".css", ".js"];

function walk(dir, keep, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, keep, out);
    else if (keep.includes(extname(entry.name))) out.push(path);
  }
  return out;
}

/* Everything that could define one: the generated design system, any stylesheet
   in the tree, and the skins, which add their own. A token defined anywhere
   counts - this is looking for names nothing anywhere provides. */
const defined = new Set();
for (const dir of ["src", "public", "dist-uiskins"]) {
  const at = join(ROOT, dir);
  try {
    statSync(at);
  } catch {
    continue;
  }
  for (const file of walk(at, STYLES)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]);
  }
}

/* Used, minus the ones with a fallback: `var(--x, red)` is deliberate and
   renders as red, which is a decision rather than a mistake. */
const used = new Map();
for (const file of walk(join(ROOT, "src"), CODE)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
    if (!used.has(m[1])) used.set(m[1], file);
  }
}

/* What each token is worth, so a shorthand can be told from a colour. Last
   definition wins, which matches the cascade closely enough for this. */
const value = new Map();
for (const dir of ["src", "public", "dist-uiskins"]) {
  const at = join(ROOT, dir);
  try {
    statSync(at);
  } catch {
    continue;
  }
  for (const file of walk(at, STYLES)) {
    for (const m of readFileSync(file, "utf8").matchAll(/(--[a-z0-9-]+)\s*:\s*([^;"'`\n}]+)/gi)) {
      value.set(m[1], m[2].trim());
    }
  }
}

/** A whole `border` shorthand - `1px solid rgba(...)` - rather than a colour. */
const isShorthand = name => /^\s*[\d.]+(px|em|rem)\s/.test(value.get(name) ?? "");

/* Places where only a colour will do. A shorthand in any of them makes the
   declaration invalid, and the element draws with its initial value. */
const COLOUR_SLOT = /\b(stroke|fill|color|backgroundColor|borderColor|outlineColor|background)\s*[:=]\s*[{"'`]*\s*var\(\s*(--[a-z0-9-]+)/gi;
const NESTED = /[\d.]+(?:px|em|rem)\s+\w+\s+var\(\s*(--[a-z0-9-]+)/gi;

const wrongKind = [];
for (const file of walk(join(ROOT, "src"), CODE)) {
  const text = readFileSync(file, "utf8");
  for (const [, , name] of text.matchAll(COLOUR_SLOT)) {
    if (isShorthand(name)) wrongKind.push([name, file, "a colour is needed here"]);
  }
  for (const [, name] of text.matchAll(NESTED)) {
    if (isShorthand(name)) wrongKind.push([name, file, "already inside a border shorthand"]);
  }
}

if (wrongKind.length) {
  console.error(`${wrongKind.length} CSS token${wrongKind.length === 1 ? " is" : "s are"} the wrong kind of value:\n`);
  for (const [name, file, why] of wrongKind) {
    console.error(`  ${name} = "${value.get(name)}"`);
    console.error(`    in ${file.slice(ROOT.length + 1)} - ${why}`);
  }
  console.error("\nThe `--border-*` tokens are whole `border` shorthands. For a colour");
  console.error("use the `--w-*` ramp or an `--ink-*`/`--text-*`/`--surface-*` token.");
  process.exit(1);
}

const missing = [...used].filter(([name]) => !defined.has(name)).sort();
if (missing.length) {
  console.error(`${missing.length} CSS custom propert${missing.length === 1 ? "y is" : "ies are"} used but never defined:\n`);
  for (const [name, file] of missing) {
    console.error(`  ${name}  first used in ${file.slice(ROOT.length + 1)}`);
  }
  console.error("\nA var() with no fallback and no definition makes the whole");
  console.error("declaration invalid, so the element draws wrong and nothing warns.");
  process.exit(1);
}

console.log(`CSS tokens fine: ${used.size} used, ${defined.size} defined, none of the wrong kind`);
