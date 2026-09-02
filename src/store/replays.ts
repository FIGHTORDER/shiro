/**
 * Searching your own replays.
 *
 * The Zero-K client lists filenames, so finding a game means remembering when
 * you played it. Everything needed to do better is already in the file -
 * `src-tauri/src/replays.rs` reads map, players, Elo, length and the winning
 * ally team out of the demo itself - and once the result is known the list
 * stops being a list and becomes a match history you can ask questions of.
 *
 * This is the asking. It is pure and lives apart from the screen for the usual
 * reason: what "you won this" means is a rule about ally teams and your own
 * name, and that is exactly the kind of thing that is wrong in a way nobody
 * notices until they are looking at somebody else's result.
 *
 * ## The query
 *
 * Bare words match the map, the game and any player. Anything else is a term:
 *
 *   map:isis        the map contains this
 *   player:aquanim  anybody in the game, including spectators
 *   with:aquanim    on your side
 *   vs:aquanim      against you
 *   won  lost       how it went for you
 *   >20m  <10m      longer or shorter than
 *   after:2026-08-01  before:2026-08-20
 *
 * Terms are ANDed, because that is what narrowing means; two bare words both
 * have to appear, though not in the same field. Anything unparseable is treated
 * as a bare word rather than rejected - somebody typing `>` on the way to
 * `>20m` should see the list settle, not an error.
 *
 * `with`, `vs`, `won` and `lost` all need to know who you are. Without a name
 * they match nothing, and the screen should say so rather than quietly
 * returning an empty list.
 */

export interface ReplayPlayer {
  name: string;
  team?: number;
  /** The ally team. Two players share this exactly when they were on a side. */
  ally?: number;
  spectator: boolean;
  elo?: number;
  rank?: number;
  clan?: string;
  country?: string;
  /** `Machines`, `Hegemony`, `Rising`, as the start script spells it. */
  faction?: string;
  bot: boolean;
}

export interface Replay {
  path: string;
  file: string;
  bytes: number;
  map?: string;
  game?: string;
  engine: string;
  /** Seconds since the epoch. */
  playedAt: number;
  /** Match length in seconds, off the simulation clock. */
  duration: number;
  players: ReplayPlayer[];
  /** Winning ally teams. Empty means the game ended without one. */
  winners: number[];
  hasStats: boolean;
}

export interface ReplayList {
  replays: Replay[];
  /** The newest engine installed here, for the mismatch warning. */
  engine?: string;
  note?: string;
  dir?: string;
}

// ----------------------------------------------------------------- outcome ---

export type Outcome = "won" | "lost" | "undecided" | "watched";

/**
 * How a game went for one player.
 *
 * Four answers, not two. A game with no winner recorded is `undecided` - the
 * engine writes none when nobody won, which covers a crash, an abandoned game
 * and every launch that ended in the first few seconds. A game somebody
 * spectated is `watched`, because calling it a loss would be wrong and calling
 * it a win would be worse.
 */
export function outcomeFor(replay: Replay, me: string | undefined): Outcome {
  if (!me) return "undecided";
  const mine = replay.players.find(
    p => !p.spectator && p.name.toLowerCase() === me.toLowerCase(),
  );
  if (!mine) return "watched";
  if (!replay.winners.length) return "undecided";
  if (mine.ally == null) return "undecided";
  return replay.winners.includes(mine.ally) ? "won" : "lost";
}

/** Everyone who actually played, by side. */
export function sides(replay: Replay): { ally: number; players: ReplayPlayer[] }[] {
  const by = new Map<number, ReplayPlayer[]>();
  for (const p of replay.players) {
    if (p.spectator || p.ally == null) continue;
    const list = by.get(p.ally) ?? [];
    list.push(p);
    by.set(p.ally, list);
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ally, players]) => ({ ally, players }));
}

/** Your team-mates, or everyone when we do not know who you are. */
export function teammates(replay: Replay, me: string | undefined): ReplayPlayer[] {
  const mine = me
    ? replay.players.find(p => !p.spectator && p.name.toLowerCase() === me.toLowerCase())
    : undefined;
  if (!mine || mine.ally == null) return [];
  return replay.players.filter(
    p => !p.spectator && p.ally === mine.ally && p.name !== mine.name,
  );
}

export function opponents(replay: Replay, me: string | undefined): ReplayPlayer[] {
  const mine = me
    ? replay.players.find(p => !p.spectator && p.name.toLowerCase() === me.toLowerCase())
    : undefined;
  if (!mine || mine.ally == null) return [];
  return replay.players.filter(p => !p.spectator && p.ally != null && p.ally !== mine.ally);
}

// ------------------------------------------------------- shape of the match ---

export type Mode = "1v1" | "Teams" | "FFA" | "Cooperative" | "Single";

/**
 * What kind of game this was, from its shape.
 *
 * Derived rather than asked for. The server knows - `AutohostMode` comes back
 * from `GetSpringBattleInfo` - but that is one request per replay for something
 * the teams already say, and it would make an offline list depend on a network
 * call. Any game with a bot in it is Cooperative regardless of its shape,
 * because that is the distinction a player is drawing when they filter for it.
 */
export function modeOf(replay: Replay): Mode {
  const playing = replay.players.filter(p => !p.spectator);
  if (playing.some(p => p.bot)) return "Cooperative";
  const allies = sides(replay);
  if (allies.length < 2) return "Single";
  const biggest = Math.max(...allies.map(a => a.players.length));
  if (biggest === 1) return allies.length === 2 ? "1v1" : "FFA";
  return "Teams";
}

/** How many people actually played. Spectators are not in the match. */
export function playerCount(replay: Replay): number {
  return replay.players.filter(p => !p.spectator).length;
}

/**
 * The average rating, over the players who have one.
 *
 * `!= null` rather than `!== undefined`, here and wherever a field that came
 * from a Rust `Option` is tested. `replays.rs` derives plain `Serialize`, so a
 * `None` crosses the bridge as JSON `null`, and `null !== undefined` is true -
 * so an unrated player passed the filter and then contributed `0`. Every AI
 * section in a start script has no `elo`, which is most Zero-K games: one
 * 2000-rated human against three bots read as 500.
 *
 * Rounded, and absent rather than zero when nobody was rated - an unranked
 * game is not a game full of beginners, and showing 0 in a rating column says
 * exactly that.
 */
export function averageRating(replay: Replay): number | undefined {
  const rated = replay.players.filter(p => !p.spectator && p.elo != null);
  if (!rated.length) return undefined;
  return Math.round(rated.reduce((sum, p) => sum + (p.elo ?? 0), 0) / rated.length);
}

/**
 * One side as a line of names, with the rest counted.
 *
 * `Aquanim, Godde, Shaman +5`. Names first because that is what somebody scans
 * for, and a count rather than a scrollbar because the row is one line high.
 */
export function summariseSide(players: ReplayPlayer[], show = 3): string {
  const names = players.map(p => p.name);
  if (names.length <= show) return names.join(", ");
  return `${names.slice(0, show).join(", ")} +${names.length - show}`;
}

/**
 * The two sides of a row, as text.
 *
 * A game with more than two ally teams has no "versus", so the rest are folded
 * into the second side rather than dropped - an FFA row that named only two of
 * six players would be a lie about who was in the game.
 */
export function versus(replay: Replay, me?: string): { a: string; b: string } {
  const allies = sides(replay);
  if (!allies.length) return { a: "", b: "" };
  if (allies.length === 1) return { a: summariseSide(allies[0].players), b: "" };
  /* Your side goes first when we know which it is: a history is read as "how
     did I do", and hunting for your own name in either column is friction. */
  const mineAt = me
    ? allies.findIndex(s => s.players.some(p => p.name.toLowerCase() === me.toLowerCase()))
    : -1;
  const ordered = mineAt > 0
    ? [allies[mineAt], ...allies.filter((_, i) => i !== mineAt)]
    : allies;
  return {
    a: summariseSide(ordered[0].players),
    b: ordered.slice(1).map(s => summariseSide(s.players, 2)).join(", "),
  };
}

/**
 * Whether this replay needs an engine the machine does not have.
 *
 * Watching it means fetching that engine, which is worth saying before somebody
 * presses play rather than after.
 */
export function engineMismatch(replay: Replay, installed: string | undefined): boolean {
  if (!installed || !replay.engine) return false;
  return replay.engine !== installed;
}

// ------------------------------------------------------------------- query ---

export interface Term {
  kind: "text" | "map" | "player" | "with" | "vs" | "outcome" | "longer" | "shorter"
    | "after" | "before";
  value: string;
  /** Seconds for a duration, epoch seconds for a date. */
  number?: number;
}

const FIELDS = new Set(["map", "player", "with", "vs"]);

/** `20m`, `90s`, `2h` or a bare number of minutes, in seconds. */
function duration(text: string): number | undefined {
  const m = text.match(/^(\d+(?:\.\d+)?)\s*([hms]?)$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = m[2].toLowerCase();
  return Math.round(n * (unit === "h" ? 3600 : unit === "s" ? 1 : 60));
}

/** A quoted run without its quotes. */
function unquote(text: string): string {
  return text.replace(/"/g, "").trim();
}

/** A date at the start of its day, in epoch seconds. */
function day(text: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const t = Date.parse(`${text}T00:00:00Z`);
  return Number.isNaN(t) ? undefined : Math.floor(t / 1000);
}

/**
 * A query string as terms.
 *
 * Quoted phrases stay whole, so a map with a space in its name is one term.
 * Nothing here rejects input: a fragment that means nothing yet becomes a text
 * term, which narrows the list rather than emptying it, and that is the right
 * behaviour while somebody is still typing.
 */
export function parseQuery(query: string): Term[] {
  const out: Term[] = [];
  /* A quoted run may follow a field name, so the pattern allows a prefix before
     the opening quote: `map:"Canis River"` is one token, not two. */
  const tokens = query.match(/[^\s"]*"[^"]*"|\S+/g) ?? [];
  for (const raw of tokens) {
    /* Quotes come off the value rather than the token, or a field's closing
       quote would be stripped while its opening one stayed in the value. */
    const token = raw;
    if (!unquote(token)) continue;
    const lower = token.toLowerCase();

    if (lower === "won" || lower === "lost") {
      out.push({ kind: "outcome", value: lower });
      continue;
    }
    const range = token.match(/^([<>])(.+)$/);
    if (range) {
      const secs = duration(range[2]);
      if (secs !== undefined) {
        out.push({ kind: range[1] === ">" ? "longer" : "shorter", value: range[2], number: secs });
        continue;
      }
    }
    const at = token.indexOf(":");
    if (at > 0) {
      const key = lower.slice(0, at);
      const value = unquote(token.slice(at + 1));
      if (value && FIELDS.has(key)) {
        out.push({ kind: key as Term["kind"], value });
        continue;
      }
      if (value && (key === "after" || key === "before")) {
        const d = day(value);
        if (d !== undefined) {
          out.push({ kind: key, value, number: d });
          continue;
        }
      }
    }
    out.push({ kind: "text", value: unquote(token) });
  }
  return out;
}

const has = (haystack: string | undefined, needle: string): boolean =>
  (haystack ?? "").toLowerCase().includes(needle.toLowerCase());

const named = (players: ReplayPlayer[], needle: string): boolean =>
  players.some(p => has(p.name, needle) || has(p.clan, needle));

/** Whether one replay satisfies one term. */
export function matchesTerm(replay: Replay, term: Term, me: string | undefined): boolean {
  switch (term.kind) {
    case "text":
      /* A bare word is the whole row: the map, the game, and anybody in it.
         Deliberately not the filename - it is the map and the date again, and
         matching it makes a search for "2026" return everything. */
      return has(replay.map, term.value)
        || has(replay.game, term.value)
        || named(replay.players, term.value);
    case "map":
      return has(replay.map, term.value);
    case "player":
      return named(replay.players, term.value);
    case "with":
      return named(teammates(replay, me), term.value);
    case "vs":
      return named(opponents(replay, me), term.value);
    case "outcome":
      return outcomeFor(replay, me) === term.value;
    case "longer":
      return replay.duration > (term.number ?? 0);
    case "shorter":
      return replay.duration < (term.number ?? 0);
    case "after":
      return replay.playedAt >= (term.number ?? 0);
    case "before":
      return replay.playedAt < (term.number ?? 0);
    default:
      return true;
  }
}

/** Every term has to hold. Narrowing is the whole point of adding one. */
export function searchReplays(
  replays: Replay[], query: string, me?: string,
): Replay[] {
  const terms = parseQuery(query);
  if (!terms.length) return replays;
  return replays.filter(r => terms.every(t => matchesTerm(r, t, me)));
}

// -------------------------------------------------------------------- rows ---

/**
 * A row in the replay screen, from either source.
 *
 * There are two, and they are not merged. The demos folder holds what this
 * machine played; the site holds everything since 2011. Joining them would mean
 * guessing that a local file and an archive row are the same game from the map,
 * the length and a printed local time - and the two namespaces share no key, so
 * the guess would be wrong sometimes and silently.
 *
 * So the screen picks a source instead. That is what "only replays on this
 * machine" means, and it needs no guess to be right.
 *
 * The consequence, and the reason the two are worth keeping apart: **a local
 * row already knows everything**, because the file is here and
 * `replays.rs` reads all of it. An archive row knows only what the list page
 * printed until somebody opens it, at which point its replay is fetched and
 * parsed and it becomes the same thing.
 */
export interface Row {
  /** Stable per row, across a re-search. */
  key: string;
  source: "local" | "archive";
  /** The site's battle id, for the match page. Archive rows only. */
  battleId?: number;
  /** Where the file is, for a row that has one. */
  path?: string;
  title?: string;
  map?: string;
  game?: string;
  engine?: string;
  /** Epoch seconds. Absent for an archive row, which prints its own. */
  playedAt?: number;
  /** What the archive printed, in its timezone and format. */
  playedText?: string;
  /** Seconds. */
  duration?: number;
  players?: number;
  teams?: number;
  /** What the archive called it, where it said. Better than anything derived. */
  shape?: string;
  bots?: boolean;
  /** An address the site already serves, for an archive row. */
  thumbnail?: string;
  /**
   * The parsed replay: always for a local row, once downloaded for an archive
   * one. Everything the design shows per team - names, ratings, factions, who
   * won - reads from here and from nowhere else.
   */
  replay?: Replay;
}

export function rowFromReplay(replay: Replay): Row {
  return {
    key: replay.path,
    source: "local",
    path: replay.path,
    map: replay.map,
    game: replay.game,
    engine: replay.engine,
    playedAt: replay.playedAt,
    duration: replay.duration,
    players: playerCount(replay),
    teams: sides(replay).length,
    bots: replay.players.some(p => p.bot),
    replay,
  };
}

/** What the archive list gives, which is everything but the people. */
export interface ArchiveRow {
  id: number;
  title?: string;
  map?: string;
  game?: string;
  thumbnail?: string;
  players?: number;
  spectators?: number;
  duration?: number;
  played?: string;
  teams?: number;
  shape?: string;
  bots: boolean;
}

export function rowFromArchive(battle: ArchiveRow): Row {
  return {
    key: `zk:${battle.id}`,
    source: "archive",
    battleId: battle.id,
    title: battle.title,
    map: battle.map,
    game: battle.game,
    thumbnail: battle.thumbnail,
    playedText: battle.played,
    duration: battle.duration,
    players: battle.players,
    teams: battle.teams,
    shape: battle.shape,
    bots: battle.bots,
  };
}

/**
 * The mode of a row.
 *
 * A local row is read from its teams, which is exact. An archive row has only
 * counts, so it is inferred: as many teams as players means everyone was on
 * their own, and two of those is a duel while more is a free-for-all. Bots win
 * over both, the same as for a local row.
 */
export function rowMode(row: Row): Mode | undefined {
  if (row.replay) return modeOf(row.replay);
  if (row.bots) return "Cooperative";
  /* The archive names the shape itself on a ranked row - `1v1` - and its own
     word beats anything worked out from counts. */
  if (row.shape === "1v1") return "1v1";
  if (row.shape === "FFA") return "FFA";
  if (row.shape) return "Teams";
  const { teams, players } = row;
  if (!teams || !players) return undefined;
  if (teams < 2) return "Single";
  if (teams === players) return players === 2 ? "1v1" : "FFA";
  return "Teams";
}

/** The average rating, which only a parsed replay can answer. */
export function rowRating(row: Row): number | undefined {
  return row.replay ? averageRating(row.replay) : undefined;
}

// ------------------------------------------------------------------ sorting ---

export type SortKey = "recent" | "oldest" | "longest" | "shortest";

export function sortReplays(replays: Replay[], key: SortKey): Replay[] {
  const out = [...replays];
  switch (key) {
    case "oldest": return out.sort((a, b) => a.playedAt - b.playedAt);
    case "longest": return out.sort((a, b) => b.duration - a.duration);
    case "shortest": return out.sort((a, b) => a.duration - b.duration);
    default: return out.sort((a, b) => b.playedAt - a.playedAt);
  }
}

/**
 * Games that never really happened.
 *
 * A demo folder collects a launch that was cancelled, a scenario opened to look
 * at, a game left in the first seconds. On this machine that was 35 of 60 files
 * with no result and a median length of zero. They are not worth a row by
 * default, and they are not worth deleting either - so they are hidden and
 * counted, and the screen can offer to show them.
 */
export const TRIVIAL_SECONDS = 60;

export function isTrivial(replay: Replay): boolean {
  return replay.duration < TRIVIAL_SECONDS;
}

export function partition(replays: Replay[]): { real: Replay[]; trivial: Replay[] } {
  return {
    real: replays.filter(r => !isTrivial(r)),
    trivial: replays.filter(isTrivial),
  };
}
