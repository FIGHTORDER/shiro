/**
 * Drives the live (Tauri) code paths against tools/e2e/fake-server.js.
 *
 * These paths are the ones a plain `npm run dev` never reaches, so without this
 * the store wiring is only verified by unit tests.
 *
 *   npm run dev            # in another shell
 *   npm run test:e2e
 *
 * It drives a browser you already have rather than downloading one - hence
 * playwright-core and a channel - because the app ships against WebView2 and
 * every machine that can build it has Edge. Override with CHROMIUM_PATH.
 *
 * Exits non-zero on the first failed check or any uncaught page error.
 *
 * The login it performs is against tools/e2e/fake-server.js, not zero-k.info,
 * so any password will do and the one below is a placeholder. It is read from
 * the environment because a real credential written into a file here is a real
 * credential published to everyone who can read the repo - which is exactly
 * what happened once already, and cost a password change.
 *
 *   SHIRO_E2E_PASS=whatever npm run test:e2e
 */
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = process.env.SHIRO_URL || "http://localhost:1420/";
/* The name is fixture data: tools/e2e/fake-server.js keys its canned replies on
   it, and a lobby name is public anyway. The password is not fixture data and
   has no business being written down - the fake server accepts anything, so
   this default is a placeholder, and a real one belongs in the environment. */
const USER = process.env.SHIRO_E2E_USER || "Qrow";
const PASS = process.env.SHIRO_E2E_PASS || "not-a-real-password";
const SHOTS = process.env.SHIRO_SHOTS;

const failures = [];
const errors = [];
let checks = 0;

function check(name, ok, detail) {
  checks++;
  if (ok) console.log("  ok   " + name);
  else { console.log("  FAIL " + name + (detail ? " - " + detail : "")); failures.push(name); }
}

/* An explicit binary wins; otherwise try the browsers a dev machine has, in
   the order they are likely to be there. */
async function launch() {
  if (process.env.CHROMIUM_PATH) {
    return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  }
  const tried = [];
  for (const channel of ["msedge", "chrome", "chromium"]) {
    try {
      return await chromium.launch({ channel });
    } catch (e) {
      tried.push(`${channel}: ${String(e.message).split("\n")[0]}`);
    }
  }
  console.error("No browser found. Set CHROMIUM_PATH, or install Edge or Chrome.");
  for (const t of tried) console.error("  " + t);
  process.exit(2);
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
process.on("uncaughtException", err => {
  console.log("\nthe run stopped: " + err.message.split("\n")[0]);
  const where = (err.stack || "").split("\n").find(l => l.includes("live.mjs"));
  if (where) console.log("  at" + where.split("at")[1]);
  if (errors.length) {
    console.log("page errors:");
    for (const e of errors) console.log("  " + e);
  }
  process.exit(1);
});

page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
page.on("console", m => {
  const t = m.text();
  if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push("CONSOLE: " + t.slice(0, 300));
});

await page.addInitScript({ path: join(HERE, "fake-server.js") });
await page.goto(URL, { waitUntil: "domcontentloaded" });

const text = () => page.locator("body").innerText();
/* The nav by name, not by position.
   Every one of these used to be `nav button").nth(N)`, which meant inserting a
   screen silently re-pointed a dozen assertions at the wrong one - and they
   failed somewhere else entirely, minutes later. IconButton sets an aria-label
   from its `label`, so the accessible name is already there to use. */
const nav = name => page.getByRole("navigation").getByRole("button", { name }).click();

const shot = async name => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png") }); };
const sent = () => page.evaluate(() => window.__ZKS.sent);
const sentAny = async re => (await sent()).some(l => re.test(l));
/* Assertions that look at the whole log can pass on something an earlier step
   sent. `mark()` scopes them to one step. */
const mark = async () => (await sent()).length;
const sentSince = async (from, re) => (await sent()).slice(from).some(l => re.test(l));
const clickText = async (re, opts) => page.getByRole("button", { name: re }).first().click(opts);
/* Dialogs render after the screen, so the last match is the one on top - the
   battle list keeps its own "Join" buttons alive behind the scrim. */
const clickDialog = async (re, opts) => page.getByRole("button", { name: re }).last().click(opts);
/* Several labels are uppercased by CSS, and innerText returns the transformed
   text, so every text assertion here is case-insensitive. */
const seeing = async re => new RegExp(re.source, re.flags.includes("i") ? re.flags : re.flags + "i")
  .test(await text());
/* Badges are short words that read as substrings of ordinary copy, so "Full"
   has to be matched as a whole label rather than found in the page text. */
const badgeSaying = label => page.evaluate(l => [...document.querySelectorAll("span")]
  .some(el => el.textContent.trim() === l), label);
/* The marks `PlayerRow` draws beside one name. The kick control in the same row
   is also a cross, so only icons outside a button are the row's own. */
const marksBeside = name => page.evaluate(n => {
  const row = [...document.querySelectorAll("div")].find(d =>
    (d.getAttribute("style") || "").includes("--row-default") && d.textContent.includes(n));
  if (!row) return null;
  return [...row.querySelectorAll("i[data-lucide]")]
    .filter(i => !i.closest("button")).map(i => i.getAttribute("data-lucide"));
}, name);
/* The design kit wraps its <select> in the <label>, so the accessible name is
   the label text *plus every option* - `getByLabel("Game")` never matches.
   Find the select by an option only it has. */
const selectWith = optionLabel => page.locator("select")
  .filter({ has: page.locator(`option:text-is("${optionLabel}")`) });
/* The rating strip on either screen, as label -> {value, note}. Read from the
   DOM rather than from the page text because a rating is a number under a
   label and both screens have several, and "1790 is on the page somewhere" is
   not the same claim as "the matchmaker tile says 1790". */
const ratingTiles = () => page.evaluate(() => {
  const isLabel = t => /^(GENERAL ELO|MATCHMAKER|PLANETWARS|1V1)$/.test(t.trim().toUpperCase());
  const out = {};
  for (const el of document.querySelectorAll("span")) {
    if (!isLabel(el.textContent)) continue;
    const value = el.nextElementSibling;
    /* The friends panel lays the tiles out in one grid, so the element after a
       value is the next tile's label rather than a note. */
    const after = value && value.nextElementSibling;
    out[el.textContent.trim().toUpperCase()] = {
      value: value ? value.textContent.trim() : "",
      note: after && !isLabel(after.textContent) ? after.textContent.trim() : "",
    };
  }
  return out;
});
async function waitFor(label, fn, timeout = 6000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeout) return false;
    await page.waitForTimeout(150);
  }
}

console.log("registering");
await clickText(/Create an account/);
check("the account dialog opens", await waitFor("reg", () => seeing(/Create an account/)));
/* The login screen is still mounted behind the dialog, so its fields come
   first; the dialog's are the last ones. */
await page.getByLabel(/Account name/).last().fill("shiro-taken");
const pwFields = page.locator("input[type=password]");
const pwCount = await pwFields.count();
await pwFields.nth(pwCount - 2).fill("hunter2");
await pwFields.nth(pwCount - 1).fill("hunter2");
await page.waitForTimeout(200);
await clickDialog(/^Create account$/);
check("a name the server refuses is reported, not swallowed",
  await waitFor("taken", () => seeing(/name is taken/)));
await clickDialog(/^Cancel$/);
check("cancelling returns to the login screen",
  await waitFor("backtologin", () => seeing(/Steam accounts need a lobby password/)));

console.log("login");
await page.locator("input").nth(0).fill(USER);
await page.locator("input").nth(1).fill(PASS);
await page.keyboard.press("Enter");
check("login handshake reaches the battle list",
  await waitFor("battles", () => seeing(/Teams 8v8 - all welcome/)));
check("Login was sent with our name",
  await sentAny(new RegExp(`^Login \\{.*"Name":"${USER}"`)));
check("the status bar shows the server's numbers", await seeing(/100 online/));

/* Busiest first, spectators counted. The running 12-player game is the busiest
   room on this server, so it leads - and the default selection deliberately
   skips it, because joining is the point of this screen and you cannot
   join a game already under way. */
check("the busiest room leads the list",
  await waitFor("order", async () => {
    // 12 players running, versus 9 players and 2 spectators.
    const [first, second] = await page.evaluate(() => {
      const t = document.body.innerText;
      return [t.indexOf("running match"), t.indexOf("Teams 8v8")];
    });
    return first >= 0 && second >= 0 && first < second;
  }));
/* The primary button says "Join room" whatever is selected, so its label no
   longer reveals which room that is. The selected one is the room whose title
   appears twice: once in the list, once in the detail panel beside it. */
check("but the default selection is a room you can actually join",
  await waitFor("default-selection", async () => {
    const seen = await page.evaluate(() =>
      (document.body.innerText.match(/Teams 8v8 - all welcome/g) || []).length);
    return seen >= 2;
  }));

/* Asked once, after logging in: an existing install should be named rather
   than silently used, and a missing one offered here rather than in a Settings
   section nobody opens. */
check("the first run says whether Zero-K was found",
  await waitFor("first-run", () => seeing(/Zero-K is already here|Zero-K is not installed/)));
await clickText(/Good to go|Not now/);
check("and it goes away when dismissed",
  await waitFor("first-run-gone", async () => !(await seeing(/Zero-K is already here/))));

/* A room you cannot get into used to look exactly like one you can: the count
   greys out and nothing else changes. There is no waitlist in the protocol to
   show instead - `ProcessPlayerJoin` refuses only a password or a kick, and a
   full room is answered by silently spectating whoever arrives - so what the
   list can honestly say is which rooms those are, and what joining one costs. */
console.log("rooms you cannot get into");
check("a room at its cap is marked full", await waitFor("full-badge", () => badgeSaying("FULL")));
await page.getByText(/^full house$/).first().click();
check("and says what joining it actually does",
  await waitFor("full-copy", () => seeing(/Joining makes you a spectator/)));
check("without promising a queue that does not exist", await seeing(/whoever takes it first/));

/* Over the cap, which only a time-queue room can be. The overflow is the
   nearest thing to a waitlist the server has, so it is shown as what it is. */
await page.getByText(/^queue for a slot$/).first().click();
check("a room over its cap says how many are past it",
  await waitFor("queue-badge", () => badgeSaying("FULL +2")));
check("and what the time queue will do to them",
  await seeing(/2 past the cap/) && await seeing(/moved to the spectators/));

/* The filter strip could hide running and passworded rooms but not the ones
   with no room in them, which is the same question. */
// The box itself is a zero-size input behind the label, as everywhere here.
const hideFull = () => page.getByLabel("Hide full");
await hideFull().dispatchEvent("click");
check("hiding full rooms takes them out of the list",
  await waitFor("hide-full", async () => !(await seeing(/queue for a slot/))));
await hideFull().dispatchEvent("click");
check("and unhiding brings them back",
  await waitFor("show-full", () => seeing(/queue for a slot/)));

// Put the selection back where the rest of this run expects to find it.
await page.getByText(/^Teams 8v8 - all welcome$/).first().click();

/* Lobby news, which the server has always pushed on connect and which used to
   land in the store's `unhandled` counter and go no further. */
console.log("news");
check("the news the server sent on connect is on screen",
  await waitFor("news", () => seeing(/Cloakbots rebalanced in v1\.14\.9\.0/)));
check("including an item that is a headline and nothing else",
  await seeing(/Map contest results are up/));
/* Two pictures were sent and only one of them is a picture: an item with no
   image still carries the field, because the server interpolates a null
   relative path into the site URL and gets the site URL. */
const newsImages = () => page.evaluate(() => [...document.querySelectorAll("img")]
  .map(i => i.getAttribute("src")).filter(s => /lobbynews|zero-k\.info\/?$/.test(s || "")));
check("its picture is asked for over TLS, which is all the CSP allows",
  await waitFor("news-img", async () =>
    (await newsImages()).includes("https://zero-k.info/img/lobbynews/1.png")));
check("and an item with no picture does not ask for the site's front page",
  !(await newsImages()).some(s => /^https?:\/\/zero-k\.info\/?$/.test(s)));

/* A link in the strip has to leave through the opener. An anchor without a
   target navigates the webview and replaces the app with a web page, which
   there is no way back from. */
await page.getByRole("link", { name: /Cloakbots rebalanced/ }).first().click();
check("a news item opens in the browser, not in the app",
  await waitFor("news-open", async () =>
    (await page.evaluate(() => window.__ZKS.opened)) === "https://zero-k.info/Forum/Thread/32123"));
check("and the app is still on the battle list", await seeing(/Host a battle/));

await shot("live-01-battles");

/* The Maps screen on the Tauri path, which is the only place two things can be
   seen at all: the catalogue arriving as an object the client can read, and the
   fall-through to a live search when the curated set has nothing.

   The browser demo covers the layout; what is here is the wiring. Every field
   below `name` reached this screen as `undefined` on the day it shipped,
   because `CatalogueMap` went out in snake_case to a client reading camelCase -
   and the mock in fake-server.js was written in the shape the client wanted, so
   this suite was green the whole time. It is spelled the way Rust spells it
   now, and zkcontent.rs asserts the spelling at the other end. */
console.log("maps");
await nav("Maps");
const mapCards = () => page.locator("div[title]");
check("the catalogue arrives with what it knows about each map",
  await waitFor("maps", () => seeing(/TartarusV7/))
  && await seeing(/16 × 16/) && await seeing(/12 × 16/));
check("including the flags, which decide what the screen can say",
  await seeing(/3-way FFA/) && await seeing(/MM/));
check("and the screen says which set of maps this is",
  await seeing(/displaying featured maps/i));
{
  /* Not in the catalogue's three, so the screen asks Zero-K about the rest of
     the library rather than saying the map does not exist. */
  const box = page.getByLabel(/Find a map/i);
  await box.fill("reloaded");
  check("a map outside the featured set is still found, by searching",
    await waitFor("hits", () => seeing(/Comet Catcher Reloaded/), 9000));
  check("and is marked as the thinner answer it is",
    await seeing(/found by search/i) && await seeing(/no size or rating/i));
  await box.fill("");
  await waitFor("back", async () => (await mapCards().count()) === 3);
}
/* The id is what makes a map link reach the map. It has been arriving as
   `undefined` since the field was added, so every link in the app - here, the
   battle list, the room, the debriefing - has silently been a site search. */
check("a map's picture links to its own page, not to a search",
  (await page.locator('a[title^="Open "]').first().getAttribute("href"))
    === "https://zero-k.info/Maps/Detail/4242");
await shot("live-02-maps");

await nav("Battles");
await waitFor("back-to-battles", () => seeing(/Host a battle/));

console.log("battle room");
await clickText(/^Join room$/);
check("JoinBattle went out", await waitFor("join", () => sentAny(/^JoinBattle /)));
check("the roster arrives", await waitFor("roster", () => seeing(/CAI-Brutal/)));
check("spectators are separated from players", await seeing(/SPECTATORS/) && await seeing(/lorelei/));
check("mod options render", await seeing(/commshare/));
/* Having the map is something the room has to be told. CmdStart gathers
   everyone whose status is not Synced, announces them as "still downloading
   the map" to the whole room, and delays the start by ten seconds - so a
   client that never sends this is named every single game. */
/* The map link reaches the map, not a search. `?name=` is ignored by
   zero-k.info - a real map, a nonsense one and an empty one all return a
   byte-identical page - so the detail page needs the numeric ResourceID, which
   the site's own catalogue supplies. */
check("the map links to its own page rather than a search",
  await waitFor("maplink", async () => {
    const href = await page.locator('a[title^="Open "]').first().getAttribute("href");
    return href && /\/Maps\/Detail\/55646$/.test(href);
  }));

check("we tell the room we have the map",
  await waitFor("synced", () => sentAny(/^UpdateUserBattleStatus \{.*"Sync":1/)));

/* And the other half, so this is not a client that simply always claims to be
   ready: a map we do not have is reported as unsynced, which is what makes the
   server's warning name the people it is actually about. */
await page.evaluate(() => {
  window.__ZKS.missing = [{ kind: "map", name: "Nobody Has This v1" }];
});
const beforeUnsync = await mark();
await page.evaluate(() => window.__ZKS.push("BattleUpdate " + JSON.stringify({
  Header: { BattleID: 11, Map: "Nobody Has This v1" },
})));
check("and say so when we do not",
  await waitFor("unsynced", () => sentSince(beforeUnsync, /^UpdateUserBattleStatus \{.*"Sync":2/)));

/* And the other half of *that*: once the download finishes we have the map, and
   the room has to be told again. `fetch()` resolves when the job is queued, not
   when it is done, so this used to re-check against the state before the
   download - reporting Unsynced and then never revisiting it, which left the
   one player who actually downloaded the map named as unready all game. */
const beforeResync = await mark();
await page.evaluate(() => {
  window.__ZKS.missing = [{ kind: "map", name: "Slowly Arriving v2" }];
});
await page.evaluate(() => window.__ZKS.push("BattleUpdate " + JSON.stringify({
  Header: { BattleID: 11, Map: "Slowly Arriving v2" },
})));
check("a missing map is fetched",
  await waitFor("fetching", () => page.evaluate(() => Boolean(window.__ZKS.lastJobId))));
// The download lands: the map is there now, and the job reports done.
await page.evaluate(() => {
  window.__ZKS.missing = [];
  window.__ZKS.emitContent({ kind: "finished", id: window.__ZKS.lastJobId, outcome: "ok" });
});
check("and once it lands we say so, without waiting for a rejoin",
  await waitFor("resynced", () => sentSince(beforeResync, /^UpdateUserBattleStatus \{.*"Sync":1/)));
await page.evaluate(() => { window.__ZKS.missing = []; });

/* The other side of the same field: what the room shows about everybody else.
   The roster arrives carrying no Sync at all, which is Unknown - not a claim
   that anyone lacks the map, but still exactly the set CmdStart gathers. */
const waitingOn = () => page.evaluate(() => {
  const m = document.body.innerText.match(/Waiting on ([^\n]+)/);
  return m ? m[1] : "";
});
check("a roster that has never reported is still what !start would name",
  await waitFor("waiting-unknown", () => seeing(/Waiting on hexed, Qrow/)));
check("and wears the quiet mark for it rather than a cross",
  (await marksBeside("hexed")).includes("download"));

await page.evaluate(() => {
  window.__ZKS.push('UpdateUserBattleStatus {"Name":"Qrow","Sync":1}');
  window.__ZKS.push('UpdateUserBattleStatus {"Name":"hexed","Sync":1}');
});
check("once everyone has reported, nobody is holding the start up",
  await waitFor("all-synced", () => seeing(/Everyone has the map/)));
check("and a player who has the map carries no mark at all",
  !(await marksBeside("hexed")).some(i => i === "x" || i === "download"));

await page.evaluate(() =>
  window.__ZKS.push('UpdateUserBattleStatus {"Name":"hexed","Sync":2}'));
check("someone who says they have not got it is named",
  await waitFor("unsynced-named", () => seeing(/Waiting on hexed/)));
check("and gets the cross, which is the whole point of the mark",
  await waitFor("cross", async () => (await marksBeside("hexed")).includes("x")));

/* A spectator needs nothing for anyone else's game to start, so no report of
   theirs delays it and none is drawn. */
await page.evaluate(() =>
  window.__ZKS.push('UpdateUserBattleStatus {"Name":"lorelei","Sync":2}'));
check("an unsynced spectator is not named",
  await waitFor("spec-unnamed", async () => !(await waitingOn()).includes("lorelei")));
check("and is not marked either",
  !(await marksBeside("lorelei")).some(i => i === "x" || i === "download"));

/* How big the room is was not on this screen at all - the team columns count
   to a hardcoded eight, which is nobody's cap. */
check("the room says how many player slots it has",
  await waitFor("room-slots", () => badgeSaying("2/16")));
await page.evaluate(() =>
  window.__ZKS.push('BattleUpdate {"Header":{"BattleID":11,"MaxPlayers":2}}'));
check("and says so when they are all taken",
  await waitFor("room-full", () => badgeSaying("Full")));
await page.evaluate(() =>
  window.__ZKS.push('BattleUpdate {"Header":{"BattleID":11,"MaxPlayers":16}}'));
check("and stops saying so when they are not",
  await waitFor("room-not-full", async () => !(await badgeSaying("Full"))));

/* ------------------------------------------------------ who is waiting ---
   The room used to say "Full" and nothing else, which is the one thing a
   person can already see. `QueueOrder` rides on every UpdateUserBattleStatus,
   and `ValidateBattleStatus` stamps a positive one on anyone who entered
   wanting to play - so the people waiting can be named. */
console.log("who is waiting");

/** The names listed under WAITING TO PLAY, in the order drawn. */
const waitingNames = () => page.evaluate(() => {
  const head = [...document.querySelectorAll("span")]
    .find(el => el.textContent.trim() === "WAITING TO PLAY");
  if (!head) return null;
  const list = head.parentElement.nextElementSibling;
  return [...list.querySelectorAll("div")]
    .filter(d => (d.getAttribute("style") || "").includes("--row-default"))
    .map(d => d.textContent);
});

check("a room nobody is queueing for names nobody", (await waitingNames()) === null);

/* lorelei is already spectating with no QueueOrder at all, which is not the
   same as a positive one - absent must not be read as waiting. */
await page.evaluate(() => {
  window.__ZKS.push('BattleUpdate {"Header":{"BattleID":11,"MaxPlayers":2}}');
  window.__ZKS.push('UpdateUserBattleStatus {"Name":"marrow","IsSpectator":true,"QueueOrder":7}');
  window.__ZKS.push('UpdateUserBattleStatus {"Name":"nine","IsSpectator":true,"QueueOrder":3}');
});
check("a spectator the server turned away is named as waiting",
  await waitFor("waiting-panel", async () => {
    const n = await waitingNames();
    return n !== null && n.length === 2;
  }));
check("in the order the server will act on, not the order they arrived",
  (await waitingNames()).join("|").indexOf("nine") <
    (await waitingNames()).join("|").indexOf("marrow"));
check("and a full room is told it is the cap doing it",
  await seeing(/Asked to play after the room filled up/));
check("someone spectating by choice is not accused of waiting",
  !(await waitingNames()).some(n => n.includes("lorelei")));
check("and is still listed as the spectator they are",
  await page.evaluate(() => {
    const head = [...document.querySelectorAll("span")]
      .find(el => el.textContent.trim() === "SPECTATORS");
    return head.parentElement.nextElementSibling.textContent.includes("lorelei");
  }));

/* Not full, so the cap cannot be the explanation. ValidateBattleStatus flips
   the same bit for an Elo, level or rank limit and never says which. */
await page.evaluate(() =>
  window.__ZKS.push('BattleUpdate {"Header":{"BattleID":11,"MaxPlayers":16}}'));
check("a room that is not full says it does not know why they were refused",
  await waitFor("refused-why", () => seeing(/likely a rating, level or rank limit/)));

/* With the time queue on nobody is refused on the way in: everyone stays a
   player and StartGame spectates the overflow by QueueOrder. That set is
   arithmetic we can redo exactly, so the wording gets to be definite. */
await page.evaluate(() => {
  window.__ZKS.push('BattleUpdate {"Header":{"BattleID":11,"MaxPlayers":2,"TimeQueueEnabled":true}}');
  window.__ZKS.push('UpdateUserBattleStatus {"Name":"marrow","IsSpectator":false,"AllyNumber":0,"QueueOrder":7}');
  window.__ZKS.push('UpdateUserBattleStatus {"Name":"nine","IsSpectator":false,"AllyNumber":1,"QueueOrder":3}');
});
/* Waiting on the wording rather than on the names: the refused panel above
   already listed exactly these two, so a check for "two names" is satisfied by
   the state we are trying to leave and races the update we are testing. */
check("and says so definitely, because the cut is computable",
  await waitFor("time-queue", () => seeing(/If the game started now/)));
check("naming exactly who StartGame would move to the spectators",
  await (async () => {
    const n = await waitingNames();
    return n !== null && n.length === 2
      && n.some(x => x.includes("nine")) && n.some(x => x.includes("marrow"));
  })());
await shot("live-06-waiting");

/* Put the room back as it was found, so the checks after this one are testing
   what they think they are rather than a room two people are queueing for. */
await page.evaluate(() => {
  window.__ZKS.push('UserDisconnected {"Name":"marrow"}');
  window.__ZKS.push('UserDisconnected {"Name":"nine"}');
  window.__ZKS.push('BattleUpdate {"Header":{"BattleID":11,"MaxPlayers":16,"TimeQueueEnabled":false}}');
});
check("and the queue empties when the people in it leave",
  await waitFor("waiting-gone", async () => (await waitingNames()) === null));

/* --------------------------------------------------------- team columns ---
   Sixteen allyteams is what ScriptGenerator declares, and sixteen equal
   columns across this pane is 56px each - narrower than a name. They wrap
   instead, so every team stays readable and every team stays joinable. */
console.log("team columns");

/** The team grid: its track sizes, and how many rows the columns occupy. */
const teamGrid = () => page.evaluate(() => {
  const g = [...document.querySelectorAll("div")]
    .filter(d => getComputedStyle(d).display === "grid")
    .find(d => d.children.length > 0
      && [...d.children].every(c => c.textContent.startsWith("TEAM ")));
  if (!g) return null;
  const boxes = [...g.children].map(c => c.getBoundingClientRect());
  return {
    columns: g.children.length,
    width: Math.round(boxes[0].width),
    rows: new Set(boxes.map(b => Math.round(b.top))).size,
    overflows: g.scrollWidth > g.clientWidth + 1,
  };
});

const twoTeams = await teamGrid();
check("a 1v1 still gets two columns filling the pane",
  twoTeams.columns === 2 && twoTeams.rows === 1, JSON.stringify(twoTeams));

/* One player on ally 15 is what a `!balance 16` room looks like. */
await page.evaluate(() =>
  window.__ZKS.push('UpdateUserBattleStatus {"Name":"marrow","IsSpectator":false,"AllyNumber":15}'));
check("a sixteen-team room draws all sixteen",
  await waitFor("sixteen", async () => (await teamGrid()).columns === 16));
const many = await teamGrid();
check("wrapped onto several rows rather than shrunk into slivers",
  many.rows > 1 && many.width >= 200, JSON.stringify(many));
check("and never scrolls sideways, which would hide teams outright",
  !many.overflows, JSON.stringify(many));
check("every team is still joinable, including the last",
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .some(b => b.textContent.trim() === "Join team 16")));
await shot("live-07-sixteen-teams");

await page.evaluate(() => window.__ZKS.push('UserDisconnected {"Name":"marrow"}'));
check("and the columns go back when that player leaves",
  await waitFor("back-to-two", async () => (await teamGrid()).columns === 2));

/* An ally number past the sixteenth is one the script generator has no block
   for - the engine rejects such a script outright rather than clamping it. Run
   from two columns rather than from sixteen, so that a clamp which had stopped
   working would show up as twenty columns instead of passing on the state the
   previous check left behind. */
await page.evaluate(() =>
  window.__ZKS.push('UpdateUserBattleStatus {"Name":"marrow","IsSpectator":false,"AllyNumber":19}'));
check("an ally number the engine would reject stops at the sixteenth column",
  await waitFor("clamped", async () => (await teamGrid()).columns === 16));
check("and no column is offered that would break the script",
  !(await page.evaluate(() => [...document.querySelectorAll("button")]
    .some(b => /^Join team (1[7-9]|20)$/.test(b.textContent.trim())))));

await page.evaluate(() => window.__ZKS.push('UserDisconnected {"Name":"marrow"}'));
await waitFor("teams-restored", async () => (await teamGrid()).columns === 2);

/* Ratings carry the colour Zero-K tints a rating with, keyed by the rank the
   server sent - the exact values in gui_chili_share.lua's `rankColors`. Three
   players, three ranks: Qrow is Giant, hexed Subgiant, lorelei Red Dwarf. */
const tints = await page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll("span")) {
    const t = el.textContent.trim();
    if (/^\d{3,4}$/.test(t) && el.style.fontVariantNumeric === "tabular-nums") {
      out[t] = getComputedStyle(el).color;
    }
  }
  return out;
});
check("ratings are tinted in Zero-K's own rank colours",
  tints["1842"] === "rgb(255, 255, 0)"
  && tints["1790"] === "rgb(255, 166, 0)"
  && tints["1588"] === "rgb(204, 102, 26)",
  JSON.stringify(tints));

/* The chat and spectator pane is draggable, and remembers where you left it -
   people who read chat want it tall, people watching the teams want it short. */
const resizer = page.getByRole("separator", { name: "Resize chat" });
const paneHeight = () => page.evaluate(() =>
  document.querySelector('[role=separator][aria-label="Resize chat"]')
    .nextElementSibling.firstElementChild.getBoundingClientRect().height);
const startHeight = await paneHeight();
await resizer.focus();
await page.keyboard.press("ArrowUp");
check("the chat pane resizes", await waitFor("taller", async () => (await paneHeight()) > startHeight));
await shot("live-05-room");
check("and the new height is remembered",
  await page.evaluate(() =>
    JSON.parse(localStorage.getItem("shiro.settings") || "{}").roomChatHeight > 200));

/* Somebody else's room. The server would refuse a SetModOptions from us, so
   the button is offered disabled with the reason rather than hidden. */
check("options are not editable in a room we did not open",
  await page.getByRole("button", { name: "Edit" }).isDisabled());
check("the install we found is named, as an install",
  await seeing(/Zero-K installation found via Steam/));
/* The panel used to say only "Zero-K found via Steam", which in a room
   running something else read as though the room were Zero-K. */
check("the room names the game it actually runs", await seeing(/Supreme-K 3\.42/));
check("room chat renders the sender as a chip, not a string",
  await seeing(/hexed/) && !(await seeing(/\{"0":/)));
await shot("live-02-room");

console.log("room actions");
await clickText(/Join team 2/);
check("changing team sends UpdateUserBattleStatus",
  await waitFor("team", () => sentAny(/^UpdateUserBattleStatus \{.*"AllyNumber":1/)));
await clickText(/^Spectate$/);
check("spectating sends UpdateUserBattleStatus",
  await waitFor("spec", () => sentAny(/^UpdateUserBattleStatus \{.*"IsSpectator":true/)));

const composer = page.getByPlaceholder("Message the room");
await composer.fill("gl hf");
await composer.press("Enter");
check("room chat sends as a battle Say",
  await waitFor("say", () => sentAny(/^Say \{.*"Place":1.*"Text":"gl hf"/)));
/* The server echoes a Say back to the room, and the log has to follow it down.
   Nothing exercised an incoming chat line until the fake server learned to
   echo, which is why "chat does not snap to new messages" had no test. */
check("and the echoed line lands in the log",
  await waitFor("echo", () => seeing(/gl hf/)));
for (let i = 0; i < 24; i++) {
  await composer.fill("filler " + i);
  await composer.press("Enter");
}
check("the log follows new messages to the bottom",
  await waitFor("follow", () => page.evaluate(() => {
    const els = [...document.querySelectorAll("div")]
      .filter(d => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight + 4);
    return els.length > 0 && els.every(d => d.scrollHeight - d.scrollTop - d.clientHeight <= 48);
  })));

await clickText(/^Start game$/);
check("start asks the host", await waitFor("start", () => sentAny(/^Say \{.*"!start"/)));

/* Being in a room used to hide the battle list behind it, so the only way to
   see what else was open was to leave - and nothing on screen said you were
   still in one. */
console.log("looking around while in a room");
await nav("Battles");
check("the battle list is reachable from inside a room",
  await waitFor("list-while-in-room", () => seeing(/Host a battle/)));
check("and it says which room you are still in",
  (await seeing(/In a room/)) && (await seeing(/Teams 8v8 - all welcome/)));
const lookMark = await mark();
await clickText(/^Back to room$/);
check("going back does not rejoin anything",
  !(await sentSince(lookMark, /^JoinBattle /)));
check("and the room is on screen again",
  await waitFor("back-in-room", () => seeing(/SPECTATORS/)));

console.log("leaving");
await clickText(/^Leave$/);
check("LeaveBattle went out", await waitFor("leave", () => sentAny(/^LeaveBattle /)));
check("we are back on the battle list", await waitFor("back", () => seeing(/Host a battle/)));

/* Double-click joins. BattleRow accepts an `onJoin` and never calls it, so this
   worked in nobody's hands until the handler moved to a wrapper at the call
   site. */
const dblMark = await mark();
await page.getByText(/^Teams 8v8 - all welcome$/).first().dblclick();
check("double-clicking a row joins it",
  await waitFor("dblclick-join", () => sentSince(dblMark, /^JoinBattle /)));
check("and it opens the room", await waitFor("dbl-room", () => seeing(/SPECTATORS/)));
await clickText(/^Leave$/);
check("and leaving that returns to the list",
  await waitFor("dbl-back", () => seeing(/Host a battle/)));

console.log("hosting");
await clickText(/Host a battle/);
await page.getByPlaceholder("Teams 8v8 - all welcome").fill("shiro test room");
/* The map field searches Zero-K's catalogue now, so its placeholder is a
   prompt rather than an example map. */
await page.getByPlaceholder("Type to search").fill("TartarusV7");
await clickText(/Open room/);
check("OpenBattle carries the title, map and engine",
  await waitFor("open", () => sentAny(/^OpenBattle \{.*"Title":"shiro test room".*"Map":"TartarusV7".*"Engine":"2025\.06\.21"/)));
check("we land in the room we opened", await waitFor("hosted", () => seeing(/shiro test room/)));
await shot("live-03-hosted");

/* Game options. Only the founder may set them - the server refuses everyone
   else, and refuses even the founder in an autohost - so the Edit button exists
   here and nowhere else in this run. */
check("the host is offered the game options",
  await waitFor("editable", () => seeing(/MOD OPTIONS/)));
const beforeOptions = await mark();
const noElo = () => page.getByLabel("No Elo");
await clickText(/^Edit$/);
check("the options open on the game's own first section",
  await waitFor("opts", () => seeing(/Game options/)) && await seeing(/Important/));
check("every section upstream declares is offered",
  (await Promise.all(["Important", "Start", "Map", "Multipliers", "Silly", "Experimental", "Chicken"]
    .map(n => seeing(new RegExp(n))))).every(Boolean));

/* Nothing is sent until Apply: a send per keystroke would broadcast the whole
   dictionary to every player in the room on every click.

   The click is dispatched rather than performed because the design system's
   checkbox is a 0x0 input hidden behind a styled span: it is the element
   carrying the label and the change handler, but nothing Playwright will agree
   to click. */
await noElo().dispatchEvent("click");
await page.waitForTimeout(400);
await shot("live-04-modoptions");
check("editing alone sends nothing",
  !(await sentSince(beforeOptions, /^SetModOptions/)));

await clickText(/^Cancel$/);
check("cancelling sends nothing either",
  !(await sentSince(beforeOptions, /^SetModOptions/)));

await clickText(/^Edit$/);
check("cancelling kept the room's own value, not ours",
  await waitFor("reseed", async () => !(await noElo().isChecked())));
await noElo().dispatchEvent("click");
const beforeApply = await mark();
await clickText(/^Apply$/);
check("applying sends the change",
  await waitFor("sent", () => sentSince(beforeApply, /^SetModOptions \{.*"noelo":"1"/)));

/* The trap this whole module is shaped around. SetModOptions assigns the
   room's dictionary rather than merging into it, so a send that carries only
   our own controls silently drops everything else - the server's own keys
   included. Both of these were in the room before we opened the dialog. */
check("and carries the keys we never touched",
  await sentSince(beforeApply, /^SetModOptions \{.*"commshare":"1"/)
  && await sentSince(beforeApply, /^SetModOptions \{.*"multiplier":"2\.0"/));

check("the room shows the change by name", await waitFor("shown", () => seeing(/No Elo/)));

await clickText(/^Leave$/);
await waitFor("back", () => seeing(/Host a battle/));

/* A custom mode is not simply "a different game". Of the three the service
   offers, one names a game, one names a map and runs on stock Zero-K, and one
   is nothing but a modoption - so this covers a game-mode and a map-mode
   without opening a second room for the second case. */
console.log("hosting a custom game");
await clickText(/Host a battle/);
await page.getByPlaceholder("Teams 8v8 - all welcome").fill("arena room");

await selectWith("Zero Wars").selectOption({ label: "Zero Wars" });
check("a mode that is a map fills the map field for you",
  await waitFor("zwmap", async () =>
    (await page.getByPlaceholder("Type to search").inputValue()) === "ZeroWars v2.1.9"));

await selectWith("Arena Mod").selectOption({ label: "Arena Mod" });
await page.getByPlaceholder("Type to search").fill("TartarusV7");
const fromHost = await mark();
await clickText(/Open room/);
check("OpenBattle carries the mode's game, not Welcome's",
  await waitFor("arena", () => sentSince(fromHost, /^OpenBattle \{.*"Game":"Arena Mod v1\.0\.10"/)));
check("and the mode's modoptions follow once the room exists",
  await waitFor("opts", () => sentSince(fromHost, /^SetModOptions \{.*"terrarestoreonly":"1"/)));

await clickText(/^Leave$/);
await waitFor("back", () => seeing(/Host a battle/));

console.log("passworded battles");
await page.getByText(/^private - do not join$/).first().click();
await clickText(/^Join room$/);
check("a locked battle asks for the password first",
  await waitFor("prompt", () => seeing(/This battle is locked/)));
await page.locator("input").last().fill("hunter2");
await clickDialog(/^Join$/);
check("the password is sent with the join",
  await waitFor("pwjoin", () => sentAny(/^JoinBattle \{.*"Password":"hunter2"/)));
await clickText(/^Leave$/);
await waitFor("back", () => seeing(/Host a battle/));

console.log("chat");
await nav("Chat");
/* The server hands the roster over in join order, which is arrival order to
   the server and no order at all to somebody looking for one name in two
   hundred. */
check("the channel roster is in alphabetical order", await waitFor("roster", () =>
  page.evaluate(() => {
    const names = [...document.querySelectorAll('[title^="Message "]')]
      .map(e => e.getAttribute("title").replace(/^Message /, ""));
    if (names.length < 2) return false;
    const sorted = [...names].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }));
    return names.join("|") === sorted.join("|");
  })));
check("the joined channel is a tab", await waitFor("chan", () => seeing(/#zk/)));
check("channel backlog renders", await seeing(/anyone up for teams/));
check("the topic is shown", await seeing(/Welcome to Zero-K/));
const chanBox = page.getByPlaceholder(/^Message #zk/);
await chanBox.fill("hello from shiro");
await chanBox.press("Enter");
check("channel chat sends to the channel",
  await waitFor("csay", () => sentAny(/^Say \{.*"Place":0.*"Target":"zk".*"hello from shiro"/)));
await shot("live-04-chat");

console.log("matchmaker");
await nav("Matchmaker");
/* The server offers seventeen queues and the centre column shows the kinds of
   game they are: a duel, a team game, coop. Sortie and 10v10+ are the proof it
   is a grouping rather than a shorter list - both are among the seventeen, and
   neither is on screen until the category holding it is open. */
check("the server's queues arrive as the kinds of game rather than as one list",
  await waitFor("queues", async () => (await seeing(/Teams/)) && (await seeing(/Coop/))
    && !(await seeing(/Sortie/)) && !(await seeing(/10v10/))));
/* The size ladder was eleven rows of it. Four categories exist and three have
   queues behind them today, so three is what gets drawn. */
check("and there are only as many rows as there are kinds with queues in them",
  (await page.getByRole("switch", { name: /queues$/ }).count()) === 3);
/* Both of these were the server's own words on the screen and both are gone -
   the sidebar's per-queue sentence and the paragraph explaining the layout. */
check("without the server's prose under each option, or a paragraph explaining the screen",
  !(await seeing(/closely matched opponent/)) && !(await seeing(/Switch on a size/)));
await shot("live-05-queues");

/* `name` matches a substring by default, and "1v1" is a substring of the
   category's own label. Every locator here is exact for that reason. */
const cat = label => page.getByRole("switch", { name: label + " queues", exact: true });
const opts = label => page.getByRole("button", { name: new RegExp("^Options for " + label + ":") });
const queue = name => page.getByRole("switch", { name, exact: true });

const duel = cat("1v1");
const teams = cat("Teams");
check("a category is a switch that says whether you are in it",
  (await duel.getAttribute("aria-checked")) === "false");
/* The counts are how somebody picks, so they stay on the row the switch is on -
   added up, because the row now stands for thirteen queues. Battle is 21
   waiting and 14 in game, Sortie 9 and 4, 2v2+ 5 and none, and the other ten
   team queues are empty. */
check("and the row carries what the queues under it add up to",
  /waiting\s*35[\s\S]*in game\s*18/i.test(await teams.innerText()));
check("with how much of the category you are in beside it",
  (await opts("1v1").innerText()).trim() === "0 of 3"
  && (await opts("Teams").innerText()).trim() === "0 of 13");

/* Thirteen team queues is exactly what the centre column is not for, and the
   count beside the row is how you get at them - it opens the category without
   joining anything. */
await opts("Teams").click();
check("the sizes are in the sidebar, reachable without joining a thing",
  await waitFor("sizes", async () => (await seeing(/Sortie/)) && (await seeing(/10v10/))
    && (await teams.getAttribute("aria-checked")) === "false"));
await shot("live-05-queue-options");

let from = await mark();
await duel.click();
/* MatchMakerQueueRequest carries the whole set you want to be in, so one click
   on a category can send every queue in it. Server order, not click order. */
check("turning a kind of game on joins every queue in it",
  await waitFor("mmq", () => sentSince(from,
    /^MatchMakerQueueRequest \{"Queues":\["1v1","1v1 Narrow","1v1 Wide"\]\}$/)));
/* `seeing` is case-insensitive against the whole screen, so "Searching" alone
   would also match a sentence sitting in the idle panel. Leaving is only
   offered while there is something to leave. */
check("the screen switches to searching",
  await waitFor("searching", async () => (await seeing(/Searching/)) && (await seeing(/Leave all queues/))));
/* Every MatchMakerStatus restates the counts, including the one that answers a
   queue request. Joining used to blank every row on the screen. */
check("without the counts vanishing the moment you join one",
  await waitFor("counts", async () => /waiting\s*35/i.test(await teams.innerText())));
check("and the sidebar is showing the three it just joined",
  await waitFor("side", async () =>
    (await queue("1v1 Narrow").getAttribute("aria-checked")) === "true"
    && (await queue("1v1 Wide").getAttribute("aria-checked")) === "true"));

/* The sidebar is the whole reason a category can be a single switch: the one
   person who cares which variant they are in can still say so. */
from = await mark();
await queue("1v1 Wide").click();
check("switching one option off in the sidebar sends the rest, not a drop-out",
  await waitFor("mmq2", () => sentSince(from,
    /^MatchMakerQueueRequest \{"Queues":\["1v1","1v1 Narrow"\]\}$/)));
check("and the category still reads as on, with the count saying it is partial",
  await waitFor("partial", async () => (await duel.getAttribute("aria-checked")) === "true"
    && (await opts("1v1").innerText()).trim() === "2 of 3"));

/* Several at once was the point of switches and it survives the grouping. */
from = await mark();
await cat("Coop").click();
check("a second kind of game joins the first rather than replacing it",
  await waitFor("mmq3", () => sentSince(from,
    /^MatchMakerQueueRequest \{"Queues":\["Coop","1v1","1v1 Narrow"\]\}$/)));
check("and the panel names all three queues, so six of them would still be legible",
  await waitFor("named", async () => (await seeing(/3 queues/)) && (await seeing(/1v1 Narrow/))));
await shot("live-05-queues-joined");

/* A part-on category reads as on, so the click after it is the one that gets
   you out - not the one that quietly puts you back in what you turned off. */
from = await mark();
await duel.click();
check("switching a partly-on category off leaves all of it",
  await waitFor("mmq4", () => sentSince(from, /^MatchMakerQueueRequest \{"Queues":\["Coop"\]\}$/)));
check("so the search carries on in what is left",
  await waitFor("still", async () =>
    (await seeing(/Leave all queues/)) && (await duel.getAttribute("aria-checked")) === "false"
    && (await cat("Coop").getAttribute("aria-checked")) === "true"));

await page.evaluate(() => window.__ZKS.push('AreYouReady {"MinimumWinChance":0.4,"QuickPlay":false,"SecondsRemaining":30}'));
check("the ready check interrupts", await waitFor("ready", () => seeing(/Match found\. Ready\?/)));
await clickText(/^Ready$/);
check("the response goes out", await waitFor("resp", () => sentAny(/^AreYouReadyResponse \{"Ready":true\}/)));
check("acceptance progress is shown", await waitFor("acc", () => seeing(/of 4 accepted/)));
await shot("live-05-ready");
await page.evaluate(() => window.__ZKS.push('AreYouReadyResult {"IsBattleStarting":true,"AreYouBanned":false}'));
check("the dialog closes when the match starts",
  await waitFor("closed", async () => !(await seeing(/Match found/))));

console.log("profile and player search");
await nav("Profile");
check("your own profile is the default view",
  await waitFor("prof", () => seeing(/MY PROFILE/) && seeing(/GENERAL ELO/)));
await page.getByPlaceholder("Find a player").fill("hex");
check("searching the directory finds a player who is online",
  await waitFor("hit", () => seeing(/ENTER OPENS TOP HIT/) && seeing(/hexed/)));
await page.keyboard.press("Enter");
check("and opening one turns the screen into them",
  await waitFor("viewing", () => seeing(/VIEWING/) && seeing(/Add friend/)));
/* hexed is Rank 3, which Zero-K calls Subgiant. The number is an index into a
   table that only exists in upstream's source. */
check("a rank is shown by its Zero-K name, not by its index",
  await seeing(/Subgiant/) && !(await seeing(/Rank 3/)));
/* The asymmetry the protocol forces: their record has no Planetwars rating and
   there is no way to ask for one, so the panel is absent rather than blank. */
check("another player shows no Planetwars rating, because there is none to show",
  !(await seeing(/PLANETWARS/)));
check("and says why the history is missing rather than showing an empty table",
  await seeing(/only available for your own account/));

/* What the protocol will not tell us about another player, read off their
   zero-k.info page instead. The developers were asked for an endpoint and
   declined; see docs/PROFILES-WITHOUT-ENDPOINTS.md. */
check("their zero-k.info page fills in what the protocol will not",
  await waitFor("web", () => seeing(/PLAYING FOR/) && seeing(/BATTLES/)));
check("including awards with their counts",
  await seeing(/Complete Annihilation/) && await seeing(/812/));
check("and when they were last seen, which is the point of looking someone up",
  await seeing(/LAST SEEN/) && await seeing(/20 minutes ago/));

/* Somebody the lobby has never heard of. The directory is only who is
   connected, so without a way to look a name up the profile of an offline
   player is unreachable - which is what made the reader above pointless. */
await page.getByPlaceholder("Find a player").fill("Gholam");
check("a name the directory does not have is still offered",
  await waitFor("offer", () => seeing(/Look up Gholam/)));
await clickText(/Look up Gholam/);
check("and opens as a profile",
  await waitFor("offline", () => seeing(/VIEWING/) && seeing(/Gholam/)));
check("filled in from their page rather than left blank",
  await waitFor("offweb", () => seeing(/FROM ZERO-K\.INFO/) && seeing(/LAST SEEN/)));

/* And their rating with it. There is no `User` record for somebody who is not
   connected, so the lobby has no elo for them and never will - but the chart
   the site links to ends at where they are now, and we already fetch it for the
   trend line. Leaving the tile as a dash while drawing that very series
   underneath it was the reported "profile elo does not work for other users".
   1793 is the last point of the fake series; hexed's lobby rating is 1790, so
   this number can only have come from the site. */
check("an offline player's rating comes off their chart rather than staying a dash",
  await waitFor("offelo", async () => (await ratingTiles())["GENERAL ELO"]?.value === "1793"));
check("and says so, because it is not the figure the lobby would have given",
  /zero-k\.info/i.test((await ratingTiles())["GENERAL ELO"].note));
/* The matchmaker rating is only in the `User` record and is on no page, so it
   is a dash - and the dash says why rather than reading as "unrated". */
check("the matchmaker rating says why it is missing instead of reading as none",
  /only sent for players who are online/i.test((await ratingTiles()).MATCHMAKER.note));
check("nothing was rendered as a zero", !Object.values(await ratingTiles()).some(t => t.value === "0"));

/* The elo line under another player's name is their whole career off the site,
   not the matches this client saw - it spans years. It used to claim both. */
check("their elo line names where it came from",
  await seeing(/GENERAL ELO · ZERO-K\.INFO/));

/* And a name that is nobody at all says so, rather than showing an empty
   profile that reads as a player who has done nothing. */
await page.getByPlaceholder("Find a player").fill("zzzznosuchplayerzzzz");
await clickText(/Look up zzzznosuchplayerzzzz/);
check("a name that is nobody says so",
  await waitFor("nobody", () => seeing(/No zero-k\.info account under that name/)));
check("and the rating tile says it too, so the dash is never bare",
  await waitFor("nobodytile", async () =>
    /no zero-k\.info account/i.test((await ratingTiles())["GENERAL ELO"]?.note || "")));

/* The other way a rating can be absent, and the one that must not be mistaken
   for it: the page was there and we could not read it. A player who is unrated
   and a site we could not reach are different facts. */
await clickText(/My profile/);
await page.evaluate(() => { window.__ZKS.webError = "could not reach zero-k.info"; });
await page.getByPlaceholder("Find a player").fill("Anir");
await clickText(/Look up Anir/);
check("a page we could not read is not reported as a player with no rating",
  await waitFor("unreadable", async () => {
    const note = (await ratingTiles())["GENERAL ELO"]?.note || "";
    return /could not be read/i.test(note) && !/no zero-k\.info account/i.test(note);
  }));
await page.evaluate(() => { window.__ZKS.webError = null; });

await clickText(/My profile/);
check("going back returns to your own", await waitFor("back2", () => seeing(/MY PROFILE/)));

console.log("apps");
await nav("Apps");
check("the launcher lists what Shiro can run",
  await waitFor("apps", () => seeing(/System profiler/) && seeing(/Splaunch/)));
/* An app with a published release is offered rather than dimmed - the state
   Springen and Stournament are in, and the one the catalogue exists for. */
check("an app with a build published is installable",
  await seeing(/Stournament/));
/* An app Shiro cannot install is the state most likely to look like a bug
   rather than a fact, so it has to say why instead of offering a button that
   fails. */
check("an app Shiro cannot install says so rather than offering Install",
  await waitFor("unavail", async () => {
    await page.getByRole("button", { name: /Splaunch/ }).first().click();
    return (await seeing(/No build published yet/i)) && (await seeing(/Unavailable/i));
  }));

/* And one it can offers Install, with the verification happening in Rust. */
check("an app with a published build can be installed",
  await waitFor("install", async () => {
    await page.getByRole("button", { name: /Springen/ }).first().click();
    return await seeing(/Install/);
  }));
const beforeInstall = await mark();
await page.getByRole("button", { name: /^Install$/ }).last().click();
check("installing asks the backend rather than fetching in the page",
  await waitFor("installed", () => sentSince(beforeInstall, /^install springen$/)));
await shot("live-06-apps");

console.log("friends");
/* Record every distinct state the ratings panel passes through while this
   screen mounts, not just the one it settles on.
 *
 * The selected friend is App state that a mount effect sets, so the panel's
 * first paint has no profile to draw - and it used to fill the gap by deriving
 * the other two ratings from the general elo (`elo - 76`, `elo + 34`), under
 * the real labels. That is one frame, which a settled assertion cannot see and
 * a person can: hexed's matchmaker rating is 1701 and it flashed 1714. So the
 * check is over the whole sequence, which makes the timing irrelevant. */
await page.evaluate(() => {
  window.__PANEL = [];
  /* A DOM observer rather than an animation frame: headless Chromium only
     produces frames when something is drawn, so a requestAnimationFrame loop
     starves on an idle page and misses exactly the commits this is here to
     catch. Every React commit is a mutation, and every mutation is something a
     person could have been looking at. */
  const sample = () => {
    const seen = [];
    for (const el of document.querySelectorAll("span.lab")) {
      const label = el.textContent.trim();
      if (!/ELO|MATCHMAKER|PLANETWARS|1V1/.test(label)) continue;
      const v = el.nextElementSibling;
      seen.push(label + "=" + (v ? v.textContent.trim() : "?"));
    }
    if (!seen.length) return;
    const state = seen.join(" ");
    if (window.__PANEL[window.__PANEL.length - 1] !== state) window.__PANEL.push(state);
  };
  window.__PANEL_STOP = () => window.__PANEL_OBS.disconnect();
  window.__PANEL_OBS = new MutationObserver(sample);
  window.__PANEL_OBS.observe(document.body, { subtree: true, childList: true, characterData: true });
  sample();
});
await nav("Friends");
check("the friend list is the server's", await waitFor("friends", () => seeing(/FRIENDS/) && seeing(/hexed/)));
/* Let it settle first: the sequence has to include the state it ends on, and
   the settled state is the one carrying hexed's real matchmaker rating. */
await waitFor("panel settles", () => seeing(/1701/));
const panelStates = await page.evaluate(() => { window.__PANEL_STOP(); return window.__PANEL; });
/* hexed's record carries 1790 and 1701 and nothing else. Any other number under
   these labels was made up by the client. */
check("the ratings panel never shows a number the server did not send",
  panelStates.every(s => (s.match(/=(\d+)/g) || []).every(n => n === "=1790" || n === "=1701")),
  panelStates.join(" / "));
/* And the labels do not change with the data either: the derived set called the
   third rating "1V1", so a friend whose profile had not arrived was offered a
   rating that does not exist on this screen. */
check("and the three labels are the same three whatever has arrived",
  panelStates.every(s => /GENERAL ELO/.test(s) && /MATCHMAKER/.test(s) && /PLANETWARS/.test(s)
    && !/1V1/.test(s)),
  panelStates.join(" / "));
/* Deliberately the opposite of what this used to assert. `UserProfile` is
   server-to-client only; sending it threw a RuntimeBinderException on the real
   server, so requestProfile is a no-op and the detail comes from the `User`
   record we already hold. See src/store/friends.ts. */
check("no UserProfile is sent, because the server cannot receive one",
  !(await sentAny(/^UserProfile /)));
check("real ratings replace the derived placeholders",
  await waitFor("ratings", () => seeing(/PLANETWARS/)));

/* Reporting somebody. The path is live upstream - ConnectedUser hands a
   UserReport to server.ReportUser, which writes an abuse report and rings the
   admin channel - and Shiro typed the message for months without ever sending
   one. The assertion is the wire shape, because the server answers nothing at
   all and there is no other evidence it worked. */
{
  const before = await mark();
  await clickText(/^Report$/);
  check("reporting somebody asks what happened",
    await waitFor("report dialog", () => seeing(/Report hexed/)));
  check("and will not send an empty complaint",
    await page.getByRole("button", { name: /^Send report$/ }).last().isDisabled());

  await page.getByLabel(/What happened/i).fill("spamming the channel");
  await clickDialog(/^Send report$/);
  check("the report goes out with the name and the text",
    await waitFor("report sent", async () => {
      const lines = (await sent()).slice(before);
      return lines.some(l => {
        if (!l.startsWith("UserReport ")) return false;
        const d = JSON.parse(l.slice("UserReport ".length));
        return d.Username === "hexed" && d.Text === "spamming the channel";
      });
    }));
  check("and the dialog closes behind it",
    await waitFor("report closed", async () => !(await seeing(/Report hexed/))));
}

await shot("live-06-friends");

/* Tab completes a name. Without a handler Tab does what Tab does in a browser
   and moves the focus, which took people out of the box they were typing in. */
{
  await nav("Chat");
  await waitFor("chat", () => seeing(/ROOM CHAT|#zk|Message /));
  const box = page.getByPlaceholder(/^Message /).first();
  await box.click();
  await box.fill("hex");
  await page.keyboard.press("Tab");
  check("Tab completes a name in the composer",
    await waitFor("completion", async () => (await box.inputValue()) === "hexed"));
  check("and the focus stays in the box it completed in",
    await page.evaluate(() => document.activeElement?.tagName === "INPUT"));
  await box.fill("");
}

/* The webview's own right-click menu - Back, Reload, Save as, Inspect - means
   nothing in a lobby. Editable fields keep theirs, because Cut/Copy/Paste is
   the menu somebody actually wants. */
{
  const suppressed = await page.evaluate(() => {
    const fire = el => {
      const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const input = document.querySelector("input");
    window.getSelection()?.removeAllRanges();
    return { page: fire(document.body), field: input ? fire(input) : null };
  });
  check("the page's right-click menu is gone", suppressed.page === true);
  check("but a text field keeps its cut, copy and paste", suppressed.field === false);
}

console.log("launching a game");
await nav("Battles");
await page.getByText(/^running match$/).first().click();
await clickText(/^Join room$/);
await waitFor("joined running", () => seeing(/CAI-Brutal/));
await clickText(/^Join game$/);
check("connect details are requested",
  await waitFor("rcs", () => sentAny(/^RequestConnectSpring /)));
const launched = await waitFor("launch", () => page.evaluate(() => Boolean(window.__ZKS.launched)));
check("the engine is launched from ConnectSpring", launched);
if (launched) {
  const req = await page.evaluate(() => window.__ZKS.launched);
  check("the launch carries our name and the script password",
    req.myPlayerName === "Qrow" && req.scriptPassword === "sp-9f2c" && req.port === 8452,
    JSON.stringify(req));
}
check("the room reports the game as running", await waitFor("running", () => seeing(/Game running/)));

/* The content gate. `prepareAndLaunch` had no callers at all: ConnectSpring
   called `launch` directly, so the preflight, the download and the Downloading
   dialog were unreachable, and a game on a map the player lacked spawned an
   engine that sat on "waiting for connection" forever.

   Driven by pushing ConnectSpring rather than pressing Join game, because the
   previous launch left this room showing a game in progress. */
console.log("launching without the map");
await page.evaluate(() => {
  window.__ZKS.emitGame({ kind: "exited", code: 0 });
  window.__ZKS.launched = null;
  window.__ZKS.missing = [{ kind: "map", name: "Some Map Nobody Has" }];
  window.__ZKS.push("ConnectSpring " + JSON.stringify({
    Engine: "2025.06.21", Game: "Zero-K v1.14.8.0", Map: "Some Map Nobody Has",
    Title: "gate test", Ip: "127.0.0.1", Port: 8452, ScriptPassword: "sp-9f2c",
  }));
});
check("the download starts instead of the engine",
  await waitFor("gate", () => seeing(/Some Map Nobody Has/i)));
check("and nothing is launched into a map that is not there",
  !(await page.evaluate(() => Boolean(window.__ZKS.launched))));
/* Finish it the way the supervisor would, and the launch follows. */
await page.evaluate(() => window.__ZKS.emitContent({
  kind: "finished", id: window.__ZKS.lastJobId, outcome: "ok" }));
check("and once the content lands, the game starts",
  await waitFor("after-dl", () => page.evaluate(() => Boolean(window.__ZKS.launched))));
await page.evaluate(() => { window.__ZKS.missing = []; });

console.log("commands from the website");
const siteMark = await mark();
await page.evaluate(() => window.__ZKS.push('SiteToLobbyCommand ' + JSON.stringify({
  Command: "zk://chat/channel/zk@add_friend:lorelei" })));
check("an add-friend from the site goes to the server",
  await waitFor("sitefriend", () => sentSince(siteMark, /^SetAccountRelation \{.*"TargetName":"lorelei".*"Relation":1/)));
check("and the path it carries navigates", await waitFor("sitechan", () => seeing(/#zk/)));

await page.evaluate(() => window.__ZKS.push('SiteToLobbyCommand {"Command":"@join_player:hexed"}'));
check("join_player joins whatever battle that player is in",
  await waitFor("sitejoin", () => sentSince(siteMark, /^JoinBattle \{"BattleID":11\}/)));

console.log("server notices");
await page.evaluate(() => window.__ZKS.push('Say ' + JSON.stringify({
  Place: 5, Text: "Scheduled restart in 10 minutes.", IsEmote: false, Ring: false,
  AllowRelay: true })));
check("a server message box interrupts rather than scrolling past",
  await waitFor("notice", () => seeing(/Scheduled restart in 10 minutes/)));
await clickDialog(/^OK$/);
check("and dismisses", await waitFor("dismissed", async () =>
  !(await seeing(/Scheduled restart/))));

console.log("spectating and ignoring");
await clickText(/^Leave$/);
check("back on the battle list", await waitFor("list", () => seeing(/Host a battle/)));
const specMark = await mark();
await page.getByText(/^Teams 8v8 - all welcome$/).first().click();
await page.getByRole("button", { name: /Spectate/ }).first().click();
check("spectating joins first, then sets the status",
  await waitFor("spec2", async () => (await sentSince(specMark, /^JoinBattle \{"BattleID":11/))
    && (await sentSince(specMark, /^UpdateUserBattleStatus \{.*"IsSpectator":true/))));
/* Wait for the roster: JoinBattleSuccess is a snapshot, so anything pushed
   before it lands is wiped by it. */
check("and lands in that room", await waitFor("room11", () => seeing(/CAI-Brutal/)));

await page.evaluate(() => window.__ZKS.push('IgnoreList {"Ignores":["hexed"]}'));
check("an ignored player's chat disappears", await waitFor("ign", async () => {
  const room = (await text()).split("SPECTATORS")[0];
  return !/^hi$/m.test(room);
}));

console.log("polls");
await page.evaluate(() => window.__ZKS.push('BattlePoll ' + JSON.stringify({
  Topic: "Change map to TartarusV7?", VotesToWin: 3, YesNoVote: true,
  MapSelection: false, NotifyPoll: true })));
check("an open vote is shown", await waitFor("poll", () => seeing(/Change map to TartarusV7/)));
if (SHOTS) await shot("live-poll");
await clickText(/^Yes$/);
check("voting goes to battle chat, which is how autohosts hear it",
  await waitFor("vote", () => sentAny(/^Say \{.*"Place":1.*"Text":"!y"/)));
await page.evaluate(() => window.__ZKS.push('BattlePollOutcome ' + JSON.stringify({
  Topic: "Change map", Message: "Map changed to TartarusV7", Success: true,
  YesNoVote: true, MapSelection: false })));
check("the outcome replaces the open vote", await waitFor("outcome", () => seeing(/Map changed to TartarusV7/)));

console.log("host controls");
const beforeBot = await mark();
await clickText(/Add AI/);
/* Shiro used to add CAI and nothing else, which is one of the nine AIs Zero-K
   declares and none of the ones the engine brings. */
check("Add AI asks which one", await waitFor("aipick", () => seeing(/Add an AI to team/)));
check("and offers more than the one it used to hardcode",
  await seeing(/CircuitAI/) && await seeing(/Chicken/));
/* Seven chickens are one idea at seven difficulties, so they are one row with a
   difficulty beside it rather than seven lines of near-identical text. */
check("with the chickens as one row", await page.getByRole("button", { name: /^Chicken/ }).count() === 1);
/* A reading of the install the room is playing is not a guess and must not be
   captioned as one - the caption is what makes a guess visible, and one that
   is always there says nothing. */
check("and no apology, because this list was read rather than guessed",
  !(await seeing(/built-in list|not installed here/)));
check("nothing is sent until the choice is made", !(await sentSince(beforeBot, /^UpdateBotStatus/)));

await selectWith("Hard").selectOption({ label: "Hard" });
await clickDialog(/Add AI/);
check("the chosen AI is the one that goes on the wire",
  await waitFor("bot", () => sentSince(beforeBot, /^UpdateBotStatus \{.*"AiLib":"Chicken: Hard".*"Owner":"Qrow"/)));
/* And names the bot. The server looks Name up in the room's bot dictionary
   without checking it first, so leaving it out threw ArgumentNullException
   server-side and added nothing - with no error the client could see. */
check("and names the bot, which the server will not do for us",
  await sentAny(/^UpdateBotStatus \{.*"Name":"Chicken: Hard \(\d+\)"/));
await page.getByRole("button", { name: /Remove hexed/ }).first().click();
check("kicking sends the battle and the name",
  await waitFor("kick", () => sentAny(/^KickFromBattle \{.*"Name":"hexed"/)));
/* hexed founded this battle, so the name stays in the header no matter what -
   the roster is the thing that has to change. */
check("the roster reflects the kick", await waitFor("gone", async () =>
  (await page.getByRole("button", { name: /Remove hexed/ }).count()) === 0));

/* The update offer. It arrives from the startup check, which is deliberately
   the only moment it can: docs/UPDATES.md rules out a prompt mid-session on the
   grounds that an update prompt over a battle is an interruption, and at
   startup there is no battle to interrupt. */
{
  /* The app checks four seconds after login, once a session, so this reloads
     rather than waiting for a check that has already been and gone.

     The offer is set *after* the reload: fake-server.js is an init script, so
     it re-runs on every navigation and a value set beforehand is wiped. */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.evaluate(() => { window.__ZKS.offerUpdate = "0.2.200"; });
  await page.locator("input").nth(0).fill("Qrow");
  await page.locator("input").nth(1).fill("hunter2");
  await page.keyboard.press("Enter");
  check("an available update is offered at startup",
    await waitFor("offer", () => seeing(/Update available/), 12000));
  check("and names the version it would install", await seeing(/0\.2\.200/));

  await clickDialog(/^Later$/);
  check("Later dismisses it",
    await waitFor("gone", async () => !(await seeing(/Update available/))));
  check("and it does not install behind your back",
    (await page.evaluate(() => window.__ZKS.installedUpdate)) === false);
  await page.evaluate(() => { window.__ZKS.offerUpdate = null; });
}

console.log("party");
await nav("Matchmaker");
const inviteBox = page.getByPlaceholder("Invite by name");
await inviteBox.fill("hexed");
await inviteBox.press("Enter");
check("the invite goes out", await waitFor("inv", () => sentAny(/^InviteToParty \{.*"hexed"/)));
/* The invite used to produce no evidence at all. The server answers only if
   they accept, which can be never, so the honest confirmation is what we did
   rather than what arrived. */
check("and says so, so it does not look like nothing happened",
  await waitFor("toast", () => seeing(/Invited hexed/)));
check("the party appears once the server confirms it",
  await waitFor("party", () => seeing(/PARTY/) && seeing(/hexed/)));
await page.evaluate(() => window.__ZKS.push('OnPartyInvite ' + JSON.stringify({
  PartyID: 8, UserNames: ["lorelei", "Qrow"], TimeoutSeconds: 20 })));
check("an incoming invite interrupts", await waitFor("pinv", () => seeing(/want you in their party/)));
await clickDialog(/Join party/);
check("the response carries the party id",
  await waitFor("presp", () => sentAny(/^PartyInviteResponse \{"PartyID":8,"Accepted":true\}/)));

console.log("rejoin offer");
await page.evaluate(() => window.__ZKS.push('RejoinOption {"BattleID":13}'));
check("a running game we were in is offered back",
  await waitFor("rejoin", () => seeing(/still in a game/)));
await clickDialog(/^Rejoin$/);
check("taking it asks for connect details",
  await waitFor("rj", () => sentAny(/^RequestConnectSpring \{"BattleID":13/)));

console.log("reconnect");
await nav("Battles");
// The kick test left us in a room; the battle list is behind it.
const leave = page.getByRole("button", { name: /^Leave$/ });
if (await leave.count()) await leave.first().click();
check("back on the battle list before dropping the socket",
  await waitFor("battles", () => seeing(/Host a battle/)));
/* The title appears in the row and again in the detail panel, so the count is
   two to begin with; what matters is that a replay does not add to it. */
const rowsBefore = await page.getByText(/^Teams 8v8 - all welcome$/).count();
await page.evaluate(() => window.__ZKS.drop("reset by peer"));
check("a dropped socket is retried without asking",
  await waitFor("dropped", () => seeing(/Reconnecting - attempt 1/)));
check("and comes back on its own", await waitFor("recon", () => seeing(/Connected/), 15000));
check("a reconnect leaves the room we are no longer in",
  await waitFor("outofroom", () => seeing(/Host a battle/)));
const rowsAfter = await page.getByText(/^Teams 8v8 - all welcome$/).count();
check("and the directory is replayed, not doubled", rowsAfter === rowsBefore,
  `before ${rowsBefore}, after ${rowsAfter}`);

console.log("settings");
await page.locator("nav button").last().click();
check("settings knows who we are and where Zero-K is",
  await waitFor("settings", () => seeing(/Zero-K installation/) && seeing(/Qrow/)));
check("the detected install is shown", await seeing(/steamapps/));
const badMark = await mark();
await page.getByPlaceholder("Leave empty to detect automatically").fill("D:/nonsense");
await page.getByRole("button", { name: /^Apply$/ }).first().click();
check("a path that is not an install says so, rather than failing at the engine",
  await waitFor("badroot", () => seeing(/is not a Zero-K installation/)));
await page.getByPlaceholder("Leave empty to detect automatically").fill("");
await page.getByRole("button", { name: /^Apply$/ }).first().click();
check("clearing the override goes back to detection",
  await waitFor("goodroot", () => seeing(/steamapps/)));
await clickText(/Check launch setup/);
check("the launch preflight resolves an engine without starting a game",
  await waitFor("preview", () => seeing(/Ready to launch/) && seeing(/spring\.exe/)));
check("and names the data dir, which is what a missing map is really about",
  await seeing(/DATA DIR/));

await page.locator("label", { hasText: "Away" }).first().click();
check("away is a status the server is told about",
  await waitFor("afk", () => sentSince(badMark, /^ChangeUserStatus \{"IsAfk":true\}/)));
await shot("live-08-settings");

console.log("debriefing");
await page.evaluate(() => window.__ZKS.push(JSON.stringify({
  DebriefingUsers: {
    Qrow: { AccountID: 1, AllyNumber: 0, Awards: [], EloChange: 18, NewElo: 1860, NewRank: 4,
      IsInVictoryTeam: true, IsLevelUp: false, IsRankup: true, IsRankdown: false,
      PrevRankElo: 1750, NextRankElo: 1900, XpChange: 640, NewXp: 12480,
      PrevLevelXp: 9000, NextLevelXp: 16000 },
    hexed: { AccountID: 2, AllyNumber: 1, Awards: [], EloChange: -18, NewElo: 1772, NewRank: 3,
      IsInVictoryTeam: false, IsLevelUp: false, IsRankup: false, IsRankdown: false },
  },
  ServerBattleID: 55, RatingCategory: "Team", Url: "https://zero-k.info/Battles/Detail/55",
}).replace(/^/, "BattleDebriefing ")));
check("a finished match pulls you to the debriefing",
  await waitFor("debrief", () => seeing(/Victory/)));
check("both sides are listed", await seeing(/hexed/) && await seeing(/Qrow/));
/* NewRank 4 is Giant. "Rank up - Rank 4" told you an array index - and before
   that the panel did not render at all, because the view called it `rating`
   and the screen read `d.elo`. */
check("a rank up names the rank Zero-K ranked you up into",
  await seeing(/Rank up - Giant/) && !(await seeing(/Rank up - 4/)));
check("and the rating panel renders for a real match at all",
  await seeing(/RATING/) && await seeing(/1860/));
await shot("live-07-debrief");

/* A match ends with everyone still sitting in the room they played from, so
   "back" from the debriefing means that room - and so does the first press of
   Battles, which used to walk past the thing you were about to do again. */
console.log("back from a debriefing");
await nav("Battles");
await waitFor("list-again", () => seeing(/Host a battle/));
await page.getByText(/^Teams 8v8 - all welcome$/).first().dblclick();
await waitFor("in-room-again", () => seeing(/SPECTATORS/));
await page.evaluate(() => window.__ZKS.push(JSON.stringify({
  DebriefingUsers: {
    Qrow: { AccountID: 1, AllyNumber: 0, Awards: [], EloChange: 5, NewElo: 1865, NewRank: 4,
      IsInVictoryTeam: true, IsLevelUp: false, IsRankup: false, IsRankdown: false },
  },
  ServerBattleID: 56, RatingCategory: "Team",
}).replace(/^/, "BattleDebriefing ")));
check("the debriefing offers the room, not the battle list",
  await waitFor("back-label", () => seeing(/Back to room/)));
await nav("Battles");
check("and Battles from the debriefing goes to the room",
  await waitFor("rail-to-room", () => seeing(/SPECTATORS/)));
await nav("Battles");
check("but from the room it means the list again",
  await waitFor("rail-to-list", () => seeing(/Host a battle/)));
await clickText(/^Leave$/);
/* Zero-K installed by Shiro rather than found. The engine version is never
   chosen here - it is the one the server named in Welcome, so the only engine
   ever fetched is the one a game is about to need. */
console.log("installing zero-k ourselves");
await page.locator("nav button").last().click();
await waitFor("settings-again", () => seeing(/Zero-K installation/));
check("the option to have Shiro install it is offered",
  await seeing(/Managed install/i));
check("and it says where it would go", await seeing(/AppData/i));
await clickText(/Set up an install here/);
check("the engine the server asked for is the one requested",
  await waitFor("engine-asked", async () =>
    (await page.evaluate(() => window.__ZKS.engineAsked)) === "2025.06.21"));
check("and the install reports itself as ready",
  await waitFor("engine-done", () => seeing(/2025\.06\.21 - installed/)));
/* An engine on disk is not an installation until the rest of the app is
   pointed at it. `installRoot` is already threaded through detection, the
   content preflight, the archive reader and the launcher, so this is the one
   thing that has to happen - and the game download proves it did. */
check("the game is fetched into the directory Shiro just filled",
  await waitFor("game-fetch", async () => {
    const f = await page.evaluate(() => window.__ZKS.lastFetch);
    return Boolean(f) && f.installRoot === "C:\\Users\\test\\AppData\\Roaming\\shiro\\zk"
      && f.items.some(i => i.name === "Zero-K v1.14.8.0");
  }));
check("and the launcher is pointed at it too",
  await waitFor("root-set", () => seeing(/AppData\\Roaming\\shiro\\zk|AppData.Roaming.shiro.zk/)));
await clickText(/Remove it/);
check("removing it goes back to offering a set-up",
  await waitFor("removed", () => seeing(/Set up an install here/)));

console.log("logging out");
await page.locator("nav button").last().click();
await waitFor("settings", () => seeing(/Zero-K installation/));
await clickText(/^Log out$/);
check("logging out returns to the login screen",
  await waitFor("loggedout", () => seeing(/Steam accounts need a lobby password/)));
check("and remembers the name, which is not a secret", await waitFor("name", async () =>
  (await page.locator("input").first().inputValue()) === "Qrow"));
check("but not the password", await waitFor("pw", async () =>
  (await page.locator("input").nth(1).inputValue()) === ""));

console.log("a refused login");
/* A refusal must not be retried. The server closes the connection after
   refusing, which arrives as a plain disconnect - and the reconnect only asked
   whether there was a session, not whether the credentials had been any good.
   So it reconnected, Welcome arrived, and the same bad hash went out again on a
   backoff: the LogIpFailure spiral that ends with the IP banned. */
const rejectMark = await mark();
await page.locator("input").nth(0).fill("shiro-wrong");
await page.locator("input").nth(1).fill("whatever");
await page.keyboard.press("Enter");
check("the refusal reaches the screen",
  await waitFor("refused", () => seeing(/Invalid password/i)));
/* Past the first backoff step, which is where a retry would land. */
await page.waitForTimeout(3500);
check("and the bad credentials are not sent again",
  (await sent()).slice(rejectMark).filter(l => /^Login /.test(l)).length === 1);
check("and it is not still trying to reconnect",
  !(await seeing(/reconnecting/i)));

/* The two ways a connection can end before a login has begun. Both are the
   attempt failing, and the player is looking at the login screen either way -
   so neither is a session to go on dialling for behind it. That retry used to
   run, unseen, and a server that came back would log the player in with
   nothing on screen saying so. */
console.log("a connection that ends before the login does");
await page.evaluate(() => { window.__ZKS.connectAs = "hang up"; window.__ZKS.connects = 0; });
await page.locator("input").nth(0).fill(USER);
await page.locator("input").nth(1).fill(PASS);
await page.keyboard.press("Enter");
check("a server that accepts and hangs up is reported, not waited on",
  await waitFor("hungup", () => seeing(/Lost connection/i)));
/* Past the first backoff step, which is where a retry would land. */
await page.waitForTimeout(3000);
check("and is not dialled again behind the login screen",
  (await page.evaluate(() => window.__ZKS.connects)) === 1);
check("which is where we still are",
  await seeing(/Steam accounts need a lobby password/));

await page.evaluate(() => { window.__ZKS.connectAs = "refuse"; window.__ZKS.connects = 0; });
await page.locator("input").nth(1).fill(PASS);
await page.keyboard.press("Enter");
check("a dial that never connects says so as well",
  await waitFor("refused-dial", () => seeing(/connection refused/i)));
await page.waitForTimeout(3000);
check("and is not retried either",
  (await page.evaluate(() => window.__ZKS.connects)) === 1);
await page.evaluate(() => { window.__ZKS.connectAs = "ok"; });

console.log("");
console.log(`${checks - failures.length}/${checks} checks passed`);
if (errors.length) {
  console.log("page errors:");
  for (const e of errors) console.log("  " + e);
}
await browser.close();
process.exit(failures.length || errors.length ? 1 : 0);
