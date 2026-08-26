import { invoke } from "@tauri-apps/api/core";

import { inTauri } from "./connection.ts";

/**
 * Skins that were downloaded rather than shipped.
 *
 * The four bundled skins are CSS blocks in the app's own stylesheet and need
 * none of this. A downloaded one arrives as a directory on disk, and Rust reads
 * it: the stylesheet comes back as text and the pictures as `data:` URLs. The
 * page fetches nothing - the CSP is `default-src 'self'` and stays that way,
 * because `style-src` already allows inline and `img-src` already allows
 * `data:`.
 */

export interface CatalogueSkin {
  id: string;
  name: string;
  note: string;
  download?: string;
  sha256?: string;
  version?: string;
  /** Set when it cannot be installed, and says why. */
  unavailable?: string;
}

export interface SkinStatus {
  id: string;
  installed: boolean;
  version?: string;
}

export interface LoadedSkin {
  css: string;
  /** Pictures by file name, as `data:` URLs. */
  assets: Record<string, string>;
}

export function skinCatalogue(): Promise<CatalogueSkin[]> {
  if (!inTauri()) return Promise.resolve([]);
  return invoke<CatalogueSkin[]>("zks_skin_catalogue");
}

export function skinStatus(): Promise<SkinStatus[]> {
  if (!inTauri()) return Promise.resolve([]);
  return invoke<SkinStatus[]>("zks_skin_status");
}

export function installSkin(id: string): Promise<void> {
  return invoke("zks_skin_install", { id });
}

export function removeSkin(id: string): Promise<void> {
  return invoke("zks_skin_remove", { id });
}

export function loadSkin(id: string): Promise<LoadedSkin> {
  return invoke<LoadedSkin>("zks_skin_load", { id });
}

/* The one element a downloaded skin's stylesheet lives in. One element rather
   than one per skin, because two skins' tokens in the document at once is a
   cascade race decided by insertion order. */
const TAG = "shiro-downloaded-skin";

/** Whatever the active downloaded skin brought with it, for callers that draw. */
let current: { id: string; assets: Record<string, string> } | undefined;

export function skinAssets(): Record<string, string> {
  return current?.assets ?? {};
}

/**
 * Put a downloaded skin's stylesheet in the document, or take it out again.
 *
 * `undefined` clears it, which is what switching back to a bundled skin means.
 * Failing to load is not fatal: the tokens fall back to the base set and the
 * app is merely un-skinned rather than broken.
 */
export async function applyDownloadedSkin(id: string | undefined): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(TAG);
  if (!id) {
    el?.remove();
    current = undefined;
    return false;
  }
  if (current?.id === id && el) return true;
  if (!inTauri()) return false;

  try {
    const skin = await loadSkin(id);
    const style = el ?? document.createElement("style");
    style.id = TAG;
    style.textContent = skin.css;
    if (!el) document.head.appendChild(style);
    current = { id, assets: skin.assets };
    return true;
  } catch {
    el?.remove();
    current = undefined;
    return false;
  }
}
