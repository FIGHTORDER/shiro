/**
 * Bridge to the content downloader. Mirrors net/launch.ts: the Rust side owns
 * the process, the queue and the install; this module owns nothing but the
 * invoke/listen plumbing.
 *
 * Kept free of store imports so store/content.ts stays importable in plain Node
 * for tests — the same reason game.ts imports net/launch.ts lazily.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Install } from "./launch";

export type ContentKind = "game" | "map";

/** One thing to acquire. `name` is the server's spelling, unmodified. */
export interface ContentItem {
  kind: ContentKind;
  name: string;
}

/**
 * Why a download ended. `notFoundOrFailed` is deliberately one case: the shipped
 * pr-downloader does not emit the line upstream logs, so "the server has never
 * heard of this" and "the download broke" are genuinely indistinguishable.
 */
export type Outcome =
  | "ok"
  | "notFoundOrFailed"
  | "unfinished"
  | "noDiskSpace"
  | "dependsFailed"
  | "killed"
  | { unknown: number };

export type ContentStatus =
  | { kind: "queued"; id: string; items: ContentItem[] }
  | { kind: "started"; id: string }
  | { kind: "progress"; id: string; percent: number; done: number; total: number }
  | { kind: "note"; id: string; level: "info" | "warn" | "debug" | "error"; message: string }
  | { kind: "finished"; id: string; outcome: Outcome; message: string; log?: string };

/** What a launch would need, and what stands in the way. */
export interface Preflight {
  install: Install;
  engineOk: boolean;
  engineError?: string;
  downloader?: string;
  downloaderError?: string;
  items: ContentItem[];
  /** Probed, not assumed — a non-Steam install under Program Files is not writable. */
  writable: boolean;
}

export function contentPreflight(
  engine: string,
  game?: string,
  map?: string,
  installRoot?: string,
): Promise<Preflight> {
  return invoke("zks_content_preflight", { engine, game, map, installRoot });
}

/** Queue an acquisition. Progress arrives on the `onContent` stream. */
export function contentFetch(
  engine: string,
  items: ContentItem[],
  installRoot?: string,
): Promise<string> {
  return invoke("zks_content_fetch", { engine, items, installRoot });
}

export function contentCancel(id: string): Promise<void> {
  return invoke("zks_content_cancel", { id });
}

/**
 * What a download printed.
 *
 * Kept because the alternative, when one behaves oddly, is guessing: a download
 * that stalls, finishes suspiciously fast, or quietly falls back to the HTTP
 * path all look identical from outside. Without an id this is the most recent.
 */
export async function contentLog(id?: string): Promise<string> {
  return invoke<string>("zks_content_log", { id });
}

export function onContent(cb: (s: ContentStatus) => void): Promise<UnlistenFn> {
  return listen<ContentStatus>("zks://content", e => cb(e.payload));
}
