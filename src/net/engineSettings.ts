/**
 * The engine's own settings, as opposed to the lobby's.
 *
 * These live in `springsettings.cfg` inside the Zero-K data dir and are read by
 * spring.exe at startup, not by us. Shiro previously never touched the file, so
 * a game booted with whatever the last client left there — which is how the
 * in-game UI ended up at the wrong scale.
 *
 * See src-tauri/src/engine_settings.rs; writes patch keys in place and never
 * discard the ~110 settings we do not model.
 */
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./connection";
import {
  inferChoices, changedSpringSettings, changedSettingNames, notNvidiaFromInfolog,
  lupsTemplate, lupsSubstitutions, cmdcolorSubstitutions, isLupsSetting,
  springSettingsFor, defaultChoices,
  type Chosen, type Environment,
} from "./gameSettings.ts";

export type EngineSettings = Record<string, string>;

/** The handful worth surfacing, with the metadata the UI needs to render them. */
export interface EngineSettingField {
  key: string;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
}

/**
 * Keys Zero-K's own settings menu does not offer, kept as plain numbers.
 *
 * The interface scale is no longer here: it is a proper slider now, the same
 * one the official client has. Resolution is: upstream sets it through a
 * "Display Mode" control that also drives Chobby's own window, which Shiro has
 * no equivalent for, so the underlying keys stay reachable directly.
 */
export const ENGINE_FIELDS: EngineSettingField[] = [
  { key: "FontSize", label: "Font size", min: 8, max: 48 },
  { key: "XResolution", label: "Fullscreen width", min: 640, max: 7680 },
  { key: "YResolution", label: "Fullscreen height", min: 480, max: 4320 },
  { key: "XResolutionWindowed", label: "Windowed width", min: 640, max: 7680 },
  { key: "YResolutionWindowed", label: "Windowed height", min: 480, max: 4320 },
];

export async function readEngineSettings(installRoot?: string): Promise<EngineSettings> {
  if (!inTauri()) return {};
  return invoke<EngineSettings>("zks_read_engine_settings", { installRoot });
}

export async function writeEngineSettings(
  changes: EngineSettings,
  installRoot?: string,
): Promise<void> {
  if (!inTauri()) return;
  return invoke("zks_write_engine_settings", { installRoot, changes });
}

// ------------------------------------------------------- the whole menu ----

/* Zero-K's settings menu writes three files, not one. The other two are
   regenerated whole from a template rather than patched, so they get their own
   commands; see src-tauri/src/game_files.rs. */

export async function readInfolog(installRoot?: string): Promise<string | null> {
  if (!inTauri()) return null;
  return invoke<string | null>("zks_read_infolog", { installRoot });
}

async function readLups(installRoot?: string): Promise<string | null> {
  if (!inTauri()) return null;
  return invoke<string | null>("zks_read_lups", { installRoot });
}

export interface LoadedGameSettings {
  /** springsettings.cfg as it stands. */
  current: EngineSettings;
  /** What the files add up to, in the menu's own terms. */
  chosen: Chosen;
  /** Settings whose values on disk match no option upstream offers. */
  custom: string[];
  env: Environment;
}

/**
 * Read every file the settings menu owns and work out what they add up to.
 *
 * The screen size comes from this window, which is the same display the game
 * will open on; upstream reads it from the engine for the same purpose.
 */
export async function loadGameSettings(installRoot?: string): Promise<LoadedGameSettings> {
  const [current, lups, infolog] = await Promise.all([
    readEngineSettings(installRoot),
    readLups(installRoot),
    readInfolog(installRoot),
  ]);
  /* Device pixels, not CSS pixels. `screen.width` is what the browser reports
     after Windows' display scaling, so a 4K screen at 200% says 1920 - and the
     UI scale was then computed for a resolution the game will never run at,
     which is exactly the "in-game UI comes up at the wrong size" this module
     exists to fix. The engine goes fullscreen at the real resolution. */
  const dpr = globalThis.devicePixelRatio || 1;
  const env: Environment = {
    screen: {
      width: Math.round((globalThis.screen?.width || 1920) * dpr),
      height: Math.round((globalThis.screen?.height || 1080) * dpr),
    },
    notNvidia: notNvidiaFromInfolog(infolog),
    current,
  };
  const { chosen, custom } = inferChoices(current, lups, env);
  return { current, chosen, custom, env };
}

/**
 * Give a new installation the settings Zero-K ships with.
 *
 * An install Shiro made has never met Zero-K's own settings screen, so
 * springsettings.cfg holds only whatever the game wrote at runtime - all of it
 * about how things look, none of it about how they run. Everything else falls
 * back to the *engine's* defaults, which are not Zero-K's:
 *
 *   VSync            engine: -1 (adaptive)     Zero-K: 0 (off)
 *   HardwareCursor   engine: unset             Zero-K: on
 *   CameraPanSpeed   engine: unset             Zero-K: 50
 *
 * Adaptive vsync is the one that gets reported as "the camera stutters". It
 * syncs while the frame rate holds and stops when it does not, so the pacing
 * oscillates instead of being wrong consistently. Zero-K turns it off in every
 * one of its five presets.
 *
 * Only keys that are absent are written. A player who has set something is not
 * overruled by a launcher deciding it knows better, and an install that already
 * has a full config is left exactly as it is - which is what makes this safe to
 * run on every startup rather than only once.
 *
 * Returns the keys it wrote, so a caller can say what happened.
 */
export async function seedDefaultSettings(installRoot?: string): Promise<string[]> {
  const { current, env } = await loadGameSettings(installRoot);
  const defaults = springSettingsFor(defaultChoices(env), env);

  const missing: EngineSettings = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in current)) missing[key] = value;
  }
  const names = Object.keys(missing);
  if (names.length) await writeEngineSettings(missing, installRoot);
  return names;
}

/**
 * Write back what changed, and only what changed.
 *
 * `before` is what the files said when the screen opened. Settings the user
 * did not touch are not rewritten - see changedSpringSettings for why that
 * matters - and the two generated files are regenerated only if something that
 * feeds them moved.
 */
export async function saveGameSettings(
  before: Chosen,
  after: Chosen,
  env: Environment,
  installRoot?: string,
): Promise<void> {
  const changed = changedSettingNames(before, after);
  if (!changed.length) return;

  const spring = changedSpringSettings(before, after, env);
  if (Object.keys(spring).length) await writeEngineSettings(spring, installRoot);

  if (changed.some(isLupsSetting) && inTauri()) {
    await invoke("zks_write_lups", {
      installRoot,
      upstreamPath: lupsTemplate(after),
      subs: lupsSubstitutions(after),
    });
  }

  if (changed.some(n => n === "CommandAlpha" || n === "QueueIconAlpha") && inTauri()) {
    await invoke("zks_write_cmdcolors", { installRoot, subs: cmdcolorSubstitutions(after) });
  }
}
