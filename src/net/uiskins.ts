import { invoke } from "@tauri-apps/api/core";

import { inTauri } from "./connection.ts";

/**
 * Chili skins for Zero-K's in-game interface.
 *
 * The sibling of `skins.ts`, and installed somewhere else: a Shiro skin lives
 * in Shiro's own data directory, while one of these goes into the Zero-K
 * install, because that is where the game looks for it. Everything that
 * decides what may be written there is in `src-tauri/src/uiskins.rs`.
 *
 * Selecting one is Zero-K's job, not Shiro's: the skin ships beside a small
 * widget that adds a picker to the game's own settings, because Zero-K's
 * built-in list is hardcoded and cannot see a skin it was not told about.
 */

export interface CatalogueUiSkin {
  id: string;
  name: string;
  summary: string;
  /** The Shiro skin this is the in-game half of. */
  matches: string;
  download?: string;
  sha256?: string;
  version?: string;
  /** Why it cannot be installed, when it cannot. */
  unavailable?: string;
}

export interface UiSkinStatus {
  id: string;
  installed: boolean;
  installedVersion?: string;
}

export function uiSkinCatalogue(): Promise<CatalogueUiSkin[]> {
  if (!inTauri()) return Promise.resolve([]);
  return invoke<CatalogueUiSkin[]>("zks_uiskin_catalogue");
}

/** What is installed in whichever Zero-K the launcher would use. */
export function uiSkinStatus(installRoot?: string): Promise<UiSkinStatus[]> {
  if (!inTauri()) return Promise.resolve([]);
  return invoke<UiSkinStatus[]>("zks_uiskin_status", { installRoot });
}

/** Download one and place it in the Zero-K install. */
export function installUiSkin(id: string, installRoot?: string): Promise<void> {
  return invoke("zks_uiskin_install", { id, installRoot });
}

/** Take one back out. The picker widget stays, since it holds the choice. */
export function removeUiSkin(id: string, installRoot?: string): Promise<void> {
  return invoke("zks_uiskin_remove", { id, installRoot });
}
