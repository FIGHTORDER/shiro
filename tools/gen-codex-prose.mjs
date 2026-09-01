/**
 * Fetch the Codex's prose from the Zero-K wiki.
 *
 *   node tools/gen-codex-prose.mjs
 *   node tools/gen-codex-prose.mjs --check     # is anything missing prose?
 *
 * Writes `src/data/codex-prose.json`: a description per unit, keyed by the
 * unit's internal name, plus the attribution the licence requires.
 *
 * ## Why this is a separate file and a separate tool
 *
 * The licences differ, and that is not a detail. `codex.json` is read out of
 * the game the player already has. This is **Creative Commons
 * Attribution-ShareAlike**, per the wiki's own `rightsinfo`, so it has to
 * travel with attribution and a link back, and anything derived from it
 * inherits the same terms. Keeping the two apart means nobody has to work out
 * which half of a merged blob came from where.
 *
 * It is also the only part of the Codex that needs the network, and separating
 * it means regenerating stats after a game update does not depend on a wiki
 * being reachable.
 *
 * ## How units and pages are matched
 *
 * Not by name. The wiki declares the internal name itself: every unit page
 * carries
 *
 *     {{Autoinfobox zkunit
 *     | defname = cloakraid
 *     }}
 *
 * so `Glaive` and `cloakraid` are joined by the wiki's own statement rather
 * than by guessing at capitalisation. Pages are found through
 * `list=embeddedin` on that template, which is the wiki's own answer to "which
 * pages are unit pages" and needs no list maintained here.
 *
 * Prose is taken from the lead section - the text before the first heading -
 * because that is the part written to describe the unit rather than to discuss
 * it. Wiki markup is reduced to plain text; this deliberately does not render
 * wikitext, because a paragraph is all the design asks for and a renderer is a
 * dependency plus an injection surface.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const UNITS = join(ROOT, "src", "data", "codex.json");
const OUT = join(ROOT, "src", "data", "codex-prose.json");

const API = "https://zero-k.info/mediawiki/api.php";
const TEMPLATE = "Template:Autoinfobox_zkunit";
const check = process.argv.includes("--check");

async function api(params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: "json" })}`;
  const res = await fetch(url, { headers: { "User-Agent": "shiro-codex (zero-k lobby)" } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/** Every page that uses the unit infobox, which is the wiki's own unit list. */
async function unitPages() {
  const titles = [];
  let cont;
  do {
    const d = await api({
      action: "query", list: "embeddedin", eititle: TEMPLATE, eilimit: "500",
      ...(cont ? { eicontinue: cont } : {}),
    });
    for (const p of d.query?.embeddedin ?? []) titles.push(p.title);
    cont = d.continue?.eicontinue;
  } while (cont);
  return titles;
}

/** Wikitext for up to 50 titles at a time, which is the API's own batch limit. */
async function wikitext(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const d = await api({
      action: "query", prop: "revisions", rvprop: "content", rvslots: "main",
      titles: batch.join("|"),
    });
    for (const page of Object.values(d.query?.pages ?? {})) {
      const text = page.revisions?.[0]?.slots?.main?.["*"];
      if (text) out.set(page.title, text);
    }
  }
  return out;
}

/** The `defname` the infobox declares, which is the unit's internal name. */
function defname(text) {
  const m = text.match(/\{\{\s*Autoinfobox\s+zkunit[\s\S]*?\|\s*defname\s*=\s*([a-z0-9_]+)/i);
  return m ? m[1].toLowerCase() : undefined;
}

/** Wiki markup reduced to plain text. Not rendered - see the header. */
function plain(s, title) {
  // Before templates are dropped, or the unit's own name goes with them: the
  // lead sentence is written as "The '''{{PAGENAME}}''' is a ...".
  s = s.replace(/\{\{\s*PAGENAME\s*\}\}/gi, title);
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Innermost first, so a nested template does not leave a stray brace behind.
  for (let i = 0; i < 6 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, "");
  s = s.replace(/<ref[\s\S]*?<\/ref>/gi, "").replace(/<[^>]+>/g, "");
  /* Category and file links are filing instructions for the wiki, not text on
     the page - MediaWiki renders them as a footer strip and a picture, never
     inline. Unwrapping them like an ordinary link is why a unit's description
     used to trail off into "Category:Raiders". They go before the general
     unwrap, or that rule claims them first. */
  s = s.replace(/\[\[\s*(?:Category|File|Image|Media)\s*:[^\]]*\]\]/gi, "");
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1");
  s = s.replace(/'{2,}/g, "").replace(/^[*#:]+\s*/gm, "");
  return s.split("\n").map(l => l.trim()).filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
}

/**
 * The page split into its own sections.
 *
 * The wiki's headings already are the blocks the unit page wants - pages carry
 * `==Description==` and often `==Tactics==` - so this follows the wiki's
 * structure rather than imposing one. The lead is whatever comes before the
 * first heading: the one-line "what is this" sentence.
 *
 * Headings are split for *after* templates are removed, and without requiring a
 * newline in front. Pages put the infobox inline, so the markup really reads
 * `}}==Description==`, and a newline-anchored split silently returns the whole
 * page as one lead - which is what it did before this was fixed.
 */
function sections(text, title) {
  let s = text.replace(/\{\{\s*PAGENAME\s*\}\}/gi, title).replace(/<!--[\s\S]*?-->/g, "");
  for (let i = 0; i < 6 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, "");
  /* Pages write the infobox inline, so removing it leaves `....==Description==`
     mid-line and a line-anchored split would miss every heading on the page.
     One newline in front of a `==` run puts them back where they belong. */
  s = s.replace(/([^\n])(={2,})/g, "$1\n$2");

  /* One or more `=`, not two. The tactics section is a level-one heading -
     `= Tactics and Strategy =` - so a `={2,}` pattern skips the very section
     most worth having, which is what it did before this. */
  const parts = s.split(/^\s*=+\s*([^=\n]+?)\s*=+\s*$/m);
  const out = { summary: plain(parts[0] ?? "", title) };
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].trim().toLowerCase();
    const raw = parts[i + 1] ?? "";
    if (/^description$/.test(heading) && !out.description) {
      const body = plain(raw, title);
      if (body) out.description = body;
    } else if (/tactic|strateg/.test(heading) && !out.tactics) {
      /* Both orders occur: most pages say "Tactics and Strategy", Recluse says
         "Strategy and Tactics". Matching either word rather than a fixed phrase
         means a page that says only one of them still counts. */
      const points = bullets(raw, title);
      if (points.length) out.tactics = points;
    }
  }
  return out;
}

/**
 * A tactics section as separate points.
 *
 * The wiki writes these as paragraphs separated by blank lines, occasionally as
 * a `*` list. Either way each one is a self-contained piece of advice, and a
 * reference is read by scanning rather than by reading three hundred words of
 * continuous prose - so they come out as a list and the screen shows them as
 * one.
 */
function bullets(raw, title) {
  return raw
    .split(/\n\s*\n|\n(?=\s*[*#])/)
    .map(p => plain(p, title))
    .filter(p => p.length > 2);
}

// ---------------------------------------------------------------------- main ---

if (!existsSync(UNITS)) {
  console.error(`${UNITS} is missing - run tools/gen-codex.mjs first`);
  process.exit(1);
}
const units = JSON.parse(readFileSync(UNITS, "utf8")).units;
const known = new Set(units.map(u => u.id));

if (check) {
  if (!existsSync(OUT)) { console.error(`${OUT} is missing - run: node tools/gen-codex-prose.mjs`); process.exit(1); }
  const have = JSON.parse(readFileSync(OUT, "utf8"));
  const missing = units.filter(u => !have.prose[u.id]).length;
  console.log(`prose for ${Object.keys(have.prose).length} units; ${missing} of ${units.length} have none`);
  process.exit(0);
}

console.log(`asking the wiki which pages are unit pages`);
const titles = await unitPages();
console.log(`  ${titles.length} pages use ${TEMPLATE}`);

console.log(`fetching wikitext`);
const texts = await wikitext(titles);
console.log(`  ${texts.size} pages read`);

const prose = {};
let unmatched = 0;
for (const [title, text] of texts) {
  const id = defname(text);
  if (!id) { unmatched++; continue; }
  /* A page whose defname is not a unit in this game build is not an error: the
     wiki outlives any one version, and it documents things that have been
     removed. It is simply not ours to show. */
  if (!known.has(id)) continue;
  const parts = sections(text, title);
  if (!parts.summary && !parts.description) continue;
  prose[id] = { title, ...parts };
}

const dataset = {
  formatVersion: 1,
  source: "https://zero-k.info/mediawiki/",
  // Required by the licence, and shown in the interface rather than buried here.
  licence: "CC BY-SA",
  licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  prose,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(dataset, null, 1)}\n`, "utf8");
const covered = units.filter(u => prose[u.id]).length;
console.log(`wrote ${OUT}`);
console.log(`  ${covered} of ${units.length} units have prose`);
if (unmatched) console.log(`  ${unmatched} pages carried no defname and were skipped`);
