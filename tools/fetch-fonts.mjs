#!/usr/bin/env node
/**
 * Re-vendors the webfonts from Google Fonts into src/assets/fonts/ and rewrites
 * src/styles/tokens/fonts.css to point at them.
 *
 * The app has to render offline and the packaged CSP does not allow a request
 * to fonts.googleapis.com, so the files are committed rather than fetched at
 * runtime. Run this only to pick up a font update:
 *
 *   node tools/fetch-fonts.mjs
 *
 * Italics and every subset beyond latin and latin-ext are dropped on purpose -
 * see the header it writes into fonts.css.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "assets", "fonts");
const CSS = join(ROOT, "src", "styles", "tokens", "fonts.css");

const API = "https://fonts.googleapis.com/css2?family=Instrument+Sans:wdth,wght@75..100,400..700"
  + "&family=DM+Mono:wght@300;400;500&display=swap";

// Google serves woff2 only to a browser-shaped request; anything else gets ttf.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const HEADER = `/* Shiro webfonts, self-hosted.
 *
 * Instrument Sans - contemporary neo-grotesque, holds up at 11px in a data column.
 * DM Mono - the numeral face, real tabular figures.
 *
 * These were served from Google Fonts during design. They are vendored here
 * because the app has to render offline and the packaged CSP does not allow a
 * request to fonts.googleapis.com. Regenerate with tools/fetch-fonts.mjs.
 *
 * Only the latin and latin-ext subsets are included, and no italics: nothing in
 * the design system sets font-style, and a Cyrillic or CJK player name falls
 * back to the system stack. Both are the right trade against shipping several
 * hundred kilobytes for a handful of names.
 */
`;

const css = await (await fetch(API, { headers: { "User-Agent": UA } })).text();
const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*@font-face \{(.*?)\}/gs)];

mkdirSync(OUT, { recursive: true });
const out = [HEADER];
let bytes = 0;

for (const [, subset, body] of blocks) {
  if (subset !== "latin" && subset !== "latin-ext") continue;
  const pick = re => body.match(re)?.[1]?.trim();
  const family = pick(/font-family: '([^']+)'/);
  const style = pick(/font-style: (\S+);/);
  if (style === "italic") continue;
  const weight = pick(/font-weight: ([^;]+);/);
  const url = pick(/url\((https:\/\/[^)]+)\)/);
  const unicode = pick(/unicode-range: ([^;]+);/);

  const slug = `${family.toLowerCase().replace(/ /g, "-")}-${weight.replace(/ /g, "")}-${subset}`;
  const bin = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(join(OUT, `${slug}.woff2`), bin);
  bytes += bin.length;

  out.push(`/* ${subset} */
@font-face {
  font-family: '${family}';
  font-style: ${style};
  font-weight: ${weight};
  font-display: swap;
  src: url("../../assets/fonts/${slug}.woff2") format('woff2');
  unicode-range: ${unicode};
}`);
}

writeFileSync(CSS, out.join("\n") + "\n");
console.log(`${out.length - 1} faces, ${(bytes / 1024).toFixed(0)} KB`);
