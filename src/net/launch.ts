/**
 * Bridge to the engine launcher. Mirrors net/connection.ts: the Rust side owns
 * the install, the script and the process; this module owns nothing but the
 * invoke/listen plumbing.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** A located Zero-K data directory. */
export interface Install {
  root: string;
  /** How it was found - "Steam", "Zero-K installer" - for the UI to show. */
  source: string;
}

export type GameStatus =
  | { kind: "launched"; pid: number }
  | { kind: "exited"; code: number | null }
  | { kind: "failed"; reason: string };

/** One side of the match, as the loading screen groups them. */
export interface MatchTeam {
  label: string;
  players: string[];
}

/**
 * What the loading screen is allowed to say about this match.
 *
 * The engine's loading context knows none of this - it lives in the lobby - so
 * Shiro writes it to a file beside the addon. Optional throughout: a launch
 * without it still launches, and the screen falls back to the layout that shows
 * no match.
 */
export interface MatchInfo {
  map: string;
  title: string;
  teams: MatchTeam[];
}

/** The subset of `ConnectSpring` the engine actually needs. */
export interface ConnectRequest {
  engine: string;
  ip: string;
  port: number;
  myPlayerName: string;
  scriptPassword: string;
  matchInfo?: MatchInfo;
}

/**
 * Find the Zero-K install. An explicit `root` from settings is checked like any
 * other candidate, and is remembered by the Rust side so the next launch uses
 * the same one.
 */
export function locateInstall(root?: string): Promise<Install> {
  return invoke("zks_locate_install", { root });
}

/** Resolves with the engine's pid once it has started. */
export function launchSpring(req: ConnectRequest): Promise<number> {
  return invoke("zks_launch_spring", { req });
}

/** Everything a launch would do, resolved but not run. */
export interface LaunchPreview {
  install: Install;
  exe: string;
  cwd: string;
  args: string[];
  env: Array<[string, string]>;
  scriptPath: string;
  script: string;
}

/**
 * Ask what a launch would do. The launch is the one path that needs a real
 * install and a real match to exercise, so this answers "would it work, and
 * with what" from the settings screen instead of from a failed game.
 */
export function launchPreview(engine: string, player: string): Promise<LaunchPreview> {
  return invoke("zks_launch_preview", { engine, player });
}

export function onGame(cb: (s: GameStatus) => void): Promise<UnlistenFn> {
  return listen<GameStatus>("zks://game", e => cb(e.payload));
}
