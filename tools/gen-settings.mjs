#!/usr/bin/env node
/**
 * Generates src/protocol/settings.ts from Chobby's Zero-K settings menu.
 *
 * Zero-K's in-game settings are not a Shiro invention: the official client has
 * a settings window whose contents - the two tabs, the graphics presets, every
 * dropdown and slider, and the springsettings.cfg keys each choice writes - are
 * declared in one Lua table upstream. Porting that by hand would be 39 settings
 * and a few hundred key/value pairs of transcription, so we parse it instead.
 *
 *   node tools/gen-settings.mjs
 *
 * What comes across and what does not:
 *   - An option's `apply` table is pure data and is emitted verbatim.
 *   - An `applyFunction` is Lua we cannot run. The generator records that the
 *     setting needs one and names it; src/net/gameSettings.ts holds the ported
 *     formula, and a test fails if upstream grows one we have not ported. That
 *     is deliberate: silently dropping a setting's effect is how you ship a
 *     settings screen whose switches do nothing.
 *   - Three entries drive Chobby's own window management (DisplayMode,
 *     LobbyDisplayMode) or are a text label (ActiveGraphicsLabel). Shiro does
 *     its own window handling, so they are emitted as unsupported and the UI
 *     skips them.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PIN_SHA = "8fed2a62a8e1d4f325aea013743ab82314c9396e";
const REPO = "ZeroK-RTS/Chobby";
const FILE = "LuaMenu/configs/gameConfig/zk/settingsMenu.lua";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "protocol");

/** Entries that configure Chobby itself rather than the game. */
const NOT_A_GAME_SETTING = {
  DisplayMode: "Shiro manages its own window",
  LobbyDisplayMode: "Shiro manages its own window",
  ActiveGraphicsLabel: "a text label, not a setting",
  TextToSpeech: "reads out lobby chat in Chobby; Shiro has no equivalent",
};

// ------------------------------------------------------------------ lua ----

import { readAssignment } from "./lua.mjs";

// ----------------------------------------------------------------- read ----

const url = `https://raw.githubusercontent.com/${REPO}/${PIN_SHA}/${FILE}`;
const res = await fetch(url);
if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
const src = await res.text();

const config = readAssignment(src, "settingsConfig");
const defaults = readAssignment(src, "settingsDefault");

const isRef = v => v && typeof v === "object" && typeof v.ref === "string";
const isFn = v => v && typeof v === "object" && typeof v.fn === "string";

/** A value that survives to TypeScript: a string, a number, or a named ref. */
function plain(v) {
  if (typeof v === "string" || typeof v === "number") return v;
  if (isRef(v)) return { ref: v.ref };
  return undefined;
}

const warnings = [];

function convert(setting) {
  const name = setting.name;
  const humanName = (setting.humanName || name).replace(/:\s*$/, "");
  if (name in NOT_A_GAME_SETTING) {
    return { name, humanName, kind: "unsupported", why: NOT_A_GAME_SETTING[name] };
  }

  if (setting.options) {
    const options = setting.options.map(o => {
      const out = { name: o.name };
      const apply = {};
      for (const [k, v] of Object.entries(o.apply || {})) {
        const p = plain(v);
        if (p === undefined) warnings.push(`${name}/${o.name}: apply.${k} is not a literal`);
        else apply[k] = p;
      }
      if (Object.keys(apply).length) out.apply = apply;
      // ShaderDetail picks one of five lups templates rather than writing keys.
      if (typeof o.file === "string") out.file = o.file;
      // An option whose effect is Lua. The name is the contract with
      // src/net/gameSettings.ts, which holds the ported formula.
      if (o.applyFunction || setting.applyFunction) out.computed = name;
      return out;
    });
    return { name, humanName, kind: "options", options };
  }

  if (setting.isNumberSetting) {
    const out = { name, humanName, kind: "number" };
    const min = plain(setting.minValue);
    const max = plain(setting.maxValue);
    if (min !== undefined) out.min = min;
    if (max !== undefined) out.max = max;
    if (setting.isPercent) out.percent = true;
    // The simple shape: one key, optionally through a conversion.
    if (setting.applyName) out.applyName = setting.applyName;
    if (setting.springConversion || setting.applyFunction) out.computed = name;
    return out;
  }

  warnings.push(`${name}: neither options nor a number setting - emitted unsupported`);
  return { name, humanName, kind: "unsupported", why: "upstream shape not recognised" };
}

/* Settings first, presets second: the graphics presets set
   AtiIntelCompatibility_2, which upstream declares over in the Game tab, so a
   preset has to be resolved against every setting rather than its own tab. */
const converted = config.map(tab => ({ tab, settings: (tab.settings || []).map(convert) }));
const supported = new Set(
  converted.flatMap(c => c.settings).filter(s => s.kind !== "unsupported").map(s => s.name),
);
const declared = new Set(converted.flatMap(c => c.settings).map(s => s.name));

const tabs = converted.map(({ tab, settings }) => {
  const presets = (tab.presets || []).map(p => {
    const values = {};
    for (const [k, v] of Object.entries(p.settings || {})) {
      // Presets outlive the settings they used to drive: ShadowDetail has been
      // gone from the menu for years and is still set by all five of them.
      if (!declared.has(k)) { warnings.push(`preset ${tab.name}/${p.name} sets ${k}, which is not a setting`); continue; }
      if (!supported.has(k)) continue;   // already reported as unsupported
      const val = plain(v);
      if (val === undefined) warnings.push(`preset ${tab.name}/${p.name}: ${k} is not a literal`);
      else values[k] = val;
    }
    return { name: p.name, values };
  });
  return { name: tab.name, presets, settings };
});

const defaultValues = {};
for (const [k, v] of Object.entries(defaults)) {
  const p = plain(v);
  if (p === undefined) warnings.push(`settingsDefault.${k} is not a literal`);
  else defaultValues[k] = p;
}

// ---------------------------------------------------------------- write ----

const banner = `// GENERATED by tools/gen-settings.mjs - DO NOT EDIT.
// Source: github.com/${REPO} @ ${PIN_SHA}
//         ${FILE}
// Regenerate: node tools/gen-settings.mjs
`;

const json = v => JSON.stringify(v, null, 2).replace(/\n/g, "\n");

const ts = `${banner}
/** A value a setting can hold: an option name, or a number for sliders. */
export type SettingValue = string | number;

/** A bound upstream computes from the screen rather than writing down. */
export interface SettingRef { ref: string; }

export interface SettingOption {
  name: string;
  /** springsettings.cfg keys this option writes, verbatim from upstream. */
  apply?: Record<string, SettingValue>;
  /** Upstream applies this one with Lua; see src/net/gameSettings.ts. */
  computed?: string;
  /** ShaderDetail alone selects a template file instead of writing keys. */
  file?: string;
}

export interface Setting {
  name: string;
  humanName: string;
  kind: "options" | "number" | "unsupported";
  options?: SettingOption[];
  min?: number | SettingRef;
  max?: number | SettingRef;
  /** A percentage, so 100 means unscaled. */
  percent?: boolean;
  /** A number setting that writes exactly this key. */
  applyName?: string;
  computed?: string;
  /** Why an unsupported setting is not offered. */
  why?: string;
}

export interface SettingsPreset {
  name: string;
  /** The Game tab's default carries a bound upstream reads off the screen. */
  values: Record<string, SettingValue | SettingRef>;
}
export interface SettingsTab {
  name: string;
  presets: SettingsPreset[];
  settings: Setting[];
}

export const SETTINGS_TABS: SettingsTab[] = ${json(tabs)};

/** What Zero-K ships with, for anything the file on disk does not pin down. */
export const SETTINGS_DEFAULT: Record<string, SettingValue | SettingRef> = ${json(defaultValues)};

/** Every setting whose effect upstream expresses as Lua. */
export const COMPUTED: string[] = ${json(
  [...new Set(tabs.flatMap(t => t.settings).flatMap(s =>
    [s.computed, ...(s.options || []).map(o => o.computed)]).filter(Boolean))].sort(),
)};
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "settings.ts"), ts, "utf8");

const count = tabs.flatMap(t => t.settings);
console.log(`tabs      ${tabs.map(t => `${t.name}(${t.settings.length})`).join(" ")}`);
console.log(`presets   ${tabs.flatMap(t => t.presets).length}`);
console.log(`settings  ${count.length} - ${count.filter(s => s.kind === "options").length} option, `
  + `${count.filter(s => s.kind === "number").length} number, `
  + `${count.filter(s => s.kind === "unsupported").length} unsupported`);
console.log(`computed  ${JSON.parse(json(tabs)) && ""}${[...new Set(count.flatMap(s => [s.computed, ...(s.options || []).map(o => o.computed)]).filter(Boolean))].length}`);
console.log(`pinned    ${PIN_SHA.slice(0, 12)}`);
for (const w of warnings) console.log(`  warn: ${w}`);
