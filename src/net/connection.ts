/**
 * Bridge to the Rust TCP relay. The relay owns the socket; this module owns
 * nothing but the invoke/listen plumbing.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type RelayStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "disconnected"; reason: string };

export const LIVE = { host: "zero-k.info", port: 8200 } as const;

export function connect(host: string = LIVE.host, port: number = LIVE.port): Promise<void> {
  return invoke("zks_connect", { host, port });
}

export function sendLine(line: string): Promise<void> {
  return invoke("zks_send", { line });
}

export function disconnect(): Promise<void> {
  return invoke("zks_disconnect");
}

/** base64(raw md5 digest) - computed in Rust so we do not hand-roll MD5. */
export function passwordHash(password: string): Promise<string> {
  return invoke("zks_password_hash", { password });
}

export function onLine(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>("zks://line", e => cb(e.payload));
}

export function onStatus(cb: (s: RelayStatus) => void): Promise<UnlistenFn> {
  return listen<RelayStatus>("zks://status", e => cb(e.payload));
}

/** True when running inside the Tauri shell rather than a plain browser tab. */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
