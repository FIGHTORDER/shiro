/**
 * Commands the website sends to the lobby.
 *
 * Pressing "join" or "add friend" on zero-k.info sends `SiteToLobbyCommand`
 * down the connection you are already logged in on. The payload is one string
 * in the format ZeroKLobby's navigation control accepts:
 *
 *   [zk://]<path>[@action[:arg]][@action[:arg]]...
 *
 * The path is a place to go - `battles`, `chat/channel/zk`, or an http URL to
 * open outside. Each `@` segment is an action to perform first
 * (`NavigationControl.Path` setter and `ActionHandler.PerformAction` upstream).
 *
 * Parsing is pure and lives here; what to do about it is the app's business,
 * because half the actions are navigation and the other half are protocol.
 */
import { create } from "zustand";

import type { Message } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { registerSlice } from "./slices.ts";

export interface SiteAction {
  command: string;
  arg: string;
}

export interface SiteCommand {
  /** The navigation target, possibly empty when the command is all actions. */
  path: string;
  actions: SiteAction[];
}

/**
 * Split a site command into a path and its actions.
 *
 * The `zk://` prefix is optional and case-insensitive; an action's argument is
 * everything after the first colon, because map names and URLs contain them.
 */
export function parseSiteCommand(raw: string): SiteCommand {
  let value = raw.trim();
  if (value.toLowerCase().startsWith("zk://")) value = value.slice(5);

  const parts = value.split("@");
  const actions: SiteAction[] = [];
  for (const part of parts.slice(1)) {
    if (!part) continue;
    const colon = part.indexOf(":");
    actions.push(colon < 0
      ? { command: part, arg: "" }
      : { command: part.slice(0, colon), arg: part.slice(colon + 1) });
  }
  return { path: parts[0] ?? "", actions };
}

/** `chat/channel/zk` -> `zk`. Anything else is not a channel. */
export function channelOf(path: string): string | undefined {
  const parts = path.split("/");
  return parts[0] === "chat" && parts[1] === "channel" && parts[2] ? parts[2] : undefined;
}

/** One piece of a chat line: plain words, or something you can click. */
export interface Chunk {
  text: string;
  /** `zk` is ours to act on; `external` opens in the real browser. */
  kind: "text" | "zk" | "external";
}

/*
 * What counts as a link, copied in spirit from the client people already use.
 *
 * ZeroKLobby's `MicroLobby/TextWindow.cs` keeps this as its reference regex:
 *
 *     ((https?|www\.|zk://)[^\s,]+)
 *
 * The comma is excluded on purpose - links get written into prose, and "join
 * zk://@join_battle:5, it is a good map" should not swallow the rest of the
 * sentence. Matching it rather than improving on it is the point: a link that
 * works in one Zero-K client and not the other is worse than either rule.
 *
 * A trailing full stop is trimmed after the fact, which that regex does not do.
 * Sentences end in one far more often than URLs do.
 */
const LINK = /(?:https?:\/\/|www\.|zk:\/\/)[^\s,]+/gi;

/**
 * Split a chat line into words and links.
 *
 * Returns one plain chunk for a line with nothing in it, so a caller can always
 * render the result rather than special-casing the common case.
 */
export function splitLinks(text: string): Chunk[] {
  const out: Chunk[] = [];
  let at = 0;
  LINK.lastIndex = 0;
  for (let m = LINK.exec(text); m; m = LINK.exec(text)) {
    let found = m[0];
    /* Trailing punctuation belongs to the sentence, not the address. Only a
       full stop: a closing bracket can legitimately end a URL, and guessing
       wrong there breaks the link rather than tidying it. */
    while (found.endsWith(".")) found = found.slice(0, -1);
    if (!found) continue;
    if (m.index > at) out.push({ text: text.slice(at, m.index), kind: "text" });
    out.push({ text: found, kind: /^zk:\/\//i.test(found) ? "zk" : "external" });
    at = m.index + found.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), kind: "text" });
  return out;
}

/** The address to actually open for an `external` chunk. */
export function externalHref(text: string): string {
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

export function isExternalUrl(path: string): boolean {
  return /^(https?|file):\/\//i.test(path) || path.startsWith("www.");
}

export interface SiteState {
  /** The command waiting to be acted on, if any. */
  pending?: SiteCommand;
  applyBatch: (messages: Message[]) => void;
  applyMessage: (m: Message) => void;
  /**
   * Offer a command that did not arrive on the socket.
   *
   * A `zk://` link clicked in chat, or handed over by the OS because somebody
   * followed one from a browser. It goes through the same pending slot as
   * `SiteToLobbyCommand` so that all three do exactly the same thing - and so
   * that one arriving before login simply waits, because the app only drains
   * this once it is live.
   */
  offer: (raw: string) => void;
  /** Taken by the app once it has acted. */
  take: () => SiteCommand | undefined;
  reset: () => void;
}

export const useSite = create<SiteState>((set, get) => ({
  applyMessage: m => get().applyBatch([m]),

  applyBatch: messages => {
    for (const m of messages) {
      if (m.cmd !== "SiteToLobbyCommand") continue;
      const raw = (m.data as T.SiteToLobbyCommand).Command;
      // Only the newest matters: these arrive from a click, one at a time.
      if (raw) set({ pending: parseSiteCommand(raw) });
    }
  },

  offer: raw => {
    const trimmed = raw.trim();
    if (trimmed) set({ pending: parseSiteCommand(trimmed) });
  },

  take: () => {
    const pending = get().pending;
    if (pending) set({ pending: undefined });
    return pending;
  },

  reset: () => set({ pending: undefined }),
}));

registerSlice(messages => useSite.getState().applyBatch(messages));
