/**
 * Drives the browser demo - the path a plain `npm run dev` shows, with no
 * Tauri and no server behind it.
 *
 * Worth its own runner because the live suite injects a fake Tauri and so never
 * touches this branch: the demo room once crashed on a live-only field, the
 * demo Start button once did nothing, and neither showed up in a green
 * test:e2e. The click-through is a documented supported mode.
 *
 *   npm run dev            # in another shell
 *   npm run test:demo
 *
 * Exits non-zero on the first failed check or any uncaught page error.
 */
import { chromium } from "playwright-core";

const URL = process.env.SHIRO_URL || "http://localhost:1420/";
const SHOTS = process.env.SHIRO_SHOTS;

const failures = [];
const errors = [];
let checks = 0;

function check(name, ok, detail) {
  checks++;
  if (ok) console.log("  ok   " + name);
  else { console.log("  FAIL " + name + (detail ? " - " + detail : "")); failures.push(name); }
}

async function launch() {
  if (process.env.CHROMIUM_PATH) {
    return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  }
  for (const channel of ["msedge", "chrome", "chromium"]) {
    try { return await chromium.launch({ channel }); } catch { /* try the next */ }
  }
  console.error("No browser found. Set CHROMIUM_PATH, or install Edge or Chrome.");
  process.exit(2);
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
process.on("uncaughtException", err => {
  console.log("\nthe run stopped: " + err.message.split("\n")[0]);
  for (const e of errors) console.log("  " + e);
  process.exit(1);
});
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
page.on("console", m => {
  const t = m.text();
  if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push("CONSOLE: " + t.slice(0, 300));
});

const text = () => page.locator("body").innerText();
/* The nav by name, not by position.
   Every one of these used to be `nav button").nth(N)`, which meant inserting a
   screen silently re-pointed a dozen assertions at the wrong one - and they
   failed somewhere else entirely, minutes later. IconButton sets an aria-label
   from its `label`, so the accessible name is already there to use. */
const nav = name => page.getByRole("navigation").getByRole("button", { name }).click();

const seeing = async re => new RegExp(re.source, re.flags.includes("i") ? re.flags : re.flags + "i")
  .test(await text());
const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const clickText = (re, opts) => page.getByRole("button", { name: re }).first().click(opts);
async function waitFor(fn, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeout) return false;
    await page.waitForTimeout(150);
  }
}

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);

console.log("login");
check("the demo says it is the demo", await seeing(/demo click-through/));
await page.locator("input").nth(0).fill("Shadowfury");
await page.locator("input").nth(1).fill("anything");
await page.keyboard.press("Enter");
check("any credentials get in", await waitFor(() => seeing(/Teams 8v8/)));
/* Full rooms and the marks beside a name are derived from the fixtures the
   same way the live path derives them, so the demo shows the real thing. */
const badgeSaying = label => page.evaluate(l => [...document.querySelectorAll("span")]
  .some(el => el.textContent.trim() === l), label);
check("a full room is marked full", await badgeSaying("FULL"));
check("and one over its cap says by how much", await badgeSaying("FULL +2"));

/* The news strip. The fixture is raw wire shapes put through the same adapter
   the live path uses, so this is the real normalisation and not a tidier
   version of it - including the item whose picture is the bare site URL,
   which is how the server says "no picture". */
check("the news the server sends is on screen",
  await waitFor(() => seeing(/Summer 1v1 tournament/)));
check("including an item that is a headline and nothing else",
  await seeing(/Map contest results are up/));
const demoNewsImages = () => page.evaluate(() => [...document.querySelectorAll("img")]
  .map(i => i.getAttribute("src")).filter(s => /zero-k\.info/.test(s || "")));
check("its picture is asked for over TLS, which is all the CSP allows",
  (await demoNewsImages()).includes("https://zero-k.info/img/lobbynews/1.png"));
check("and an item with no picture does not ask for the site's front page",
  !(await demoNewsImages()).some(s => /^https?:\/\/zero-k\.info\/?$/.test(s)));

await shot("demo-01-battles");

/* A map whose picture 404s must not poison the ones after it.
   New maps genuinely 404 - the design calls that a state, not a fault - and
   the failure used to latch: the placeholder replaced the <img> entirely, so
   the effect that clears the failure on a new src had no element to ask and
   never ran. One missing picture and every map picked afterwards showed the
   placeholder until the screen was rebuilt.

   Scoped tightly: the route goes on for this check and comes straight back
   off, so nothing after it is looking at a half-broken site. */
{
  let firstMinimap = null;
  const only404TheFirst = route => {
    const url = route.request().url();
    if (firstMinimap === null) firstMinimap = url;
    return url === firstMinimap
      ? route.fulfill({ status: 404, body: "no" })
      : route.continue();
  };
  await page.route("**/Resources/*.minimap.jpg", only404TheFirst);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("input").nth(0).fill("Shadowfury");
  await page.locator("input").nth(1).fill("anything");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);

  const shown = () => page.evaluate(() => {
    const img = [...document.querySelectorAll("img")].find(x => /minimap/.test(x.src));
    return Boolean(img && img.naturalWidth > 0 && getComputedStyle(img).opacity === "1");
  });
  /* The designed state: the name in place of the picture. True of both the
     broken and the fixed component - it is the check below that catches the
     latch, and this one is here so a fix that simply stopped drawing the
     placeholder could not pass. */
  check("a missing picture is shown as the map's name",
    await waitFor(() => page.evaluate(() =>
      [...document.querySelectorAll("span")].some(el => /Argent[ _]Strata/i.test(el.textContent)))));

  // Pick a different battle, whose picture is not blocked.
  await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img[src*='thumbnail']")];
    (imgs[1] || imgs[0]).closest("div").click();
  });
  check("and the next map still shows its own", await waitFor(shown));
  await page.unroute("**/Resources/*.minimap.jpg", only404TheFirst);
}

console.log("maps");
await nav("Maps");
/* Cards, not rows. Every card carries the map's name as a title attribute -
   which is also what shows the full name when the card truncates it - so the
   grid can be read in order without a test-only hook. */
const cards = () => page.locator("div[title]");
check("the map list shows Zero-K's maps",
  await waitFor(() => seeing(/Comet Catcher Redux/)));
check("as a grid of minimaps rather than a list of names",
  await cards().count() >= 10
  && await page.evaluate(() => {
    const grid = [...document.querySelectorAll("div")]
      .find(d => getComputedStyle(d).display === "grid" && d.children.length > 6);
    return Boolean(grid) && getComputedStyle(grid).gridTemplateColumns.split(" ").length > 1;
  }));
/* The whole point of widening the parser, and the whole point of the rename
   that made the widening arrive: the catalogue was already carrying these and
   the client was reading two fields out of sixteen - then spelling twelve of
   the sixteen wrong on the way out. */
check("with the size and the rating the catalogue already knew",
  await seeing(/12 \u00d7 16/) && await seeing(/4\.5/));
check("the rating reads as a score out of five, not a bare number",
  await page.locator('[role="img"][aria-label*="out of 5"]').count() > 5);
check("and the votes behind it are next to it, because four and forty differ",
  await seeing(/\(46\)/) && await seeing(/\(25\)/));
check("a map nobody has rated says so rather than showing a zero",
  await seeing(/UNRATED/));
/* The owner could not read "hills: 3" and neither can Zero-K's own site, which
   documents neither number. Still parsed, deliberately not drawn. */
check("hills and water level are not on screen", !(await seeing(/\bhills\b/)));
check("the screen says which set of maps this is",
  await seeing(/displaying featured maps/i) && await seeing(/11 maps/i));

/* Best rated first - and "best" has to mean something a single vote cannot
   buy. FrostyCove is five out of five from one person; Ravaged is 4.48 from
   twenty-five. The plain mean puts FrostyCove first, which is what "sort by
   does not work" would have looked like once the scores arrived at all. */
check("the best rated map is at the top, and one lucky vote does not win it",
  (await cards().first().getAttribute("title")) === "Ravaged_v2");
{
  const sort = page.getByLabel(/Sort by/i);
  await sort.selectOption("name");
  check("sorting by name reorders the grid",
    await waitFor(async () => (await cards().first().getAttribute("title")) === "Aberdeen3v3v3"));
  await sort.selectOption("size");
  check("and sorting by size puts the biggest first",
    await waitFor(async () => (await cards().first().getAttribute("title")) === "Small Supreme Battlefield V2"));
  await sort.selectOption("rating");
}
{
  /* Drawn for. Every one of these was empty before the rename, so every
     tickbox matched nothing and the column had no content to align. */
  check("drawn for has content on the cards", await seeing(/TEAMS/));
  /* The one player count the catalogue publishes. It is only sent for FFA maps
     - 40 of the 343 - so a teams map says nothing rather than guessing 8v8 out
     of its dimensions. */
  check("and how many sides an FFA map is drawn for", await seeing(/3-way FFA/));
  /* The prose row that spelled this out is gone - the badges were already
     saying it, and saying it twice was the complaint. The badges are what has
     to keep working. */
  await page.locator('div[title="Aberdeen3v3v3"]').click();
  check("the detail badges say what the map is drawn for",
    await waitFor(() => seeing(/3-way FFA/)));
  await page.locator('div[title="hotstepper"]').click();
  /* Scoped to the detail panel: every card in the grid carries its own badges,
     so asserting a badge is absent from the page says nothing at all. `detail`
     reads only the column the selection drives. */
  const detail = () => page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")]
      .find(b => b.textContent.trim() === "Host on this map");
    let el = btn;
    while (el && !el.textContent.includes("SIZE")) el = el.parentElement;
    return el ? el.textContent : "";
  });
  check("and changes with the map that is picked",
    await waitFor(async () => /8 × 8/.test(await detail())));
  await page.locator('div[title="Castel_godsV21"]').click();
  check("a map flagged for nothing simply has no kind badges",
    await waitFor(async () => {
      const d = await detail();
      return d.includes("Castel_godsV21") && !/FFA|1v1|Teams|Chickens/.test(d);
    }));
  // Dispatched, not clicked: the design system's checkbox is a 0x0 input.
  const chickens = () => page.getByLabel(/^Chickens$/);
  await chickens().dispatchEvent("click");
  check("ticking a kind actually filters the grid",
    await waitFor(async () => (await cards().count()) === 2
      && !(await seeing(/Ravaged_v2/))));
  check("and says how much of the set is left", await seeing(/2 of 11 maps/i));
  await chickens().dispatchEvent("click");
  await waitFor(async () => (await cards().count()) > 2);
}
{
  const box = page.getByLabel(/Find a map/i);
  await box.fill("chicken");
  check("searching narrows the list",
    await waitFor(() => seeing(/Chicken Nuggets/)) && !(await seeing(/Comet Catcher/)));
  /* The browser demo has no Tauri behind it, so the fall-through to Zero-K's
     live search cannot run here - and the screen has to say that rather than
     report a search it never made as having found nothing. */
  await box.fill("zzzznotamap");
  check("a miss says the featured set is not every map",
    await waitFor(() => seeing(/needs the desktop app/)));
  await box.fill("");
  await waitFor(async () => (await cards().count()) > 2);
}
// Whichever card is picked is the one the button acts on, so pick one first.
await cards().first().click();
const top = await cards().first().getAttribute("title");
await clickText(/^Host on this map$/);
check("hosting from a map fills the map in for you",
  await waitFor(() => page.evaluate(
    name => [...document.querySelectorAll("input")].some(i => i.value === name), top)));
/* Back to the battle list, and shut the dialog on the way. The demo has no
   dialog helper of its own, and Cancel is ambiguous while the host dialog and
   the screen behind it are both mounted. */
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].reverse()
    .find(x => x.textContent.trim() === "Cancel");
  b && b.click();
});
await page.waitForTimeout(400);
await shot("demo-02-maps");

// Back to the list, which is where the rest of the click-through starts from.
await nav("Battles");
await waitFor(() => seeing(/Host a battle/));

console.log("battle room");
await clickText(/^Join room$/);
check("the demo room opens rather than throwing",
  await waitFor(() => seeing(/ROOM CHAT/)));
check("and it is the demo room", await seeing(/Shadowfury/));
check("the room names whoever is still downloading",
  await seeing(/Waiting on lorelei, vexatiousmachinist/));
/* The room is the one screen you always reach having just seen its map in
   the list, so it is the one screen whose picture is always already in hand
   - and the only screen the minimap was reported black on. Present is not
   the same as visible here: the picture is drawn transparent until it is
   known to have arrived, so ask what is on screen, not what is in the DOM. */
check("the room's minimap is visible, not a black panel", await waitFor(() =>
  page.evaluate(() => {
    const i = [...document.querySelectorAll("img")].find(x => /minimap/.test(x.src));
    return !!i && i.naturalWidth > 0 && getComputedStyle(i).opacity === "1";
  })));
await shot("demo-02-room");

/* The picker is the one place the browser has nothing to read: the AI list
   comes off the install, and there is no install here. It has to offer Zero-K's
   own AIs anyway - an empty picker would be worse than the single hardcoded CAI
   this replaced - and it has to say the list is a guess. */
console.log("the AI picker with no install behind it");
await clickText(/Add AI/);
check("the picker opens in the demo too", await waitFor(() => seeing(/Add an AI to team/)));
check("with Zero-K's own AIs in it", await seeing(/CAI/) && await seeing(/Chicken/));
check("and says the list is built in rather than read",
  await seeing(/built-in list/));
await page.getByRole("button", { name: /^Cancel$/ }).last().click();
check("and closes again", await waitFor(async () => !(await seeing(/Add an AI to team/))));

console.log("the click-through ends where it should");
await clickText(/^Start game$/);
check("Start runs the fake launch", await waitFor(() => seeing(/Launching/)));
check("and lands on the debriefing", await waitFor(() => seeing(/Victory|Defeat/), 6000));
await shot("demo-03-debrief");

console.log("every screen");
/* Every screen in turn, by position rather than by name - the point of this
   one is to walk whatever is there, including anything added since. */
const rail = page.locator("nav button");
const n = await rail.count();
for (let i = 0; i < n; i++) {
  await rail.nth(i).click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(350);
}
check("no screen threw on the way round", errors.length === 0, errors[0]);
await shot("demo-04-final");

console.log("");
console.log(`${checks - failures.length}/${checks} checks passed`);
if (errors.length) {
  console.log("page errors:");
  for (const e of errors) console.log("  " + e);
}
await browser.close();
process.exit(failures.length || errors.length ? 1 : 0);
