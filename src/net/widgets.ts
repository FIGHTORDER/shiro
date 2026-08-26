import { invoke } from "@tauri-apps/api/core";

import { inTauri } from "./connection.ts";

/**
 * Community widgets, which live in Zero-K's install rather than in Shiro.
 *
 * Everything here is a thin wrapper. The rules that matter - what may be
 * installed, what a file is renamed to, when the order list is touched - are in
 * `src-tauri/src/widgets.rs`, because they are safety rules and the frontend is
 * not where safety rules belong.
 *
 * Zero-K rewrites `ZK_order.lua` and `ZK_data.lua` at every game start and on
 * shutdown, so a change made here only sticks while the game is closed. The
 * screen says so rather than silently losing a toggle.
 */

export interface InstalledWidget {
  file: string;
  /** The name Zero-K keys its order list on, read from the widget's GetInfo. */
  name: string;
  enabled: boolean;
  /** Shiro installed it, so Shiro may remove it. */
  ours: boolean;
}

export function widgetList(installRoot?: string): Promise<InstalledWidget[]> {
  if (!inTauri()) return Promise.resolve([]);
  return invoke<InstalledWidget[]>("zks_widgets_list", { installRoot });
}

/** Whether raw widgets load at all - see the Rust module header for why this
    is the presence of a table rather than a boolean. */
export function localWidgetsOn(installRoot?: string): Promise<boolean> {
  if (!inTauri()) return Promise.resolve(false);
  return invoke<boolean>("zks_widgets_local_enabled", { installRoot });
}

/** How an add-on's files are laid down. See the Rust module for the rules. */
export type WidgetMode = "namespaced" | "replace";

export interface Build {
  /** A release tag, a tag, or a branch name. */
  label: string;
  sha: string;
  /** "release", "tag" or "branch". */
  kind: string;
  date?: string;
}

export interface AddonPreview {
  id: string;
  repo: string;
  build: Build;
  files: number;
  /** Packaged Zero-K widgets this would replace. Empty means it only adds. */
  replaces: string[];
  /** Why it cannot be installed at all. */
  refused: string[];
}

/**
 * Look at a GitHub repository and report what installing it would do.
 *
 * Downloads and unpacks to say so, because the only honest way to know what a
 * pack contains is to read it. Nothing reaches the Zero-K install here.
 */
export function fetchAddon(repo: string): Promise<AddonPreview> {
  return invoke<AddonPreview>("zks_widget_fetch", { repo });
}

/** Copy an add-on's widgets in. Returns the filenames actually written.

    Only the add-on's id crosses the bridge - Rust reads the files out of the
    unpacked add-on itself, so the page never says what gets written into the
    game install. */
export function installWidgets(
  addon: string,
  mode: WidgetMode = "namespaced",
  installRoot?: string,
): Promise<string[]> {
  return invoke<string[]>("zks_widget_install", { addon, mode, installRoot });
}

export function removeWidgets(addon: string, installRoot?: string): Promise<string[]> {
  return invoke<string[]>("zks_widget_remove", { addon, installRoot });
}

export function setWidgetEnabled(
  name: string,
  enabled: boolean,
  installRoot?: string,
): Promise<void> {
  return invoke("zks_widget_set_enabled", { name, enabled, installRoot });
}
