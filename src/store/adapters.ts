/**
 * Adapters from protocol shapes to the props the Shiro design components expect.
 * Kept separate so the design kit never has to know about the wire format.
 */
import type * as T from "../protocol/types.ts";
import type { AutohostMode, LoginResponse_Code, SyncStatuses } from "../protocol/enums.ts";
import type { ConnectionState } from "./lobby.ts";
import { changedOptions, type ModOptionDisplay } from "../net/modOptions.ts";
import { playerRank, rankColour } from "../net/ranks.ts";

/**
 * `AutohostMode` and `LoginResponse_Code` restated as literals.
 *
 * The unit tests run under Node's type-stripping loader, which refuses a TS
 * `enum` - a runtime construct - so this module must not import one. The
 * annotations are checked against the generated enums at compile time, so if
 * upstream renumbers a case this file stops compiling rather than quietly
 * labelling every battle "Custom". Same reasoning as store/chat.ts.
 */
const MODE_NONE: AutohostMode.None = 0;
const MODE_PLANETWARS: AutohostMode.Planetwars = 2;
const MODE_1V1: AutohostMode.Game1v1 = 3;
const MODE_FFA: AutohostMode.GameFFA = 4;
const MODE_CHICKENS: AutohostMode.GameChickens = 5;
const MODE_TEAMS: AutohostMode.Teams = 6;

/** Display labels from the upstream [Description] attributes. */
const MODE_LABEL: Record<number, string> = {
  [MODE_NONE]: "Custom",
  [MODE_PLANETWARS]: "PlanetWars",
  [MODE_1V1]: "1v1",
  [MODE_FFA]: "FFA",
  [MODE_CHICKENS]: "Cooperative",
  [MODE_TEAMS]: "Teams",
};

const CODE_INVALID_NAME: LoginResponse_Code.InvalidName = 2;
const CODE_BANNED: LoginResponse_Code.Banned = 4;

/** The upstream [Description] strings, so we say what the official client says. */
const LOGIN_CODE_LABEL: Record<number, string> = {
  0: "Ok",
  2: "invalid name",
  3: "invalid password",
  4: "banned",
  5: "invalid steam token, are you in offline mode?",
  6: "banned, too many connection attempts",
  7: "your steam account is not linked yet, send ZK login or register",
  8: "your steam account is already linked to a different account",
  9: "sorry, the server is full, please retry later",
  10: "invalid RSA signature",
  11: "RSA signature could not be verified (pub key not known)",
};

/** The upstream [Description] strings for registration outcomes. */
const REGISTER_CODE_LABEL: Record<number, string> = {
  1: "You are already connected.",
  2: "That name is taken.",
  3: "That password is not acceptable.",
  4: "That account is banned.",
  5: "That name has characters the server will not accept.",
  6: "Invalid Steam token - are you in offline mode?",
  7: "That Steam account is already registered.",
  8: "Missing both password and token.",
  9: "Too many attempts. Wait a while before trying again.",
  10: "Already linked to Steam; log in instead.",
  11: "Already registered - log in with your password.",
};

/** Turn a failed registration into something a person can act on. */
export function describeRegisterFailure(code: number, message?: string): string {
  if (code === 4 && message) return `Banned: ${message}`;
  return REGISTER_CODE_LABEL[code] ?? `Registration failed (error ${code}).`;
}

function modeLabel(mode: number | undefined): string {
  return MODE_LABEL[mode ?? MODE_NONE] ?? "Custom";
}

export interface BattleRowModel {
  id: number;
  title: string;
  map: string;
  founder: string;
  players: number;
  maxPlayers: number;
  spectators: number;
  mode: string;
  locked: boolean;
  running: boolean;
  runningSince?: number;
  matchmaker: boolean;
  /** Every player slot is taken. See `capacity` for what that costs you. */
  full: boolean;
  /** How many players are past the cap. See `capacity`. */
  queued: number;
}

/**
 * How full a room is, and what walking into a full one actually does.
 *
 * There is no join queue: the protocol has no queue message, no join refusal
 * and no position, and `ProcessPlayerJoin` refuses only a wrong password or a
 * kick. What a full room does instead is silent - `ValidateBattleStatus` sets
 * `IsSpectator` on the arrival and sends them a private "This battle is full."
 * Nobody is ever promoted back; a slot that frees up goes to whoever claims it.
 *
 * That is not the same as the people waiting being anonymous, though - see
 * `waitingToPlay`, which names them. This function is only the counts, because
 * counts are all a `BattleHeader` carries and the battle list has nothing else.
 *
 * `PlayerCount` counts non-spectators and excludes bots, so it is the number
 * against `MaxPlayers`. It can exceed it, in a room where the server's time
 * queue is on: everyone may call themselves a player, and `StartGame` spectates
 * whoever declared last - `OrderBy(QueueOrder)` - down to the cap.
 */
function capacity(b: T.BattleHeader): { full: boolean; queued: number } {
  const players = b.PlayerCount ?? 0;
  const max = b.MaxPlayers ?? 0;
  // A room that never said how big it is cannot be full.
  if (max <= 0) return { full: false, queued: 0 };
  return { full: players >= max, queued: Math.max(0, players - max) };
}

/** BattleRow renders `runningSince` as elapsed mm:ss, so convert the timestamp. */
function elapsedSeconds(iso?: string): number | undefined {
  if (!iso) return undefined;
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return undefined;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

export function battleToRow(b: T.BattleHeader): BattleRowModel | null {
  if (b.BattleID == null) return null;
  return {
    id: b.BattleID,
    title: b.Title ?? "(untitled)",
    map: b.Map ?? "",
    founder: b.Founder ?? "",
    players: b.PlayerCount ?? 0,
    maxPlayers: b.MaxPlayers ?? 0,
    spectators: b.SpectatorCount ?? 0,
    mode: modeLabel(b.Mode),
    locked: Boolean(b.Password),
    running: Boolean(b.IsRunning),
    runningSince: elapsedSeconds(b.RunningSince),
    matchmaker: Boolean(b.IsMatchMaker),
    ...capacity(b),
  };
}

/**
 * The battle list, busiest first.
 *
 * "Participants" is everyone in the room, spectators included: a 1v1 with a
 * dozen people watching is a busier room than an empty 16-slot lobby, and the
 * question this list answers is where everybody is.
 *
 * Ties break public before passworded, because a room you can join is a more
 * useful answer than one you cannot.
 *
 * Running games are no longer sorted to the bottom - the order above is the
 * whole order. The list has a "Hide running" filter for people who do not want
 * to see them at all, which is a better tool for that than a sort key nobody
 * asked for.
 */
export function battleList(battles: Record<number, T.BattleHeader>): BattleRowModel[] {
  const occupants = (b: BattleRowModel) => b.players + b.spectators;
  return Object.values(battles)
    .map(battleToRow)
    .filter((b): b is BattleRowModel => b !== null)
    .sort((a, b) =>
      occupants(b) - occupants(a)
      || Number(a.locked) - Number(b.locked)
      // Stable and predictable when a room ties on both, rather than whatever
      // order the server happened to mention them in.
      || a.title.localeCompare(b.title));
}

/**
 * The three states AppShell's StatusBar knows about.
 *
 * A dropped connection with a retry already scheduled is "reconnecting", not
 * "offline": the difference to a player is whether anything is being done about
 * it, and something is. Only a session with no retry pending - never logged in,
 * or torn down - reads as offline.
 */
export function statusBarKind(
  c: ConnectionState,
  reconnectAttempt = 0,
): "online" | "reconnecting" | "offline" {
  switch (c.kind) {
    case "online": return "online";
    case "connecting":
    case "connected":
    case "loggingIn": return "reconnecting";
    default: return reconnectAttempt > 0 ? "reconnecting" : "offline";
  }
}

/**
 * Turn a failed connection into copy a player can act on. Uses the upstream
 * [Description] strings so we say what the official client says.
 */
export function describeFailure(c: ConnectionState): string {
  if (c.kind === "rejected") {
    const label = LOGIN_CODE_LABEL[c.code] ?? `error ${c.code}`;
    if (c.code === CODE_INVALID_NAME) {
      // Names are case-sensitive in practice - see ARCHITECTURE.md section 5.
      return "No account with that name. Check the spelling and capitalisation.";
    }
    if (c.code === CODE_BANNED && c.message) return `Banned: ${c.message}`;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (c.kind === "disconnected") return `Lost connection: ${c.reason}`;
  return "Could not connect.";
}

/* ------------------------------------------------------------------ room ---
 * The battle room screen wants teams, spectators and chips; the protocol gives
 * a header, a status map keyed by name and the global user directory. This is
 * where those meet.
 */

/** Factions the design kit has marks for. Real Planetwars faction names that
 *  are not among them get no mark rather than a wrong one. */
const FACTION_MARKS = new Set(["machines", "hegemony", "rising"]);

/**
 * The most ally teams a Zero-K game can have.
 *
 * Not an engine limit, which is what this used to claim: the engine's cap is
 * `MAX_TEAMS = 255` and it has no allyteam constant at all. The binding number
 * is the lobby server's, in `ScriptGenerator.MaxAllies`, because that is the
 * code that writes the game's script:
 *
 *     public const int MaxAllies = 16;
 *     for (var allyNumber = 0; allyNumber < MaxAllies; allyNumber++)
 *         script.AppendFormat("[ALLYTEAM{0}]\n", allyNumber);
 *
 * Exactly sixteen `[ALLYTEAM]` blocks, numbered 0 to 15, every game. A player
 * on ally 16 or above lands in a `[TEAM]` pointing at an allyteam that was
 * never declared, and the engine refuses the script outright - `invalid
 * Team.Allyteam in GameSetup script` - rather than clamping. So this is a real
 * ceiling on what a room can use, not a drawing budget, and clamping the
 * columns to it keeps us from offering a team that would break the game.
 *
 * Index 16 does show up in a running game's log, as the engine appending Gaia
 * after the declared ones. It is not a team anybody joins.
 *
 * "Usually up to 32" is a different number: `MaximumBattlePlayers`, the cap on
 * *players* in a non-autohost room. Thirty-two players still share sixteen
 * allyteams at most.
 */
const MAX_ALLY_TEAMS = 16;

export interface ChipModel {
  name: string;
  clan?: string;
  country?: string;
  faction?: string;
  level?: number;
  elo?: number;
  /** The colour this player's rank icon carries. See src/net/ranks.ts. */
  eloTint?: string;
  bot?: boolean;
  admin?: boolean;
  presence: "online" | "away" | "room" | "ingame" | "offline";
}

/* `SyncStatuses` restated as literals, for the reason given at the top of this
   file. */
const SYNC_SYNCED: SyncStatuses.Synced = 1;
const SYNC_UNSYNCED: SyncStatuses.Unsynced = 2;

/**
 * What `PlayerRow` draws beside a name: nothing, a muted download arrow, or a
 * red cross.
 *
 * Three protocol states onto the design kit's three, and the middle one is the
 * reason this is not a boolean. `Unknown` means the client has never reported -
 * not that it lacks the content - so it gets the quiet mark rather than the
 * accusatory one. `!start` still names them, which is why it cannot be silent
 * either.
 */
export type SyncMark = "ok" | "downloading" | "missing";

export function syncMark(sync: SyncStatuses | undefined): SyncMark {
  if (sync === SYNC_SYNCED) return "ok";
  if (sync === SYNC_UNSYNCED) return "missing";
  return "downloading";
}

export interface RoomPlayerModel {
  user: ChipModel;
  host?: boolean;
  party?: number;
  spectator?: boolean;
  /** Whether they have the map and game. Spread straight into `PlayerRow`. */
  sync?: SyncMark;
}

export interface RoomModel {
  id: number;
  title: string;
  map: string;
  /** What the room runs. Often Zero-K itself; sometimes Supreme-K or another
      custom game, which is the case worth showing. */
  game: string;
  founder: string;
  mode: string;
  running: boolean;
  /**
   * Player slots taken, and how many there are.
   *
   * Counted from the roster rather than read off `PlayerCount`, which the
   * server only re-broadcasts every five seconds - the roster is the thing
   * drawn beside it, so the two must not disagree. Bots take no slot: the
   * server counts them separately and they are not what fills a room up.
   */
  players: number;
  maxPlayers: number;
  /** See `capacity`. `queued` is the time-queue overflow, usually zero. */
  full: boolean;
  queued: number;
  /** What the host changed, by name. Defaults are not worth listing. */
  options: ModOptionDisplay[];
  teams: Array<{ ally: number; players: RoomPlayerModel[] }>;
  /**
   * How many players fit on one team.
   *
   * The room's own cap divided by the teams it is showing, rather than the
   * hardcoded eight the columns used to count to. A sixteen-way FFA holds one
   * each, and saying "0/8" under all sixteen of them was both wrong and the
   * reason every column demanded eight rows of height.
   *
   * Never below the fullest team: allyteams need not be balanced, and a column
   * already holding ten people cannot claim a capacity of eight.
   */
  teamSize: number;
  spectators: RoomPlayerModel[];
  /**
   * Who wants to play and is not going to, by name, in the server's own order.
   * Null when nobody is - which is the usual case.
   *
   * What this is not: a promise. Nothing in the protocol holds anyone a place,
   * and the two kinds carry different certainty.
   *
   * `queue` is exact for the instant it is drawn - the same arithmetic
   * `StartGame` does, over the same numbers - but the room keeps moving, so it
   * is a statement about now rather than about the game that eventually starts.
   *
   * `refused` is a fact about the past: these people asked to play and the
   * server said no. It does not say why. `ValidateBattleStatus` flips the same
   * bit for a full room and for an Elo, level or rank limit, and the limits are
   * never serialized - so the screen reads `full` to tell the likely story and
   * hedges when the room is not full. It is also erased rather than updated:
   * `ValidateAllBattleStatuses` re-runs on every user after a game ends or a
   * host changes a limit, and by then a forced spectator takes the `else` and
   * is reset to -1. So this list shrinks silently at those moments; it never
   * grows a name that did not ask to play.
   */
  waitingToPlay: WaitingModel | null;
  /**
   * The players `!start` would name as still downloading, by name.
   *
   * Anyone not `Synced`, which includes anyone who has never reported: that is
   * the set `CmdStart` gathers, and being in it delays everybody's game by ten
   * seconds. Bots and spectators are never in it - see `roomModel`.
   */
  waitingOn: string[];
}

/**
 * A `User` record as the design kit's chips want it.
 *
 * Presence is derived, not sent: the protocol has no status field. `User` is
 * only broadcast for people who are connected, so someone absent from the
 * directory is offline - which is how a friend who logged off, or the author of
 * a chat line from before we connected, renders correctly.
 */
export function userToChip(u: T.User | undefined, name: string): ChipModel {
  const faction = u?.Faction?.toLowerCase();
  return {
    /* The Zero-K account name, never DisplayName. For a Steam-linked account
       DisplayName is the Steam persona, which is not the name anyone is known
       by in the lobby, is not what you type to add a friend, and is not what
       the server matches on. */
    name: u?.Name || name,
    clan: u?.Clan || undefined,
    country: u?.Country || undefined,
    faction: faction && FACTION_MARKS.has(faction) ? faction : undefined,
    level: u?.Level || undefined,
    elo: u?.EffectiveElo ? Math.round(u.EffectiveElo) : undefined,
    /* Tinted by rank, which is what the game tints the rating number by. The
       server sends the rank, so the Elo is only ever a last resort here. */
    eloTint: rankColour(playerRank({
      icon: u?.Icon, rank: u?.Rank, elo: u?.EffectiveElo || undefined,
    })),
    bot: u?.IsBot || undefined,
    admin: u?.IsAdmin || undefined,
    presence: !u ? "offline"
      : u.InGameSince ? "ingame"
      : u.AwaySince ? "away"
      : u.BattleID != null ? "room"
      : "online",
  };
}

/* ------------------------------------------------------------------ chat ---
 * `ChatLine` spreads its `user` prop into a `UserChip`, so it wants the whole
 * chip - clan, country, rating - not the bare name the store keeps. The store
 * is right to keep a name: it is what the wire carries, and the chip is a
 * snapshot that would go stale the moment the sender changed rooms. Joining
 * the two is a render-time concern, so it happens here.
 */
export interface ChatLineModel {
  id?: number;
  time?: string;
  text?: string;
  user?: ChipModel;
  emote: boolean;
  ring: boolean;
  system: boolean;
}

export interface StoredChatMessage {
  id?: number;
  time?: string;
  user?: string;
  text?: string;
  emote: boolean;
  ring: boolean;
  system: boolean;
}

/**
 * `ignored` drops lines rather than greying them: the point of ignoring someone
 * is not to read them. History is not rewritten - the messages stay in the
 * store, so un-ignoring brings the backlog back.
 */
export function chatLines(
  messages: readonly StoredChatMessage[],
  users: Record<string, T.User>,
  ignored?: ReadonlySet<string>,
): ChatLineModel[] {
  const visible = ignored && ignored.size
    ? messages.filter(m => !m.user || !ignored.has(m.user))
    : messages;
  return visible.map(m => ({
    id: m.id,
    time: shortTime(m.time),
    text: m.text,
    // A system notice has no sender, and must not get an empty chip.
    user: m.user ? userToChip(users[m.user], m.user) : undefined,
    emote: m.emote,
    ring: m.ring,
    system: m.system,
  }));
}

/**
 * `HH:MM` in local time. The server sends ISO-8601 UTC; a chat log stamped in
 * another timezone is worse than no stamp at all.
 */
export function shortTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ----------------------------------------------------------------- news ---
 * Lobby news, which the server has always sent and the client has never shown.
 *
 * Ten items at most, pinned first and then newest, rebuilt and rebroadcast to
 * everyone whenever an admin edits them on zero-k.info.
 *
 * `NewsItem` is five nullable strings and the server serialises with
 * `NullValueHandling.Ignore`, so absent means absent: an item is a headline, or
 * a headline and a link, or all five, and nothing here may assume the next
 * field along is there. `Time` in particular: every item the live server was
 * seen to send came back without one, because the site's news form leaves
 * `EventTime` alone. The stamp below is a thing that appears when a moderator
 * bothers to set it, not a line of the layout.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `3 Aug`, or `3 Aug 2019` for anything not from this year.
 *
 * Built by hand rather than with `Intl`, for `shortTime`'s reason: the stamp
 * has to be the same string on every machine that runs the tests. The year is
 * there because a pinned item stays pinned - the top of this list is routinely
 * older than the bottom, and `3 Aug` alone would read as three weeks ago.
 */
export function shortDate(iso: string | undefined, now = new Date()): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const stamp = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? stamp : `${stamp} ${d.getFullYear()}`;
}

/**
 * The picture for a news item, if it has one.
 *
 * Two things make this more than a passthrough:
 *
 * - An item WITHOUT a picture still carries this field. The server writes
 *   `$"{GlobalConst.BaseSiteUrl}{x.ImageRelativeUrl}"`, and the relative URL is
 *   null when the row has no image extension, which interpolates to nothing -
 *   so "no picture" arrives as the bare site URL. Rendered as an `<img>` that
 *   is a request for the site's front page and a broken image.
 * - `GlobalConst` sets `BaseSiteUrl` to `http://zero-k.info` in live mode, and
 *   the app's CSP allows `img-src https://zero-k.info` and nothing plaintext.
 *   The site serves the same bytes over TLS - the design system already loads
 *   every map thumbnail from `https://zero-k.info/Resources/` - so the scheme
 *   is upgraded here rather than the CSP being widened to allow cleartext.
 */
export function newsImage(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.pathname === "" || url.pathname === "/") return undefined;
  url.protocol = "https:";
  return url.href;
}

export interface NewsModel {
  header?: string;
  text?: string;
  /** Rendered date, on the rare item that carries one. Usually absent. */
  when?: string;
  /** Where the item points. Absent for an announcement with nothing to open. */
  url?: string;
  image?: string;
}

/**
 * Wire items to what the strip draws.
 *
 * An item with nothing but a picture, or nothing but a headline, is a legal
 * item and gets a row. An item with none of the three has nothing to draw and
 * is dropped rather than left as an empty gap somebody would take for a bug.
 */
export function newsList(items: readonly T.NewsItem[] | undefined): NewsModel[] {
  return (items ?? [])
    .map(n => ({
      header: n.Header || undefined,
      text: n.Text || undefined,
      when: shortDate(n.Time),
      url: n.Url || undefined,
      image: newsImage(n.Image),
    }))
    .filter(n => n.header || n.text || n.image);
}

/* -------------------------------------------------------------- waiting ---
 * Who wants to play and is not going to.
 *
 * The protocol has no waitlist message, which is where an earlier reading of it
 * stopped. It does not need one: `UserBattleStatus.QueueOrder` is a plain
 * serialized field - only `LobbyUser` carries `[JsonIgnore]` - and
 * `ToUpdateBattleStatus()` puts it in every `UpdateUserBattleStatus` the server
 * broadcasts to the room. So the ordering the server itself sorts by is on the
 * wire, per person, by name.
 *
 * `ValidateBattleStatus` is what makes it a discriminator. Its outer test is
 * read once, on entry:
 *
 *     if (!ubs.IsSpectator) {
 *         if (!TimeQueueEnabled && players > MaxPlayers) ubs.IsSpectator = true;
 *         ...elo, level and rank limits, each also setting IsSpectator...
 *         if (ubs.QueueOrder <= 0) ubs.QueueOrder = ++QueueCounter;
 *     } else ubs.QueueOrder = -1;
 *
 * Somebody who arrived wanting to play and was flipped inside that branch still
 * falls through to the stamp, so they end up a spectator with a positive
 * `QueueOrder`. Somebody who was already spectating takes the `else` and gets
 * -1. That is the difference between "spectating because the room said no" and
 * "spectating by choice", and it is the whole basis of this list.
 */

/** `ValidateBattleStatus`'s `else` branch. Anyone who never asked to play. */
const SPECTATOR_BY_CHOICE = -1;

/**
 * Why these people are not playing, which changes what can honestly be said.
 *
 * `queue` - the room's time queue is on, so nobody was refused on the way in
 * and these are still players. They are exactly who `StartGame` would move to
 * the spectators if it ran now, computed the way it computes them.
 *
 * `refused` - the time queue is off, so the server already moved them when they
 * asked to play. We know that happened; we do not always know why. See
 * `RoomModel.waitingToPlay`.
 */
export type WaitingKind = "queue" | "refused";

export interface WaitingModel {
  /** In the order the server will act on, soonest to be cut last. */
  players: RoomPlayerModel[];
  kind: WaitingKind;
}

/** Ascending, which is the direction `OrderBy(x => x.QueueOrder)` sorts. */
function byQueueOrder(a: Seat, b: Seat): number {
  return (a.status.QueueOrder ?? 0) - (b.status.QueueOrder ?? 0)
    // Two people the server has not distinguished must still order the same
    // way twice, or the list reshuffles on every unrelated status update.
    || (a.entry.user.name).localeCompare(b.entry.user.name);
}

interface Seat { entry: RoomPlayerModel; status: T.UpdateUserBattleStatus }

/**
 * The set `StartGame` would cut, computed exactly as it computes it:
 *
 *     int allowedPlayers = MaxPlayers;
 *     if (players.Count(x => !x.IsSpectator) <= MaxEvenPlayers)
 *         allowedPlayers = players.Count(x => !x.IsSpectator) & ~0x1;
 *     foreach (var plr in players.Where(x => !x.IsSpectator)
 *                                .OrderBy(x => x.QueueOrder)
 *                                .Skip(allowedPlayers))
 *         plr.IsSpectator = true;
 *
 * Both numbers it needs are on the `BattleHeader`. The odd one out is
 * `MaxEvenPlayers`: under it the room drops to an even number of players rather
 * than its cap, because an odd game is worse than a smaller one.
 */
function timeQueueCut(battle: T.BattleHeader, playing: Seat[]): Seat[] {
  const maxPlayers = battle.MaxPlayers ?? 0;
  const maxEven = battle.MaxEvenPlayers ?? 0;
  const allowed = playing.length <= maxEven ? playing.length & ~1 : maxPlayers;
  /* A room that never said its cap would otherwise cut everybody. Saying
     nothing is the only honest answer when the number the server will use is
     the one we were not sent. */
  if (allowed <= 0) return [];
  return [...playing].sort(byQueueOrder).slice(allowed);
}

/** See `RoomModel.waitingToPlay`. */
function waitingToPlay(battle: T.BattleHeader, seats: Seat[]): WaitingModel | null {
  if (battle.TimeQueueEnabled) {
    const cut = timeQueueCut(battle, seats.filter(s => !s.status.IsSpectator));
    return cut.length ? { players: cut.map(s => s.entry), kind: "queue" } : null;
  }
  const refused = seats
    .filter(s => s.status.IsSpectator
      && (s.status.QueueOrder ?? SPECTATOR_BY_CHOICE) > 0)
    .sort(byQueueOrder);
  return refused.length ? { players: refused.map(s => s.entry), kind: "refused" } : null;
}

/** The eight the team columns counted to before the room's own cap was used.
 *  Still the answer for a room that never said how big it is. */
const DEFAULT_TEAM_SIZE = 8;

/** See `RoomModel.teamSize`. */
function teamSize(maxPlayers: number, teams: Array<{ players: unknown[] }>): number {
  const fullest = teams.reduce((n, t) => Math.max(n, t.players.length), 0);
  if (maxPlayers <= 0 || teams.length === 0) return Math.max(DEFAULT_TEAM_SIZE, fullest);
  return Math.max(1, Math.ceil(maxPlayers / teams.length), fullest);
}

/**
 * Assemble the room view.
 *
 * Ally numbers are sparse and arbitrary - a 1v1 can be allies 0 and 3 - so
 * teams are the ally numbers actually present, in order, rather than a range.
 * Bots sit in their ally column beside the humans; that is where the engine
 * puts them and where a player looking for a fair game expects to count them.
 */
export function roomModel(
  battle: T.BattleHeader | undefined,
  players: Record<string, T.UpdateUserBattleStatus>,
  bots: Record<string, T.UpdateBotStatus>,
  users: Record<string, T.User>,
  modOptions: Record<string, string>,
  party?: { id?: number; members: string[] },
): RoomModel | null {
  if (!battle || battle.BattleID == null) return null;

  const spectators: RoomPlayerModel[] = [];
  const byAlly = new Map<number, RoomPlayerModel[]>();
  const place = (ally: number, p: RoomPlayerModel) => {
    const list = byAlly.get(ally);
    if (list) list.push(p);
    else byAlly.set(ally, [p]);
  };

  const waitingOn: string[] = [];
  const seats: Seat[] = [];
  let slotsTaken = 0;

  /* Who to mark as party. This used to read `User.PartyID`, which the server
     declares and never sends - it is `[JsonIgnore]`, so the field arrived
     undefined for everybody and the marker `PlayerRow` draws has never once
     appeared. `OnPartyStatus` is the real answer and the party store already
     keeps it.

     Only our own party can be marked, and that is not a shortcut: the server
     sends `OnPartyStatus` to the party's own members, so somebody else's party
     is not something this client is told about. */
  const inParty = new Set(party?.members ?? []);

  for (const [name, status] of Object.entries(players)) {
    const entry: RoomPlayerModel = {
      user: userToChip(users[name], name),
      host: name === battle.Founder || undefined,
      party: inParty.has(name) ? party?.id : undefined,
    };
    /* Spectators carry a sync status too, and it is deliberately not drawn.
       The question this mark answers is who is delaying the start, and a
       spectator never is - `CmdStart` gathers players only. Marking them would
       put a red cross beside people nobody is waiting for.

       The seat keeps the row it built rather than a copy of it, so that the
       waiting list below can be subtracted from the spectators by identity. */
    let row: RoomPlayerModel;
    if (status.IsSpectator) {
      row = { ...entry, spectator: true };
      spectators.push(row);
    } else {
      const sync = syncMark(status.Sync);
      if (sync !== "ok") waitingOn.push(name);
      slotsTaken++;
      row = { ...entry, sync };
      place(status.AllyNumber ?? 0, row);
    }
    seats.push({ entry: row, status });
  }

  for (const [name, bot] of Object.entries(bots)) {
    place(bot.AllyNumber ?? 0, {
      // A bot has no account, so there is no `User` record to enrich it with.
      user: { name, bot: true, presence: "room" },
      /* And nothing to download: it runs inside somebody else's game. The
         wire carries no sync status for bots, so saying "ready" here is the
         truth rather than a default. */
      sync: "ok",
    });
  }

  const waiting = waitingToPlay(battle, seats);

  /* Every team up to one past the highest in use, and never fewer than two.
     This used to be the ally numbers actually present, which made a team you
     could join a team somebody was already on: a fresh room showed one column,
     so there was nowhere to put a second side and hosting a 1v1 was impossible
     from this screen. `!balance 2` looked broken for the same reason - with
     everyone still on ally 0 there was only ever one column to show.

     Contiguous rather than sparse, because the gap between an occupied ally 0
     and an occupied ally 3 is two teams a person can join, not a hole. Capped
     at MAX_ALLY_TEAMS, which a room can genuinely exceed: `!balance N` is
     bounded only by the player count, so a 20-player custom room can be told
     to make twenty teams and will report ally numbers the script generator has
     no block for. Clamping means we stop offering columns at the last one that
     can actually start a game.

     Two is the floor rather than "one past the highest": a 1v1 that is already
     two columns does not need an empty third, and a room where everyone sits on
     ally 0 needs somewhere to send half of them. */
  const highest = byAlly.size ? Math.max(...byAlly.keys()) : -1;
  const count = Math.min(MAX_ALLY_TEAMS, Math.max(2, highest + 1));
  const teams = Array.from({ length: count }, (_, ally) => ({
    ally,
    players: (byAlly.get(ally) ?? []).sort(
      (a, b) => Number(b.host ?? 0) - Number(a.host ?? 0)
        || a.user.name.localeCompare(b.user.name)),
  }));

  return {
    id: battle.BattleID,
    title: battle.Title ?? "(untitled)",
    map: battle.Map ?? "",
    game: battle.Game ?? "",
    founder: battle.Founder ?? "",
    mode: modeLabel(battle.Mode),
    running: Boolean(battle.IsRunning),
    players: slotsTaken,
    maxPlayers: battle.MaxPlayers ?? 0,
    ...capacity({ ...battle, PlayerCount: slotsTaken }),
    /* Only what the host changed. A room with all ninety options at their
       defaults has nothing to say, and upstream shows non-hosts the same
       thing. Names rather than keys, where we have a name. */
    options: changedOptions(modOptions),
    teams,
    teamSize: teamSize(battle.MaxPlayers ?? 0, teams),
    /* A `refused` waiter is a spectator, so listing both would name them twice
       under two headings. The waiting list is the more specific claim, so it
       wins and they come out of here. A `queue` waiter is still a player and
       was never in this list to begin with. */
    spectators: spectators
      .filter(s => !waiting?.players.includes(s))
      .sort((a, b) => a.user.name.localeCompare(b.user.name)),
    waitingToPlay: waiting,
    waitingOn: waitingOn.sort((a, b) => a.localeCompare(b)),
  };
}
