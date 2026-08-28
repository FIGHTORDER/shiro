import { invoke } from "@tauri-apps/api/core";

import { inTauri } from "./connection.ts";

/**
 * Community campaigns: missions built in Splaunch, played through Shiro.
 *
 * Installed into Shiro's own data directory rather than the Zero-K install,
 * because a campaign is Shiro's content and the game never learns it exists.
 * Everything that decides what may be written there is in
 * `src-tauri/src/campaigns.rs`.
 *
 * Two surfaces use this and they want different things. Add-ons installs and
 * removes; the Campaigns screen lists and plays. The screen only exists when
 * something is installed, which is why `list` returning empty is an ordinary
 * answer rather than a failure.
 */

export interface CampaignMissionStatus {
  id: string;
  name: string;
  map: string;
  summary?: string;
  /** Every mission it requires has been finished. */
  unlocked: boolean;
  done: boolean;
  /**
   * The map resolved against this install, when it is here.
   *
   * Absent is the reason a mission cannot start, and the interface should say
   * which map rather than offering a button that fails at the engine.
   */
  mapArchive?: string;
}

export interface InstalledCampaign {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  /** The Zero-K it was compiled against, when it says. */
  builtAgainst?: string;
  missions: CampaignMissionStatus[];
}

export interface CatalogueCampaign {
  id: string;
  name: string;
  author: string;
  summary: string;
  download: string;
  sha256: string;
  version: string;
}

/** What Shiro knows how to fetch. Compiled in, never fetched itself. */
export function campaignCatalogue(): Promise<CatalogueCampaign[]> {
  if (!inTauri()) return Promise.resolve([]);
  return invoke<CatalogueCampaign[]>("zks_campaign_catalogue");
}

/** Everything installed, with this machine's answers filled in. */
export function campaignList(installRoot?: string): Promise<InstalledCampaign[]> {
  if (!inTauri()) return Promise.resolve([]);
  return invoke<InstalledCampaign[]>("zks_campaign_list", { installRoot });
}

export function installCampaign(id: string): Promise<void> {
  return invoke("zks_campaign_install", { id });
}

/**
 * Install a file the player picked.
 *
 * The only path that works before anything is published, and the one an author
 * uses on their own campaign. The contents travel rather than the path: a
 * webview file input never learns where the file is, and Shiro has no
 * file-dialog plugin to ask with.
 */
export async function uploadCampaign(file: File): Promise<InstalledCampaign> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  /* In chunks, because spreading a large array into `String.fromCharCode`
     overruns the argument limit and throws on exactly the files worth
     reporting a real error for. */
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return invoke<InstalledCampaign>("zks_campaign_install_upload", { data: btoa(binary) });
}

export function removeCampaign(id: string): Promise<void> {
  return invoke("zks_campaign_remove", { id });
}

/** Start a mission. Resolves to the engine's process id. */
export function playMission(
  campaignId: string,
  missionId: string,
  player: string,
  installRoot?: string,
): Promise<number> {
  return invoke<number>("zks_campaign_play", { campaignId, missionId, player, installRoot });
}

/**
 * Record that a mission was finished, or take it back.
 *
 * The player says so. The engine's exit code does not tell victory from
 * quitting, and reading the game's log for a win would be reading a format
 * nobody promised us.
 */
export function finishMission(
  campaignId: string,
  missionId: string,
  done: boolean,
): Promise<void> {
  return invoke("zks_campaign_finish", { campaignId, missionId, done });
}
