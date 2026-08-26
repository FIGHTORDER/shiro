/**
 * Local preferences. Nothing here comes from or goes to the server.
 *
 * Persisted to localStorage because the alternative - a file through Tauri -
 * needs a plugin and a capability for something that is three strings. It is
 * read once at module load and written on every change.
 *
 * The saved password is the only sensitive thing in here, and it is saved only
 * when "stay logged in" is ticked, which is what that box means. It is stored
 * as the plain password rather than the hash so a future protocol change to the
 * hash function does not silently lock people out; the hash is not a secret in
 * this protocol anyway - it is a password equivalent, and either form in
 * localStorage is readable by anything with access to the profile.
 */
import { create } from "zustand";

const KEY = "shiro.settings";

/* A bundled skin, or the id of a downloaded one.
 *
 * The four below ship inside Shiro because they are a few dozen declarations
 * each. Anything that carries pictures is a download - see src-tauri/skins.rs -
 * so this cannot be a closed union any more. */
export type SkinId = string;

/**
 * The skins the app ships with, in the order the picker offers them. The
 * values themselves live in src/styles/tokens/skins.css; this is only the
 * roster, so adding a skin is a stylesheet block plus a line here.
 */
export const SKINS: { id: SkinId; name: string; note: string }[] = [
  { id: "paper", name: "Paper", note: "The default. Ink on white." },
  { id: "vellum", name: "Vellum", note: "Warm paper, brown-black ink." },
  { id: "graphite", name: "Graphite", note: "Neutral dark." },
  { id: "slate", name: "Slate", note: "Cool dark, closest to the game." },
];

/**
 * Put the skin on the document root, where skins.css is scoped to find it.
 *
 * Paper clears the attribute rather than setting it: it is the token set in
 * colors.css, so "no skin" and "the default skin" are deliberately the same
 * state, and a skin file that fails to load leaves the app on it.
 */
export function applySkin(skin: SkinId): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (skin === "paper") delete root.dataset.skin;
  else root.dataset.skin = skin;

  /* A skin that is not one of the four bundled ones is a download, and its
     tokens are not in the app's stylesheet - Rust has to hand them over. The
     attribute above is set either way, so the CSS matches once it arrives. */
  const bundled = SKINS.some(s => s.id === skin);
  void import("../net/skins.ts")
    .then(m => m.applyDownloadedSkin(bundled ? undefined : skin))
    .catch(() => {});
}

export interface Settings {
  /** Last account name, remembered whether or not the password is. */
  name: string;
  /** Only set when `remember` is on. */
  password?: string;
  remember: boolean;
  /** Overrides for the lobby server; empty means the live defaults. */
  host?: string;
  port?: number;
  /** Overrides install detection when someone keeps Zero-K somewhere odd. */
  installRoot?: string;
  /**
   * This installation's id, as `Login.InstallID`.
   *
   * The server uses it with the account id to tell one machine from another -
   * multi-account detection, and ban evasion. Every Shiro sent the empty
   * string, so every Shiro looked like the same installation to it. Random,
   * stable, and not derived from anything about the machine: it identifies this
   * copy of the app and nothing else.
   */
  installId?: string;
  /**
   * Whether the first-run install question has been asked.
   *
   * Asked once and then never again: somebody who declined an install does not
   * want to be asked at every launch, and somebody who has one does not need
   * telling twice.
   */
  installPromptSeen?: boolean;
  /**
   * Jump to the debriefing when a match ends. Spectators are never pulled
   * there regardless - they have no progression to look at.
   */
  autoOpenDebriefing: boolean;
  /** Which of SKINS is on. Cosmetic only - nothing else reads it. */
  skin: SkinId;
  /**
   * Height of the room's chat and spectator pane, in pixels.
   *
   * Remembered because it is a per-person preference about a fixed layout:
   * people who read chat want it tall, people watching the teams want it short,
   * and re-dragging it on every join would be the annoying kind of tidy.
   */
  roomChatHeight: number;
  /**
   * Which arrivals may interrupt somebody who is not looking at Shiro.
   *
   * Four flat keys rather than one nested object, and not by accident: `load`
   * merges a stored blob over the defaults one level deep, so a nested object
   * saved by an older build would replace the whole new one and quietly lose
   * whatever was added since. Flat keys each get their own default.
   *
   * What each one covers, and why it is on the list at all, is in
   * store/notify.ts.
   */
  /**
   * Extra words that light a conversation up, besides the player's own name.
   *
   * A flat array for the same reason the notify keys are flat: `load` merges
   * one level deep, and a list replaces cleanly where a nested object would
   * not. Matched exactly as a name is - case-insensitive, and bounded so a
   * rule for "teams" does not fire on "steamroller".
   */
  highlights: string[];
  notifyReadyCheck: boolean;
  notifyPartyInvite: boolean;
  notifyMention: boolean;
  notifyBattleStart: boolean;
}

export interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  /** This installation's id, creating one on first use. */
  ensureInstallId: () => string;
  /** Forget the password but keep the name, which is not a secret. */
  forgetPassword: () => void;
}

const DEFAULTS: Settings = {
  name: "", remember: false, autoOpenDebriefing: true, skin: "paper",
  highlights: [],
  roomChatHeight: 200,
  /* All on. Every one of them is something waiting on an answer, so the
     useful default is to be told; the switches exist for people who would
     rather not be. */
  notifyReadyCheck: true, notifyPartyInvite: true,
  notifyMention: true, notifyBattleStart: true,
};

function load(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    // Merged over the defaults so an older stored shape cannot leave a hole.
    const s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
    // A skin removed since it was chosen - or a hand-edited profile - would
    // otherwise leave the app on an attribute no stylesheet matches, which
    // looks like the default but is not reachable from the picker.
    if (!SKINS.some(x => x.id === s.skin)) s.skin = "paper";
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: Settings): void {
  try {
    /* Everything except the password, rather than a list of keys to keep.
       The list was the bug: adding a setting and forgetting to name it here
       left something that worked all session and forgot itself on restart -
       which is how the first-run dialog came back every launch after being
       dismissed. A new setting is now persisted by default, and the one thing
       that must not be is named explicitly. */
    const { password, ...rest } = s;
    globalThis.localStorage?.setItem(KEY, JSON.stringify({
      ...rest,
      password: s.remember ? password : undefined,
    }));
  } catch {
    // A private-mode browser refusing storage is not worth an error dialog.
  }
}

export const useSettings = create<SettingsState>((setState, get) => ({
  ...load(),

  set: patch => {
    setState(patch);
    save(get());
    if (patch.skin) applySkin(patch.skin);
  },

  ensureInstallId: () => {
    const existing = get().installId;
    if (existing) return existing;
    /* Random rather than derived. A hash of the machine would identify the
       machine; this identifies this copy of the app, which is all the server's
       multi-account checks need and all we are entitled to send. */
    const made = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join("");
    setState({ installId: made });
    save(get());
    return made;
  },

  forgetPassword: () => {
    setState({ password: undefined, remember: false });
    save(get());
  },
}));
