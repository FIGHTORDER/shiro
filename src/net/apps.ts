/**
 * The app launcher's client side.
 *
 * The catalogue is compiled into the Rust binary rather than fetched, so this
 * is a thin wrapper: there is no network here and no way for the list to change
 * without shipping a new Shiro. See `src-tauri/src/apps.rs` and `docs/APPS.md`.
 */
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./connection.ts";

export type AppKind = "builtin" | "executable";

export interface CatalogueApp {
  id: string;
  name: string;
  summary: string;
  description: string;
  kind: AppKind;
  download?: string;
  sha256?: string;
  version?: string;
  run?: string;
  /** Set when it cannot be installed, and says why in a sentence. */
  unavailable?: string;
  /** Present when Shiro carries a copy and places it on first run. */
  bundled?: string;
}

export interface AppStatus {
  id: string;
  installed: boolean;
  installedVersion?: string;
  path?: string;
}

export async function catalogue(): Promise<CatalogueApp[]> {
  if (!inTauri()) return [];
  return invoke<CatalogueApp[]>("zka_catalogue");
}

export async function statuses(): Promise<AppStatus[]> {
  if (!inTauri()) return [];
  return invoke<AppStatus[]>("zka_status");
}

/**
 * Download, verify and unpack an app.
 *
 * The verification is in Rust and is not optional: the bytes are checked
 * against the hash pinned in the catalogue before anything is unpacked, and a
 * mismatch discards the download rather than installing it.
 */
export async function installApp(id: string): Promise<void> {
  if (!inTauri()) return;
  await invoke("zka_install", { id });
}

/**
 * Start an installed app. Only ever in response to a person pressing Launch.
 *
 * `installRoot` is passed so the app can be told where Zero-K is. Shiro now
 * installs the game into a directory of its own, which a separate program has
 * no way of guessing - and Shiro is the one that knows, including when the
 * answer is somebody's Steam copy. See `ROOT_ENV` in `src-tauri/src/apps.rs`.
 */
export async function launchApp(id: string, installRoot?: string): Promise<void> {
  if (!inTauri()) return;
  await invoke("zka_launch", { id, installRoot });
}

export async function uninstallApp(id: string): Promise<void> {
  if (!inTauri()) return;
  await invoke("zka_uninstall", { id });
}
