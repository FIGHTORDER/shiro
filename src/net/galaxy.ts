import { invoke } from "@tauri-apps/api/core";

import { inTauri } from "./connection.ts";

/**
 * Zero-K's galaxy campaign: 71 planets, read out of the player's own install.
 *
 * The content is Zero-K's, not Shiro's. It normally comes from the `zkmenu`
 * rapid package the game downloads, read at runtime by
 * `src-tauri/src/campaignpack.rs`, so a player sees the version their own
 * install has. A copy ships as a fallback for a machine with no Zero-K yet;
 * the Rust module says why it is read rather than generated.
 *
 * The save is Shiro's own and lives beside its other data. A Chobby save and
 * this one are not interchangeable, even though the field names match.
 */

/** Where a planet sits on the map. Normalised 0..1, not pixels. */
export interface MapDisplay {
  x?: number;
  y?: number;
  size?: number;
  image?: string;
  hintText?: string;
}

export interface InfoDisplay {
  text?: string;
  extendedText?: string;
  terrainType?: string;
  radius?: string;
  primary?: string;
  primaryType?: string;
  milRating?: number;
  image?: string;
}

export interface BonusObjective {
  description?: string;
  experience?: number;
}

export interface GameConfig {
  mapName?: string;
  /** False on every shipped planet - the script is built, not provided. */
  missionStartscript?: false | string;
  bonusObjectiveConfig?: BonusObjective[];
  objectiveConfig?: { description?: string }[];
  aiConfig?: { humanName?: string; allyTeam?: number }[];
}

export interface CompletionReward {
  experience?: number;
  units?: string[];
  modules?: string[];
  abilities?: string[];
  codexEntries?: string[];
}

export interface Planet {
  name?: string;
  index?: number;
  /** `{ image, text }` per tip - upstream writes a unit picture beside each. */
  tips?: { image?: string; text?: string }[];
  mapDisplay?: MapDisplay;
  infoDisplay?: InfoDisplay;
  gameConfig?: GameConfig;
  completionReward?: CompletionReward;
}

export interface Campaign {
  planets: Planet[];
  /** Pairs of 1-based planet indices - the lines drawn between planets. */
  planetEdgeList?: [number, number][];
  /** Which planets a new campaign starts with reachable. */
  initialPlanets?: number[] | Record<string, unknown>;
  startingPlanetMaps?: unknown;
  /**
   * Experience needed for each commander level, level 1 first.
   *
   * Read out of the campaign's own `commConfig.lua` rather than written down,
   * because another campaign may pace it differently. Absent when the package
   * has no commander configuration, which leaves the commander where it is.
   */
  levelRequirement?: number[];
  /**
   * No Zero-K was found, so nothing here can be started.
   *
   * The campaign itself reads without an install - it is bundled - so the
   * screen draws in full and only launching fails. Set by the command from the
   * detector's answer, never by a campaign file.
   */
  noInstall?: boolean;
}

/** The 23 fields upstream keeps, as `src-tauri/src/galaxy.rs` writes them. */
export interface GalaxySave {
  unitsUnlocked: string[];
  modulesUnlocked: string[];
  abilitiesUnlocked: string[];
  codexEntriesUnlocked: string[];
  codexEntryRead: string[];
  bonusObjectivesComplete: Record<string, number[]>;
  completionDifficulty: Record<string, number>;
  planetsCaptured: number[];
  commanderExperience: number;
  difficultySetting: number;
  leastDifficulty: number;
  commanderLevel: number;
  commanderName: string;
  commanderChassis: string;
  commanderLoadout: string[];
  retinue?: unknown;
  totalPlayFrames: number;
  victories: number;
  initializationComplete: boolean;
}

export const DIFFICULTIES = [
  { value: 1, name: "Easy" },
  { value: 2, name: "Normal" },
  { value: 3, name: "Hard" },
  { value: 4, name: "Brutal" },
];

/**
 * Read the campaign.
 *
 * Half a second of Lua the first time and cached in Rust afterwards, so a
 * screen may ask on every visit. Outside Tauri there is no install to read, and
 * an empty campaign is the honest answer rather than an error.
 */
export function readCampaign(installRoot?: string): Promise<Campaign> {
  if (!inTauri()) return Promise.resolve({ planets: [] });
  return invoke<Campaign>("zks_read_campaign", { installRoot });
}

export function galaxySave(): Promise<GalaxySave> {
  return invoke<GalaxySave>("zks_galaxy_save");
}

export function setDifficulty(difficulty: number): Promise<GalaxySave> {
  return invoke<GalaxySave>("zks_galaxy_set_difficulty", { difficulty });
}

export function finishPlanet(planetId: number, won: boolean, bonus: number[]): Promise<GalaxySave> {
  return invoke<GalaxySave>("zks_galaxy_finish", { planetId, won, bonus });
}

export function applyReward(
  reward: CompletionReward | undefined, levels?: number[],
): Promise<GalaxySave> {
  return invoke<GalaxySave>("zks_galaxy_unlock", {
    units: reward?.units ?? [],
    modules: reward?.modules ?? [],
    abilities: reward?.abilities ?? [],
    codex: reward?.codexEntries ?? [],
    experience: reward?.experience ?? 0,
    levels: levels ?? [],
  });
}

export function readCodex(entry: string): Promise<GalaxySave> {
  return invoke<GalaxySave>("zks_galaxy_read_codex", { entry });
}

export function setLoadout(
  name: string, chassis: string, modules: string[], level: number,
): Promise<GalaxySave> {
  return invoke<GalaxySave>("zks_galaxy_set_loadout", { name, chassis, modules, level });
}

export function restartCampaign(): Promise<GalaxySave> {
  return invoke<GalaxySave>("zks_galaxy_restart");
}

export function playPlanet(
  planetId: number, player: string, installRoot?: string,
): Promise<number> {
  return invoke<number>("zks_galaxy_play", { planetId, player, installRoot });
}

// ---------------------------------------------------------------- the graph ---

/**
 * Which planets the player may start, given what they have captured.
 *
 * A planet is reachable when it is one of the campaign's starting planets, or
 * when it is joined by an edge to something already captured. The edge list is
 * undirected: upstream draws one line per pair and the galaxy is traversable
 * both ways, so a captured planet opens its neighbours whichever end the pair
 * was written from.
 *
 * Captured planets stay reachable. Replaying one is how a player raises the
 * difficulty it was beaten at, and hiding it would make that impossible.
 */
export function reachable(campaign: Campaign, captured: number[]): Set<number> {
  const open = new Set<number>(initialPlanets(campaign));
  for (const id of captured) open.add(id);
  for (const [a, b] of campaign.planetEdgeList ?? []) {
    if (captured.includes(a)) open.add(b);
    if (captured.includes(b)) open.add(a);
  }
  return open;
}

/**
 * The planets a fresh campaign begins on.
 *
 * `initialPlanets` arrives as a list of indices, but a Lua table that upstream
 * happened to key some other way reaches us as an object - so both shapes are
 * read. An empty answer falls back to planet 1, because a galaxy with no way in
 * is not a campaign anybody can play.
 */
export function initialPlanets(campaign: Campaign): number[] {
  const raw = campaign.initialPlanets;
  let ids: number[] = [];
  if (Array.isArray(raw)) {
    ids = raw.filter((n): n is number => typeof n === "number");
  } else if (raw && typeof raw === "object") {
    ids = Object.values(raw).filter((n): n is number => typeof n === "number");
    if (ids.length === 0) {
      ids = Object.keys(raw).map(Number).filter(n => Number.isFinite(n));
    }
  }
  return ids.length > 0 ? ids : [1];
}

/** The name to show, with a fallback that is never blank. */
export function planetName(planet: Planet | undefined, id: number): string {
  const name = planet?.name?.trim();
  return name && name.length > 0 ? name : `Planet ${id}`;
}

/** The briefing text, preferring the long form the way the game does. */
export function briefing(planet: Planet | undefined): string {
  return planet?.infoDisplay?.extendedText ?? planet?.infoDisplay?.text ?? "";
}
