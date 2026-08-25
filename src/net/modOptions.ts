/**
 * Modoptions: reading a room's option dictionary, and building the one to send.
 *
 * Two things about this dictionary are not obvious and are easy to get wrong,
 * so they live here rather than in a component:
 *
 * 1. **`SetModOptions` replaces, it does not merge.** `ServerBattle` assigns the
 *    dictionary it is given and broadcasts it. So the map we send is the room's
 *    whole state, and anything missing from it is gone - including keys we did
 *    not put there. The server sets `noelo` itself for non-vanilla games; an
 *    editor that sent only the options it has controls for would silently
 *    re-enable rating on a modded room. Every function here that produces a
 *    dictionary to send starts from the current one.
 *
 * 2. **Values are strings, and the formatting decides what counts as changed.**
 *    Whether an option reads as "the host changed this" is a string comparison
 *    against the default, so `"0.60"` and `"0.6"` are different answers to the
 *    same question. `formatNumber` is a port of the ZK client's `TextFromNum`
 *    for exactly that reason.
 */
import {
  MODOPTIONS,
  MODOPTION_SECTIONS,
  type ModOption,
  type ModOptionSection,
} from "../protocol/modoptions.ts";

export type { ModOption, ModOptionSection };
export { MODOPTIONS, MODOPTION_SECTIONS };

/** A room's modoptions as they travel: every value a string. */
export type ModOptionValues = Record<string, string>;

const BY_KEY = new Map(MODOPTIONS.map(o => [o.key, o]));

export function optionFor(key: string): ModOption | undefined {
  return BY_KEY.get(key);
}

// ---------------------------------------------------------------- values ----

/* A port of `TextFromNum` from Chobby's gui_modoptions_panel.lua. The number of
   places comes from the step, then trailing zeros and a trailing point are
   stripped. Zero-K's steps include 0.01, 0.05, 0.1 and 0.5, so every branch is
   reachable with real data. */
export function formatNumber(value: number, step: number): string {
  const places = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  let text = value.toFixed(places);
  while (text.includes(".") && (text.endsWith("0") || text.endsWith("."))) {
    text = text.slice(0, -1);
  }
  return text;
}

/** The wire form of an option's declared default. */
export function defaultFor(option: ModOption): string {
  const def = option.def;
  if (typeof def === "boolean") return def ? "1" : "0";
  if (typeof def === "number") return formatNumber(def, option.step ?? 1);
  return String(def);
}

let defaultsCache: ModOptionValues | undefined;

/** Every option's default, keyed. Built once. */
export function defaults(): ModOptionValues {
  if (!defaultsCache) {
    defaultsCache = {};
    for (const o of MODOPTIONS) defaultsCache[o.key] = defaultFor(o);
  }
  return defaultsCache;
}

/**
 * Is this value what the game would do anyway?
 *
 * An unknown key is never "default" - we have no default to compare it against,
 * and treating it as one would hide it from the room's summary.
 */
export function isDefault(key: string, value: string): boolean {
  const option = BY_KEY.get(key);
  return option ? value === defaultFor(option) : false;
}

/**
 * The ZK client's number entry: bring a typed value into range and onto a step.
 *
 * Upstream computes `floor(v/step + 0.49)*step + 0.01*step`, where the trailing
 * nudge guards against float error. It does not survive contact with a large
 * step: `chicken_maxtech` has step 60 and max 9000, so its own default comes
 * back out as 9001 - above the maximum the same table declares. Rounding
 * properly and clamping afterwards gives the same answer everywhere else and
 * stops the field editing itself when you tab through it.
 */
export function clampNumber(value: number, option: ModOption): string {
  const { min = 0, max = 0, step = 1 } = option;
  const stepped = Math.round(Math.min(max, Math.max(min, value)) / step) * step;
  return formatNumber(Math.min(max, Math.max(min, stepped)), step);
}

/**
 * Coerce typed input into the string the wire wants, per option kind.
 * Returns undefined when the input cannot be made into a valid value, so the
 * caller can put the old text back rather than sending nonsense.
 */
export function encode(option: ModOption, input: string | number | boolean): string | undefined {
  switch (option.kind) {
    case "bool":
      return input === true || input === "1" ? "1" : "0";
    case "number": {
      const n = typeof input === "number" ? input : Number(String(input).trim());
      return Number.isFinite(n) ? clampNumber(n, option) : undefined;
    }
    case "list": {
      const key = String(input);
      return option.items?.some(i => i.key === key) ? key : undefined;
    }
    case "string":
      return String(input);
  }
}

// ----------------------------------------------------------------- sends ----

/**
 * The dictionary to send after editing.
 *
 * Starts from what the room already has, so keys we know nothing about - the
 * server's `noelo`, a custom game mode's own options - survive untouched. See
 * the note at the top of this file for why that matters.
 */
export function merge(current: ModOptionValues, edits: ModOptionValues): ModOptionValues {
  return { ...current, ...edits };
}

/* Options the server puts in the dictionary itself and then never puts back.
   `SwitchGame` sets `noelo` when the hosted game is not vanilla Zero-K - it
   announces "Ratings are disabled, since this game is not vanilla ZK" - and
   nothing re-asserts it afterwards, not even starting the game. So clearing it
   leaves a modded room rated until somebody switches game again. */
const SERVER_ENFORCED = new Set(["noelo"]);

/**
 * The dictionary to send for "reset to defaults".
 *
 * Known keys are removed rather than set to their defaults: an absent option is
 * one the game decides for itself, which is what a reset means, and it leaves
 * the room's dictionary clean.
 *
 * Two kinds of key survive: ones we have no table for, and the ones above. The
 * ZK client keeps neither - it resets by sending an empty dictionary, which
 * silently turns rating back on for a modded room. A host who genuinely wants
 * that can untick the box, which is a decision rather than a side effect.
 */
export function resetToDefaults(current: ModOptionValues): ModOptionValues {
  const out: ModOptionValues = {};
  for (const [key, value] of Object.entries(current)) {
    if (!BY_KEY.has(key) || SERVER_ENFORCED.has(key)) out[key] = value;
  }
  return out;
}

// --------------------------------------------------------------- display ----

/** One option as the room shows it. */
export interface ModOptionDisplay {
  key: string;
  /** The option's name upstream, or the bare key when we have no table for it. */
  label: string;
  /** The chosen list item's name, or the raw value. */
  value: string;
  desc?: string;
  /** False for a key not in our table - a custom game's, or the server's own. */
  known: boolean;
}

/**
 * What is set on this room that the game would not have done anyway.
 *
 * This is what the ZK client shows everyone who is not the host, and it is the
 * useful summary: a room with 90 options at their defaults has nothing worth
 * saying about it. Unknown keys are always included - we cannot tell whether
 * they are interesting, so hiding them would be a guess.
 */
export function changedOptions(values: ModOptionValues): ModOptionDisplay[] {
  const out: ModOptionDisplay[] = [];
  for (const [key, value] of Object.entries(values ?? {})) {
    const option = BY_KEY.get(key);
    if (!option) {
      out.push({ key, label: key, value, known: false });
      continue;
    }
    if (value === defaultFor(option)) continue;
    const item = option.items?.find(i => i.key === value);
    out.push({
      key,
      label: option.name,
      value: item ? item.name : value,
      desc: option.desc,
      known: true,
    });
  }
  /* Known options in declaration order - the order upstream chose, which puts
     the commonly-used ones first - then anything we could not identify. */
  const rank = new Map(MODOPTIONS.map((o, i) => [o.key, i]));
  return out.sort((a, b) =>
    Number(b.known) - Number(a.known)
    || (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0)
    || a.key.localeCompare(b.key));
}

/** Sections with their options, in upstream's declaration order. */
export function sections(): { section: ModOptionSection; options: ModOption[] }[] {
  return MODOPTION_SECTIONS.map(section => ({
    section,
    options: MODOPTIONS.filter(o => o.section === section.key),
  })).filter(s => s.options.length > 0);
}

/**
 * May this account change the room's options?
 *
 * The server's rule is `(FounderName != Name || IsAutohost) && !IsAdmin` -> no.
 * Read forwards: the founder may, and so may an admin, anywhere. `BattleHeader`
 * carries no `IsAutohost`, and does not need to: an autohost's founder is never
 * a person, because the server renames it to `"Autohost #<BattleID>"` and
 * database autohosts run under their own accounts. So being the founder is
 * enough on its own.
 *
 * The admin half was dropped when this was first written, which left moderators
 * looking at a locked panel for something the server would have accepted.
 *
 * Everyone else is refused, including in autohosts through chat - `!setoptions`
 * is `NotIngameNotAutohost`, with no vote path.
 */
export function canEdit(
  founder: string | undefined,
  me: string | undefined,
  isAdmin = false,
): boolean {
  if (!me) return false;
  return isAdmin || Boolean(founder && founder === me);
}
