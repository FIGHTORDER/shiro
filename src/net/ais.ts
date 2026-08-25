/**
 * Which AIs a room can be given. Mirrors net/zkcatalogue.ts: the Rust side
 * reads the install, this module owns the invoke plumbing and what to show when
 * there is nothing to read.
 *
 * Shiro only ever added `CAI`, which is one of the nine AIs Zero-K declares and
 * none of the ones the engine brings. The list has to come off disk rather than
 * out of a constant, because `UpdateBotStatus` is not validated anywhere: the
 * server passes `AiLib` straight into the start script, so a name that is not
 * installed produces an engine that fails at load instead of an error anybody
 * can see. See `src-tauri/src/ais.rs` for what is read and from where.
 */
import { invoke } from "@tauri-apps/api/core";
// With the extension, because this module is exercised by `node --test` and
// node does not resolve an extensionless specifier the way Vite does.
import { inTauri } from "./connection.ts";

export interface Ai {
  /** Exactly what goes on the wire as `UpdateBotStatus.AiLib`. */
  lib: string;
  name: string;
  desc?: string;
  /** `game` for a LuaAI the game declares, `engine` for a skirmish AI. */
  source: "game" | "engine";
}

export interface AiList {
  ais: Ai[];
  /**
   * True when this is not a reading of the game this room is playing: the
   * built-in list, or a real reading of a different game's archive standing in
   * for one that is not installed. Either way the picker says so.
   */
  guessed: boolean;
  /** Why, in words the picker shows. */
  note?: string;
}

/**
 * Zero-K's own AIs, as its `LuaAI.lua` declared them when this was written.
 *
 * Used only where an install cannot be read: the browser demo, and a data
 * directory whose game archive is not rapid's (a Steam layout, or a `.sd7` in
 * `games/`). It is a guess, and the picker says so - an AI Zero-K has since
 * renamed would be sent as a name the engine cannot load. The alternative is an
 * empty picker, which is worse than a guess and much worse than the one AI this
 * replaces.
 *
 * Engine-side AIs are deliberately not in here. Whether one can play this game
 * is checked against the game's own units, and that check is exactly what is
 * unavailable when the archive cannot be read - so guessing would be guessing
 * about the thing most likely to be wrong. They do not need guessing at: Rust
 * reads them off disk whether or not it could open an archive, and `listAis`
 * puts them after this list rather than in it.
 */
export const BUILT_IN: Ai[] = [
  { lib: "CAI", name: "CAI", desc: "AI that plays regular Zero-K", source: "game" },
  { lib: "Chicken: Beginner", name: "Chicken: Beginner", desc: "For PvE in PvP games", source: "game" },
  { lib: "Chicken: Very Easy", name: "Chicken: Very Easy", desc: "For PvE in PvP games", source: "game" },
  { lib: "Chicken: Easy", name: "Chicken: Easy", desc: "Ice cold", source: "game" },
  { lib: "Chicken: Normal", name: "Chicken: Normal", desc: "Lukewarm", source: "game" },
  { lib: "Chicken: Hard", name: "Chicken: Hard", desc: "Will burn your ass", source: "game" },
  { lib: "Chicken: Suicidal", name: "Chicken: Suicidal", desc: "Flaming hell!", source: "game" },
  { lib: "Chicken: Custom", name: "Chicken: Custom",
    desc: "A chicken experience customizable using modoptions", source: "game" },
  { lib: "Null AI", name: "Null AI", desc: "Empty AI for testing purposes", source: "game" },
];

const IN_BROWSER =
  "The browser demo has no install to read, so this is Shiro's built-in list.";

/** What the Rust command answers with. `note` arrives as null, not absent. */
interface Reading {
  ais: Ai[];
  note: string | null;
  /**
   * Which archive the game's half of `ais` came out of: `named` the one the
   * room asked for, `another` a different game's, `none` at all. See
   * `src-tauri/src/ais.rs`.
   */
  gameArchive: "named" | "another" | "none";
}

/**
 * Every AI this install can run, for this game and engine.
 *
 * Never rejects. Where the reading fell short the built-in list stands in and
 * is marked as standing in, because an empty picker helps nobody.
 *
 * It stands in for the game's half only. Whether a skirmish AI is installed is
 * answered by looking at its directory, so `ais` can carry a real reading of
 * the engine even when no game archive could be opened - which is exactly the
 * Steam layout, where the game is an `.sdz` Rust does not read and CircuitAI is
 * sitting in the engine tree regardless. Throwing that away to show nine
 * guesses would be losing the half that is certain to save the half that is
 * not.
 */
export async function listAis(
  engine?: string,
  game?: string,
  installRoot?: string,
): Promise<AiList> {
  if (!inTauri()) return { ais: BUILT_IN, guessed: true, note: IN_BROWSER };
  try {
    const read = await invoke<Reading>("zks_list_ais", {
      engine: engine ?? "",
      game,
      installRoot,
    });
    const note = read.note || undefined;
    const ais = read.ais ?? [];
    if (read.gameArchive === "named" && ais.length) return { ais, guessed: false, note };
    /* `another` is already a full list, of the wrong game - marked, not
       replaced, because a room playing Zero-K v1.15 against an installed
       v1.14 is the ordinary case and its AIs are the right ones. */
    const standIn = read.gameArchive === "none" ? [...BUILT_IN, ...ais] : ais;
    return { ais: standIn.length ? standIn : BUILT_IN, guessed: true, note };
  } catch (e) {
    return { ais: BUILT_IN, guessed: true, note: String((e as Error)?.message ?? e) };
  }
}

// -------------------------------------------------------------- grouping ---

/** One line in the picker. A family is several AIs that are one choice. */
export type AiRow =
  | { kind: "one"; ai: Ai }
  | { kind: "family"; label: string; members: Ai[] };

/**
 * Fold `Family: Variant` names into one row each.
 *
 * Zero-K declares seven chickens - Beginner through Custom - and they are one
 * idea at seven difficulties, not seven AIs. Splitting on the colon rather than
 * matching "Chicken" keeps that true for whatever the game adds next, and a
 * prefix with only one member stays an ordinary row rather than becoming a
 * family of one.
 *
 * A family takes the position of its first member, so the game's own order
 * survives.
 */
export function groupAis(ais: Ai[]): AiRow[] {
  const families = new Map<string, Ai[]>();
  for (const ai of ais) {
    const at = ai.name.indexOf(":");
    if (at <= 0) continue;
    const label = ai.name.slice(0, at).trim();
    if (!label) continue;
    const members = families.get(label);
    if (members) members.push(ai);
    else families.set(label, [ai]);
  }

  const rows: AiRow[] = [];
  const placed = new Set<string>();
  for (const ai of ais) {
    const at = ai.name.indexOf(":");
    const label = at > 0 ? ai.name.slice(0, at).trim() : "";
    const members = label ? families.get(label) : undefined;
    if (!members || members.length < 2) {
      rows.push({ kind: "one", ai });
      continue;
    }
    if (placed.has(label)) continue;
    placed.add(label);
    rows.push({ kind: "family", label, members });
  }
  return rows;
}

/** What a family member is called once the family name is on the row already. */
export function variantLabel(label: string, ai: Ai): string {
  const rest = ai.name.slice(label.length + 1).trim();
  return rest || ai.name;
}
