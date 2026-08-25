/**
 * Turning a set of chosen menu options into the values Zero-K's engine reads.
 *
 * `src/protocol/settings.ts` is generated and carries the menu: two tabs, their
 * presets, and for most options the literal springsettings.cfg keys they write.
 * What a generator cannot carry across is the Lua - fourteen settings upstream
 * applies with a function rather than a table. Those are ported here by hand,
 * and `computedSettingsAreCovered()` fails the test suite if upstream grows one
 * we have not ported, because a settings screen whose switches quietly do
 * nothing is worse than one that does not offer them.
 *
 * Three files come out of this menu, not one:
 *   - springsettings.cfg, from `springSettingsFor` below.
 *   - lups.cfg, from a template chosen by ShaderDetail. See lupsSubstitutions.
 *   - cmdcolors.txt, from the two alpha sliders. See cmdcolorSubstitutions.
 * The engine reads all three out of the Zero-K data dir at launch.
 */
import {
  SETTINGS_TABS, SETTINGS_DEFAULT, COMPUTED,
  type Setting, type SettingValue, type SettingsPreset,
} from "../protocol/settings.ts";

/** What the user has picked: option name for dropdowns, number for sliders. */
export type Chosen = Record<string, SettingValue>;

/** springsettings.cfg keys, ready to write. */
export type SpringSettings = Record<string, string>;

export interface Environment {
  /** The screen the game will run on; the interface scale default follows it. */
  screen: { width: number; height: number };
  /**
   * Whether the last engine run was NOT on an Nvidia card, which is the only
   * thing "ATI/Intel Compatibility: Automatic" turns on. Upstream reads this out
   * of the engine's own infolog.txt; see `notNvidiaFromInfolog`.
   */
  notNvidia: boolean;
  /** springsettings.cfg as it stands. Two formulas read a value back out. */
  current: SpringSettings;
}

/* Upstream keeps the ATI/Intel overrides in Configuration.lua rather than in
   the menu, so unlike everything else here they are transcribed, not generated.
   github.com/ZeroK-RTS/Chobby - configuration.lua, AtiIntelSettingsOverride. */
const ATI_INTEL_OVERRIDE: Record<string, number> = {
  AdvSky: 0,
  VSync: 1,
  FSAA: 0,
  MSAALevel: 0,
  SmoothLines: 0,
  SmoothPoints: 0,
};

/** The six settings whose whole effect is a line in lups.cfg. */
const LUPS = new Set([
  "ShaderDetail", "LupsAirJet", "LupsRibbon",
  "LupsNanoParticles", "LupsShieldShader", "LupsWaterSettings",
]);

// -------------------------------------------------------------- helpers ----

/**
 * Upstream's GetUiScaleParameters. The default scale steps up with the screen,
 * which is why a 1440p display gets 125 rather than 100.
 */
export function uiScaleBounds(screen: { width: number; height: number }) {
  let value = 100;
  if (screen.height > 1900) value = 200;
  else if (screen.height > 1220 || screen.width > 2500) value = 125;
  return {
    value,
    max: Math.max(2, screen.width / 1000) * 100,
    min: Math.min(0.5, screen.width / 4000) * 100,
  };
}

/** Resolve a bound the generator left as a named reference. */
export function resolveRef(ref: string, env: Environment): number | undefined {
  const s = uiScaleBounds(env.screen);
  if (ref === "defaultUiScale") return s.value;
  if (ref === "maxUiScale") return s.max;
  if (ref === "minUiScale") return s.min;
  return undefined;
}

/** Every setting in the menu, in the order upstream declares them. */
export function allSettings(): Setting[] {
  return SETTINGS_TABS.flatMap(t => t.settings);
}

function num(v: SettingValue | undefined, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

/**
 * A number as springsettings.cfg wants it: no exponent, no trailing zeroes.
 * The engine rewrites the file in its own float formatting on the next run, so
 * this only has to be unambiguous, not byte-identical to what it produces.
 */
export function formatValue(v: number | string): string {
  if (typeof v === "string") return v;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
}

// ------------------------------------------------------------- computed ----

type Compute = (value: SettingValue, env: Environment, chosen: Chosen)
  => Record<string, number | string>;

/* Ports of upstream's applyFunctions. Each is the Lua body, read straight
   across; the comments name what the original reads so a future reader can
   check the port rather than trust it. */
const COMPUTE: Record<string, Compute> = {
  // Writes the scale the in-game UI comes up at. This is the one that used to
  // be wrong: Shiro never wrote the file, so a game booted with whatever the
  // last client left behind.
  InterfaceScale: value => ({ interfaceScale: num(value, 100) }),

  // `springConversion = value * invertZoomMult`, where the multiplier is -1
  // unless Invert Zoom is On. Hence the negative ScrollWheelSpeed at defaults.
  MouseZoomSpeed: (value, _env, chosen) => ({
    ScrollWheelSpeed: num(value, 25) * (chosen.InvertZoom === "On" ? 1 : -1),
  }),

  // The switch re-writes the same key from the zoom speed already chosen.
  InvertZoom: (value, _env, chosen) => ({
    ScrollWheelSpeed: num(chosen.MouseZoomSpeed, 25) * (value === "On" ? 1 : -1),
  }),

  // Upstream divides by `game_settings.OverheadScrollSpeed` - Zero-K's default
  // table rather than the live file. We read the live file with the same
  // fallback; they agree at 50, and Camera Pan Speed overwrites this key
  // straight afterwards anyway.
  MiddlePanSpeed: (value, env) => {
    const camPan = Number(env.current.OverheadScrollSpeed) || 50;
    return { MiddleClickScrollSpeed: (num(value, 15) * (-1 / 200)) / camPan };
  },

  // Sets every camera's pan speed, and re-derives the middle-click speed from
  // the slider above so the two stay in proportion.
  CameraPanSpeed: (value, _env, chosen) => {
    const pan = num(value, 50);
    const middle = num(chosen.MiddlePanSpeed, 10) * (-1 / 200);
    /* Pan speed 0 is a legitimate choice - the slider's own minimum - and
       dividing by it produced `-Infinity`, which went into the cfg as the word
       and left the engine unable to parse its own settings. Upstream divides by
       the default from its table rather than the live value anyway, so falling
       back to it here is both finite and what Zero-K does. */
    const divisor = pan || 50;
    return {
      MiddleClickScrollSpeed: middle / divisor,
      OverheadScrollSpeed: pan,
      RotOverheadScrollSpeed: pan,
      CamFreeScrollSpeed: pan,
      FPSScrollSpeed: pan,
    };
  },

  // Both alpha sliders run the same function: it rewrites cmdcolors.txt and
  // returns the three springsettings keys that shadow it.
  CommandAlpha: (_value, _env, chosen) => cmdColorValues(chosen),
  QueueIconAlpha: (_value, _env, chosen) => cmdColorValues(chosen),

  // "Automatic" is the default, and on a non-Nvidia card it forces the same
  // six keys "On" does. "Off" writes nothing, so whatever Anti Aliasing and
  // Fancy Sky chose upstream of it stands.
  AtiIntelCompatibility_2: (value, env) => {
    if (value === "On") return { ...ATI_INTEL_OVERRIDE };
    if (value === "Automatic" && env.notNvidia) return { ...ATI_INTEL_OVERRIDE };
    return {};
  },

  // The Lups family writes lups.cfg, not springsettings.cfg. Listed so they
  // count as ported rather than forgotten - see lupsSubstitutions.
  ShaderDetail: () => ({}),
  LupsAirJet: () => ({}),
  LupsRibbon: () => ({}),
  LupsNanoParticles: () => ({}),
  LupsShieldShader: () => ({}),
  LupsWaterSettings: () => ({}),
};

/** Names upstream applies with Lua that nothing here implements. */
export function computedSettingsAreCovered(): string[] {
  return COMPUTED.filter(name => !(name in COMPUTE));
}

// -------------------------------------------------------------- defaults ----

/** Zero-K's own defaults, with the screen-dependent ones resolved. */
export function defaultChoices(env: Environment): Chosen {
  const out: Chosen = {};
  for (const [k, v] of Object.entries(SETTINGS_DEFAULT)) {
    if (typeof v === "object" && v && "ref" in v) {
      const r = resolveRef(v.ref, env);
      if (r !== undefined) out[k] = r;
    } else out[k] = v as SettingValue;
  }
  return out;
}

/** A preset's values, with anything it does not mention left as it was. */
export function applyPreset(chosen: Chosen, preset: SettingsPreset, env: Environment): Chosen {
  const out = { ...chosen };
  for (const [k, v] of Object.entries(preset.values)) {
    if (typeof v === "object" && v && "ref" in v) {
      const r = resolveRef((v as { ref: string }).ref, env);
      if (r !== undefined) out[k] = r;
    } else out[k] = v;
  }
  return out;
}

// ----------------------------------------------------------------- apply ----

/**
 * The springsettings.cfg keys a set of choices writes.
 *
 * Order is upstream's declaration order and it matters: Camera Pan Speed
 * overwrites the middle-click speed the slider above it set, and the ATI/Intel
 * override is declared last precisely so it wins over Anti Aliasing.
 */
export function springSettingsFor(
  chosen: Chosen,
  env: Environment,
  only?: (name: string) => boolean,
): SpringSettings {
  const out: SpringSettings = {};
  const write = (pairs: Record<string, number | string>) => {
    for (const [k, v] of Object.entries(pairs)) {
      /* A computed key that came out Infinity or NaN is a bug here, not a
         setting: written out it becomes the literal word, and the engine then
         cannot parse a file it wrote itself. Dropping the key leaves whatever
         is on disk, which is the safe direction. */
      if (typeof v === "number" && !Number.isFinite(v)) continue;
      out[k] = formatValue(v);
    }
  };

  for (const setting of allSettings()) {
    if (setting.kind === "unsupported") continue;
    if (only && !only(setting.name)) continue;
    const value = chosen[setting.name];
    if (value === undefined) continue;
    /* An empty number box means "I cleared this", not "write the default".
       `num(value, fallback)` turned it into the fallback, so clearing a field
       and pressing Apply silently set it to Zero-K's default rather than
       leaving the player's own value alone. */
    if (setting.kind === "number" && value === "") continue;

    if (setting.kind === "number") {
      const compute = setting.computed && COMPUTE[setting.computed];
      if (compute) write(compute(value, env, chosen));
      else if (setting.applyName) write({ [setting.applyName]: value });
      continue;
    }

    const option = (setting.options || []).find(o => o.name === value);
    if (!option) continue;              // a value from an older menu
    if (option.apply) write(option.apply);
    const compute = option.computed && COMPUTE[option.computed];
    if (compute) write(compute(value, env, chosen));
  }

  /* The compatibility override owns its six keys on this hardware, and Anti
     Aliasing and Fancy Sky write some of the same ones. Settings are applied in
     the order upstream declares them, so whichever came later won - and with
     Apply writing only the diff, changing Anti Aliasing alone wrote its values
     over an override that was still selected and still meant to be in effect.
     Re-stated last, but only over keys this write is already touching: a
     setting nobody changed still does not get rewritten. */
  const override = COMPUTE.AtiIntelCompatibility_2(
    chosen.AtiIntelCompatibility_2 ?? "Off", env, chosen,
  );
  for (const [key, value] of Object.entries(override)) {
    if (key in out) out[key] = formatValue(value);
  }
  return out;
}

/**
 * What to write after an edit: the keys belonging to settings the user actually
 * changed, and nothing else.
 *
 * This is the difference between a settings screen that is safe to open and one
 * that is not. Not every combination on disk maps back onto a named option -
 * two of the garbage-collector settings on a real install match nothing in
 * today's menu - and those fall back to Zero-K's default when read. Writing the
 * whole picture would push that default over the value the player had, so Apply
 * writes the diff instead. A setting nobody touched is never rewritten.
 */
export function changedSpringSettings(
  before: Chosen,
  after: Chosen,
  env: Environment,
): SpringSettings {
  const changed = new Set(
    allSettings().map(s => s.name).filter(name => before[name] !== after[name]),
  );
  return springSettingsFor(after, env, name => changed.has(name));
}

/** The settings whose value differs, whatever kind they are. */
export function changedSettingNames(before: Chosen, after: Chosen): string[] {
  return allSettings().map(s => s.name).filter(n => before[n] !== after[n]);
}

// ------------------------------------------------------------- templates ----

/** The three command-colour keys both alpha sliders write. */
function cmdColorValues(chosen: Chosen): Record<string, number> {
  const alpha = num(chosen.CommandAlpha, 70) / 100;
  // Darker lines need proportionally less of a lift to stay legible.
  const bump = alpha >= 0.7 ? 0.1 : alpha >= 0.6 ? 0.05 : 0.02;
  return {
    CmdAlpha: alpha,
    CmdAlphaDark: alpha + bump,
    CmdIconAlpha: num(chosen.QueueIconAlpha, 50) / 100,
  };
}

/** Which lups template ShaderDetail selects, as upstream names it. */
export function lupsTemplate(chosen: Chosen): string {
  const setting = allSettings().find(s => s.name === "ShaderDetail");
  const option = (setting?.options || []).find(o => o.name === chosen.ShaderDetail);
  // Upstream's own fallback when the setting has never been chosen.
  return option?.file || "LuaMenu/configs/gameConfig/zk/lups/lups3.cfg";
}

/**
 * The placeholders substituted into the chosen lups template.
 *
 * Note the polarity: most of these name what is DISABLED, so "On" becomes
 * "false". That is upstream's convention, not a mistake here.
 */
export function lupsSubstitutions(chosen: Chosen): Record<string, string> {
  const water = chosen.LupsWaterSettings;
  return {
    __AIR_JET__: chosen.LupsAirJet === "On" ? "false" : "true",
    __RIBBON__: chosen.LupsRibbon === "On" ? "false" : "true",
    __NANO_PARTICLES__: chosen.LupsNanoParticles === "Cloud" ? "false" : "true",
    __SHIELD_SPHERE_COLOR__: chosen.LupsShieldShader === "Off" ? "true" : "false",
    __SHIELD_SPHERE_HIGH_QUALITY__: chosen.LupsShieldShader === "Default" ? "false" : "true",
    __ENABLE_REFRACT__: water === "Refraction" || water === "Refract and Reflect" ? "1" : "0",
    __ENABLE_REFLECT__: water === "Reflection" || water === "Refract and Reflect" ? "1" : "0",
  };
}

/** The placeholders substituted into cmdcolors_source.txt. */
export function cmdcolorSubstitutions(chosen: Chosen): Record<string, string> {
  const v = cmdColorValues(chosen);
  return {
    __CMD_ALPHA__: formatValue(v.CmdAlpha),
    __CMD_ALPHA_DARK__: formatValue(v.CmdAlphaDark),
    __QUEUE_ICON_ALPHA__: formatValue(v.CmdIconAlpha),
  };
}

/** True if a setting only ever writes lups.cfg. */
export function isLupsSetting(name: string): boolean {
  return LUPS.has(name);
}

// ------------------------------------------------------------- inferring ----

/**
 * What the settings currently on disk add up to.
 *
 * The files record values, not the named choice that produced them, and Shiro
 * has no prior record of its own the first time the screen opens. So the menu
 * is run backwards: for each setting, find the option whose keys the file
 * already agrees with. Without this the screen would open showing Zero-K's
 * defaults over an install tuned to something else, and the first Apply would
 * quietly undo the player's graphics settings.
 *
 * Anything that matches nothing is returned in `custom` and left at its
 * default, so the UI can say so rather than pick a plausible lie.
 */
export function inferChoices(
  current: SpringSettings,
  lupsCfg: string | null,
  env: Environment,
): { chosen: Chosen; custom: string[] } {
  const chosen = defaultChoices(env);
  const custom: string[] = [];
  const has = (k: string) => current[k] !== undefined && current[k] !== "";
  const n = (k: string) => Number(current[k]);

  for (const setting of allSettings()) {
    if (setting.kind !== "options") continue;
    if (LUPS.has(setting.name)) continue;                // read from lups.cfg
    if (setting.name === "AtiIntelCompatibility_2") continue;  // see below

    /* Score each option on the keys the file actually carries. Demanding all of
       them would be wrong: a real springsettings.cfg is missing keys all the
       time - an install configured at Anti Aliasing "High" has MSAALevel,
       SmoothLines and SmoothPoints but no FSAA line at all. So an option
       qualifies when every key it writes that the file HAS agrees, and the one
       agreeing on most keys wins. Ties go to the earlier option, which also
       settles upstream's duplicate Particle Limit entries - both "20000" and
       "15000" write MaxParticles 15000. */
    let best: { name: string; score: number } | undefined;
    let anyKeyPresent = false;
    for (const o of setting.options || []) {
      const entries = Object.entries(o.apply || {});
      const present = entries.filter(([k]) => has(k));
      if (!present.length) continue;
      anyKeyPresent = true;
      const agree = present.filter(([k, v]) =>
        typeof v === "number" ? n(k) === v : current[k] === String(v));
      if (agree.length === present.length && (!best || agree.length > best.score)) {
        best = { name: o.name, score: agree.length };
      }
    }
    if (best) chosen[setting.name] = best.name;
    else if (anyKeyPresent) custom.push(setting.name);
  }

  /* The overrides ATI/Intel compatibility applies are the same six keys Anti
     Aliasing and Fancy Sky write, so its state cannot be read back out of the
     file. It stays at Zero-K's default. */

  if (has("interfaceScale")) chosen.InterfaceScale = n("interfaceScale");
  if (has("ScrollWheelSpeed")) {
    chosen.MouseZoomSpeed = Math.abs(n("ScrollWheelSpeed"));
    chosen.InvertZoom = n("ScrollWheelSpeed") >= 0 ? "On" : "Off";
  }
  if (has("CmdAlpha")) chosen.CommandAlpha = Math.round(n("CmdAlpha") * 100);
  if (has("CmdIconAlpha")) chosen.QueueIconAlpha = Math.round(n("CmdIconAlpha") * 100);
  if (has("OverheadScrollSpeed")) chosen.CameraPanSpeed = n("OverheadScrollSpeed");
  if (has("MiddleClickScrollSpeed") && has("OverheadScrollSpeed")) {
    // MiddleClickScrollSpeed = MiddlePanSpeed * (-1/200) / CameraPanSpeed
    chosen.MiddlePanSpeed =
      Math.round(n("MiddleClickScrollSpeed") * n("OverheadScrollSpeed") * -200);
  }

  if (lupsCfg != null) Object.assign(chosen, lupsChoices(lupsCfg));
  return { chosen, custom };
}

/** Read a lups.cfg back into the six settings that wrote it. */
export function lupsChoices(lupsCfg: string): Chosen {
  const read = (key: string) => {
    const m = new RegExp(`\\b${key}\\s*=\\s*([^,\\s]+)`).exec(lupsCfg);
    return m ? m[1] : undefined;
  };
  const out: Chosen = {};

  /* Which of the five templates produced this file. The obvious reading -
     lupsN.cfg says Quality=N - is wrong: upstream's five templates carry
     quality 0, 2, 3, 3 and 4, so the number alone cannot tell Medium from
     High and would read Low as Medium. What separates the two Quality=3
     templates is whether DistortionUpdateSkip is commented out. Measured from
     the vendored templates in src-tauri/src/templates. */
  const quality = read("Quality");
  // Anchored on any line break rather than `^`-with-/m, because the templates
  // upstream use lone carriage returns, which JavaScript does not count as a
  // line start. We normalise on write; a file written by anything else may not.
  const skip = /(?:^|[\r\n])[ \t]*DistortionUpdateSkip\s*=\s*(\d+)/.exec(lupsCfg)?.[1];
  const byQuality: Record<string, string> = {
    "0": "Minimal", "2": "Low", "4": "Ultra",
    "3": skip === "1" ? "Medium" : "High",
  };
  if (quality !== undefined && byQuality[quality]) out.ShaderDetail = byQuality[quality];

  // Disabled-flags, so `false` means the effect is on.
  const airJet = read("AirJet");
  if (airJet !== undefined) out.LupsAirJet = airJet === "false" ? "On" : "Off";
  const ribbon = read("Ribbon");
  if (ribbon !== undefined) out.LupsRibbon = ribbon === "false" ? "On" : "Off";
  const nano = read("NanoParticles");
  if (nano !== undefined) out.LupsNanoParticles = nano === "false" ? "Cloud" : "Beam";

  const colour = read("ShieldSphereColor");
  const hq = read("ShieldSphereColorHQ");
  if (colour !== undefined && hq !== undefined) {
    out.LupsShieldShader = colour === "true" ? "Off" : hq === "false" ? "Default" : "Simple";
  }

  const refract = read("EnableRefraction") === "1";
  const reflect = read("EnableReflection") === "1";
  out.LupsWaterSettings = refract && reflect ? "Refract and Reflect"
    : refract ? "Refraction" : reflect ? "Reflection" : "Off";

  return out;
}

// -------------------------------------------------------------- infolog ----

/**
 * Upstream's GPU check, ported: scan the engine's infolog for "NVIDIA" and give
 * up once the log reaches PostInit, by which point the driver banner is behind
 * us. A log we cannot read is treated as Nvidia - same as upstream, and the
 * conservative answer, since it leaves the compatibility overrides off.
 */
export function notNvidiaFromInfolog(infolog: string | null): boolean {
  if (infolog == null) return false;
  for (const line of infolog.split("\n")) {
    if (line.includes("PostInit")) return true;
    if (line.includes("NVIDIA")) return false;
  }
  return true;
}
