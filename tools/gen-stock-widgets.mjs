#!/usr/bin/env node
/**
 * Generates src-tauri/src/stock_widgets.txt - every widget filename Zero-K
 * ships in LuaUI/Widgets.
 *
 *   node tools/gen-stock-widgets.mjs
 *   node tools/gen-stock-widgets.mjs --check   # fail if it is out of date
 *
 * Why this list has to exist. Zero-K's widget handler picks its VFS mode from
 * LuaUI/Config/ZK_data.lua (cawidgets.lua:110-124), and the two lines that read
 * it are:
 *
 *     localWidgetsFirst = cadata["Local Widgets Config"].useLocalWidgetsFirst or true
 *     localWidgets      = cadata["Local Widgets Config"].useLocalWidgets or true
 *
 * `false or true` is true in Lua, so once that table exists both flags are on
 * whatever they are set to. VFSMODE is therefore RAW_FIRST, and a raw file in
 * LuaUI/Widgets *replaces* the packaged widget of the same name. VFS.ZIP_FIRST,
 * the mode where the archive would win, is unreachable through config.
 *
 * So there is no engine-level protection against an add-on shadowing a stock
 * widget. This list is the only guard, which is why it is generated rather than
 * hand-kept, and why installing a file we cannot check is refused outright.
 *
 * Staleness only cuts one way: a widget Zero-K adds after this was generated
 * would not be blocked. Re-run it when bumping the supported game version.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const OUT = new URL("../src-tauri/src/stock_widgets.txt", import.meta.url);
const API = "https://api.github.com/repos/ZeroK-RTS/Zero-K/git/trees/master?recursive=1";
const PREFIX = "LuaUI/Widgets/";

const headers = { "User-Agent": "shiro-gen-stock-widgets" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const res = await fetch(API, { headers });
if (!res.ok) {
  console.error(`could not read the Zero-K tree: ${res.status} ${res.statusText}`);
  process.exit(2);
}
const { tree, truncated } = await res.json();
/* A truncated tree would silently shorten the block list, which is the one
   failure mode that matters here. */
if (truncated) {
  console.error("GitHub truncated the tree; the list would be incomplete");
  process.exit(2);
}

const names = tree
  .filter(e => e.type === "blob" && e.path.startsWith(PREFIX) && e.path.endsWith(".lua"))
  .map(e => e.path.slice(PREFIX.length))
  .sort();

if (names.length < 300) {
  console.error(`only ${names.length} widgets found; refusing to write a short list`);
  process.exit(2);
}

const text = names.join("\n") + "\n";

if (process.argv.includes("--check")) {
  const have = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (have !== text) {
    console.error("stock_widgets.txt is out of date - run node tools/gen-stock-widgets.mjs");
    process.exit(1);
  }
  console.log(`stock widget list is current (${names.length} widgets)`);
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${names.length} widget names`);
}
