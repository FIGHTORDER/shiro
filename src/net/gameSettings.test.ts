/**
 * Run with:  node --test src/net/gameSettings.test.ts
 *
 * The numbers asserted here are not invented. Zero-K's own defaults, pushed
 * through this module, have to come out as the values a real Zero-K install
 * carries in its springsettings.cfg - that file is the check on the port.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  springSettingsFor, defaultChoices, applyPreset, uiScaleBounds, formatValue,
  computedSettingsAreCovered, notNvidiaFromInfolog, lupsTemplate,
  lupsSubstitutions, cmdcolorSubstitutions, allSettings,
  inferChoices, changedSpringSettings,
  type Environment,
} from "./gameSettings.ts";
import { SETTINGS_TABS, COMPUTED } from "../protocol/settings.ts";

/** A 1440p Nvidia machine, which is what the reference file below came off. */
const ENV: Environment = {
  screen: { width: 2560, height: 1440 },
  notNvidia: false,
  current: { OverheadScrollSpeed: "50" },
};

test("every setting upstream applies with Lua has a port here", () => {
  assert.deepEqual(computedSettingsAreCovered(), [],
    "unported applyFunctions - see COMPUTE in gameSettings.ts");
  assert.ok(COMPUTED.length >= 14, "the generator stopped finding computed settings");
});

test("the menu came across whole", () => {
  assert.deepEqual(SETTINGS_TABS.map(t => t.name), ["Graphics", "Game"]);
  assert.deepEqual(SETTINGS_TABS[0].presets.map(p => p.name),
    ["Compat.", "Lowest", "Low", "Medium", "High"]);
  assert.equal(allSettings().length, 39);
});

// -- the reference file ------------------------------------------------------

/* The keys below are the ones this module DERIVES rather than copies: every one
   comes out of a ported applyFunction, which is where the port could be wrong.
   The values are what a real Zero-K install carries after the official client
   wrote them at Zero-K's defaults on a 2560x1440 screen. Option tables are not
   listed - those are emitted verbatim by the generator and the install had been
   tuned away from default on several of them anyway. */
const DERIVED_ON_A_REAL_INSTALL = {
  interfaceScale: "125",
  ScrollWheelSpeed: "-25",
  MiddleClickScrollSpeed: "-0.0015",
  OverheadScrollSpeed: "50",
  RotOverheadScrollSpeed: "50",
  CamFreeScrollSpeed: "50",
  FPSScrollSpeed: "50",
  // The file holds 0.60000002 / 0.65000004 / 0.44999999 - the engine's float32
  // of exactly these three.
  CmdAlpha: "0.6",
  CmdAlphaDark: "0.65",
  CmdIconAlpha: "0.45",
};

test("the ported formulas reproduce a real install's values", () => {
  const out = springSettingsFor(defaultChoices(ENV), ENV);
  for (const [key, want] of Object.entries(DERIVED_ON_A_REAL_INSTALL)) {
    assert.equal(out[key], want, `${key}`);
  }
});

test("option tables are copied through untouched", () => {
  const out = springSettingsFor(defaultChoices(ENV), ENV);
  // Zero-K's defaults: Shadows "Units and Terrain", ShadowMapSize "2048",
  // VegetationDetail "Medium", ParticleLimit "15000".
  assert.equal(out.Shadows, "1");
  assert.equal(out.ShadowMapSize, "2048");
  assert.equal(out.TreeRadius, "1200");
  assert.equal(out.MaxParticles, "15000");
  assert.equal(out.HardwareCursor, "1");
});

// -- the computed settings ---------------------------------------------------

test("interface scale follows the screen, as upstream's formula does", () => {
  assert.equal(uiScaleBounds({ width: 1920, height: 1080 }).value, 100);
  assert.equal(uiScaleBounds({ width: 2560, height: 1440 }).value, 125);
  assert.equal(uiScaleBounds({ width: 3840, height: 2160 }).value, 200);
  // Wide but short still counts as a big screen.
  assert.equal(uiScaleBounds({ width: 2560, height: 1080 }).value, 125);
});

test("inverting the zoom flips the sign of the same key", () => {
  const base = { ...defaultChoices(ENV), MouseZoomSpeed: 40 };
  assert.equal(springSettingsFor({ ...base, InvertZoom: "Off" }, ENV).ScrollWheelSpeed, "-40");
  assert.equal(springSettingsFor({ ...base, InvertZoom: "On" }, ENV).ScrollWheelSpeed, "40");
});

test("camera pan speed keeps the middle-click speed in proportion", () => {
  const chosen = { ...defaultChoices(ENV), MiddlePanSpeed: 30, CameraPanSpeed: 100 };
  const out = springSettingsFor(chosen, ENV);
  assert.equal(out.OverheadScrollSpeed, "100");
  assert.equal(out.FPSScrollSpeed, "100");
  // 30 * -1/200 / 100
  assert.equal(out.MiddleClickScrollSpeed, "-0.0015");
});

test("the dark command alpha steps with the band it falls in", () => {
  const at = (a: number) =>
    springSettingsFor({ ...defaultChoices(ENV), CommandAlpha: a }, ENV);
  assert.equal(at(80).CmdAlphaDark, "0.9");    // >= 0.7 -> +0.1
  assert.equal(at(65).CmdAlphaDark, "0.7");    // >= 0.6 -> +0.05
  assert.equal(at(40).CmdAlphaDark, "0.42");   // else   -> +0.02
});

test("ATI/Intel compatibility only overrides where upstream would", () => {
  const chosen = defaultChoices(ENV);          // Automatic
  const nvidia = springSettingsFor(chosen, { ...ENV, notNvidia: false });
  const other = springSettingsFor(chosen, { ...ENV, notNvidia: true });
  // Anti Aliasing "Low" gives MSAALevel 4; the override forces it to 0.
  assert.equal(nvidia.MSAALevel, "4");
  assert.equal(other.MSAALevel, "0");
  assert.equal(other.VSync, "1");
  // Turned on by hand, the card does not matter.
  const forced = springSettingsFor({ ...chosen, AtiIntelCompatibility_2: "On" },
    { ...ENV, notNvidia: false });
  assert.equal(forced.MSAALevel, "0");
});

test("the override is declared last so it wins over anti aliasing", () => {
  const names = allSettings().map(s => s.name);
  assert.ok(names.indexOf("AtiIntelCompatibility_2") > names.indexOf("AntiAliasing"));
});

// -- presets -----------------------------------------------------------------

test("a preset changes what it names and nothing else", () => {
  const before = defaultChoices(ENV);
  const compat = SETTINGS_TABS[0].presets[0];
  const after = applyPreset(before, compat, ENV);
  assert.equal(after.Shadows, "None");
  assert.equal(after.ParticleLimit, "2000");
  // Compat. is a Graphics preset; it must not touch the Game tab.
  assert.equal(after.InterfaceScale, before.InterfaceScale);
  assert.equal(after.CameraPanSpeed, before.CameraPanSpeed);
});

test("the graphics presets really do differ, lowest to highest", () => {
  const [compat, , , , high] = SETTINGS_TABS[0].presets;
  const lo = springSettingsFor(applyPreset(defaultChoices(ENV), compat, ENV), ENV);
  const hi = springSettingsFor(applyPreset(defaultChoices(ENV), high, ENV), ENV);
  assert.equal(lo.Shadows, "0");
  assert.equal(hi.Shadows, "1");
  assert.ok(Number(hi.MaxParticles) > Number(lo.MaxParticles));
  assert.ok(Number(hi.GroundDetail) > Number(lo.GroundDetail));
});

// -- the other two files -----------------------------------------------------

test("shader detail picks the lups template, with upstream's fallback", () => {
  assert.match(lupsTemplate({ ShaderDetail: "Minimal" }), /lups0\.cfg$/);
  assert.match(lupsTemplate({ ShaderDetail: "Ultra" }), /lups4\.cfg$/);
  assert.match(lupsTemplate({}), /lups3\.cfg$/);
});

test("the lups placeholders name what is disabled, not what is on", () => {
  const on = lupsSubstitutions({ LupsAirJet: "On", LupsRibbon: "On",
    LupsNanoParticles: "Cloud", LupsShieldShader: "Default",
    LupsWaterSettings: "Refract and Reflect" });
  assert.equal(on.__AIR_JET__, "false");        // enabled -> not disabled
  assert.equal(on.__RIBBON__, "false");
  assert.equal(on.__NANO_PARTICLES__, "false");
  assert.equal(on.__SHIELD_SPHERE_COLOR__, "false");
  assert.equal(on.__SHIELD_SPHERE_HIGH_QUALITY__, "false");
  assert.equal(on.__ENABLE_REFRACT__, "1");
  assert.equal(on.__ENABLE_REFLECT__, "1");

  const off = lupsSubstitutions({ LupsAirJet: "Off", LupsShieldShader: "Off",
    LupsWaterSettings: "Reflection" });
  assert.equal(off.__AIR_JET__, "true");
  assert.equal(off.__SHIELD_SPHERE_COLOR__, "true");
  assert.equal(off.__ENABLE_REFRACT__, "0");
  assert.equal(off.__ENABLE_REFLECT__, "1");
});

test("cmdcolors gets the same numbers springsettings does", () => {
  const chosen = defaultChoices(ENV);
  const subs = cmdcolorSubstitutions(chosen);
  const spring = springSettingsFor(chosen, ENV);
  assert.equal(subs.__CMD_ALPHA__, spring.CmdAlpha);
  assert.equal(subs.__CMD_ALPHA_DARK__, spring.CmdAlphaDark);
  assert.equal(subs.__QUEUE_ICON_ALPHA__, spring.CmdIconAlpha);
});

// -- reading the files back --------------------------------------------------

test("a setting is recognised from the keys the file actually carries", () => {
  // An install at Anti Aliasing "High" really does look like this: the three
  // keys it set, and no FSAA line at all. Demanding every key would call this
  // custom and silently downgrade it on the next Apply.
  const { chosen, custom } = inferChoices(
    { MSAALevel: "8", SmoothLines: "3", SmoothPoints: "3" }, null, ENV);
  assert.equal(chosen.AntiAliasing, "High");
  assert.ok(!custom.includes("AntiAliasing"));
});

test("the best-agreeing option wins, not the first one that fits", () => {
  // Water Quality High and Ultra share three of five present keys; Ultra
  // agrees on all five.
  const { chosen } = inferChoices({
    BumpWaterAnisotropy: "2", BumpWaterReflection: "2", BumpWaterRefraction: "2",
    BumpWaterDepthBits: "32", BumpWaterTexSizeReflection: "1024",
  }, null, ENV);
  assert.equal(chosen.WaterQuality, "Ultra");
});

test("a combination that matches nothing is reported, not guessed at", () => {
  // 2.5 is an older Zero-K default and is not on today's menu.
  const { custom } = inferChoices({ LuaGarbageCollectionMemLoadMult: "2.5" }, null, ENV);
  assert.ok(custom.includes("GcRate"));
});

test("the sliders read back to the numbers that produced them", () => {
  const { chosen } = inferChoices({
    interfaceScale: "125", ScrollWheelSpeed: "-25", CmdAlpha: "0.60000002",
    CmdIconAlpha: "0.44999999", OverheadScrollSpeed: "50",
    MiddleClickScrollSpeed: "-0.0015",
  }, null, ENV);
  assert.equal(chosen.InterfaceScale, 125);
  assert.equal(chosen.MouseZoomSpeed, 25);
  assert.equal(chosen.InvertZoom, "Off");
  assert.equal(chosen.CommandAlpha, 60);
  assert.equal(chosen.QueueIconAlpha, 45);
  assert.equal(chosen.CameraPanSpeed, 50);
  assert.equal(chosen.MiddlePanSpeed, 15);
});

test("what was read is what would be written back", () => {
  const disk = {
    interfaceScale: "125", ScrollWheelSpeed: "-25", OverheadScrollSpeed: "50",
    MiddleClickScrollSpeed: "-0.0015", Shadows: "1", ShadowMapSize: "16384",
  };
  const { chosen } = inferChoices(disk, null, ENV);
  const out = springSettingsFor(chosen, ENV);
  for (const [k, v] of Object.entries(disk)) {
    assert.equal(Number(out[k]), Number(v), k);
  }
});

test("shader detail is read from the template's whole signature, not its quality", () => {
  // Upstream's five templates carry quality 0, 2, 3, 3, 4. Taking the number
  // as the level would read Low as Medium and never see High at all.
  const at = (cfg: string) => inferChoices({}, cfg, ENV).chosen.ShaderDetail;
  assert.equal(at("Quality=0"), "Minimal");
  assert.equal(at("Quality=2\nDistortionUpdateSkip      = 2"), "Low");
  assert.equal(at("Quality=3\nDistortionUpdateSkip      = 1"), "Medium");
  assert.equal(at("Quality=3\n//DistortionUpdateSkip      = 0"), "High");
  assert.equal(at("Quality=4"), "Ultra");
  // Upstream's templates use lone carriage returns; a reader anchored on
  // `^`-with-/m would see the whole file as one line and miss this.
  assert.equal(at("Quality=3\rDistortionUpdateSkip      = 1"), "Medium");
});

test("lups.cfg reads back into the six settings that wrote it", () => {
  const { chosen } = inferChoices({}, [
    "Quality=4",
    "DisableFX= { AirJet = false, Ribbon = false, NanoParticles = false,",
    "  ShieldSphereColor = false, ShieldSphereColorHQ = false, }",
    "EnableRefraction = 1", "EnableReflection = 1",
  ].join("\n"), ENV);
  assert.equal(chosen.ShaderDetail, "Ultra");
  assert.equal(chosen.LupsAirJet, "On");
  assert.equal(chosen.LupsRibbon, "On");
  assert.equal(chosen.LupsNanoParticles, "Cloud");
  assert.equal(chosen.LupsShieldShader, "Default");
  assert.equal(chosen.LupsWaterSettings, "Refract and Reflect");
});

// -- writing back ------------------------------------------------------------

test("Apply writes only the settings that changed", () => {
  const before = defaultChoices(ENV);
  assert.deepEqual(changedSpringSettings(before, { ...before }, ENV), {});
  assert.deepEqual(changedSpringSettings(before, { ...before, Shadows: "None" }, ENV),
    { Shadows: "0" });
  assert.deepEqual(changedSpringSettings(before, { ...before, InterfaceScale: 150 }, ENV),
    { interfaceScale: "150" });
});

test("an unrecognised setting is left alone unless the user touches it", () => {
  // The whole reason Apply writes a diff: GcRate came back custom, so its
  // default must not be pushed over the value on disk.
  const { chosen } = inferChoices({ LuaGarbageCollectionMemLoadMult: "2.5" }, null, ENV);
  const patch = changedSpringSettings(chosen, { ...chosen, Shadows: "None" }, ENV);
  assert.ok(!("LuaGarbageCollectionMemLoadMult" in patch));
  // But it is written the moment they do pick one.
  const picked = changedSpringSettings(chosen, { ...chosen, GcRate: "More Stability" }, ENV);
  assert.equal(picked.LuaGarbageCollectionMemLoadMult, "6");
});

// -- odds and ends -----------------------------------------------------------

test("the infolog scan stops at PostInit, and no log means Nvidia", () => {
  assert.equal(notNvidiaFromInfolog("GL vendor : NVIDIA Corporation\nPostInit\n"), false);
  assert.equal(notNvidiaFromInfolog("GL vendor : AMD\nPostInit\nNVIDIA\n"), true);
  assert.equal(notNvidiaFromInfolog(null), false);
  assert.equal(notNvidiaFromInfolog(""), true);
});

test("values are written without exponents or trailing zeroes", () => {
  assert.equal(formatValue(50), "50");
  assert.equal(formatValue(-0.0015), "-0.0015");
  assert.equal(formatValue(0.6), "0.6");
  assert.equal(formatValue("Basic"), "Basic");
});

test("a value left over from an older menu is ignored, not written", () => {
  const out = springSettingsFor({ Shadows: "Some Option That Went Away" }, ENV);
  assert.deepEqual(out, {});
});

test("settings the user has never chosen are left alone entirely", () => {
  // The point of the whole module: we write what was asked for and nothing
  // else, so the ~110 keys we do not model survive.
  const out = springSettingsFor({ Shadows: "None" }, ENV);
  assert.deepEqual(Object.keys(out), ["Shadows"]);
});

test("pan speed zero does not write the word Infinity into the engine's config", () => {
  // 0 is the slider's own minimum, and the middle-click speed is derived by
  // dividing by it. `-Infinity` went into springsettings.cfg as text, and the
  // engine could then not parse a file it had written itself.
  const chosen = { ...defaultChoices(ENV), CameraPanSpeed: 0, MiddlePanSpeed: 15 };
  const out = springSettingsFor(chosen, ENV, n => n === "CameraPanSpeed");
  assert.equal(out.OverheadScrollSpeed, "0", "the choice itself still applies");
  assert.ok(out.MiddleClickScrollSpeed !== undefined);
  assert.ok(
    Number.isFinite(Number(out.MiddleClickScrollSpeed)),
    `wrote ${out.MiddleClickScrollSpeed}`,
  );
});

test("a cleared number box leaves the setting alone rather than writing a default", () => {
  const chosen = { ...defaultChoices(ENV), CameraPanSpeed: "" };
  const out = springSettingsFor(chosen, ENV, n => n === "CameraPanSpeed");
  assert.deepEqual(out, {}, "clearing a field silently applied Zero-K's default");
});

test("changing anti-aliasing does not defeat a compatibility override that is still on", () => {
  /* The override owns six keys on ATI/Intel hardware, and Anti Aliasing writes
     some of the same ones. Apply carries only the diff, so changing Anti
     Aliasing alone used to write its values over an override still selected in
     the menu - the setting said one thing and the file said another. */
  const env: Environment = { ...ENV, notNvidia: true };
  const before = { ...defaultChoices(env), AtiIntelCompatibility_2: "On", AntiAliasing: "Off" };
  const after = { ...before, AntiAliasing: "High" };
  const out = changedSpringSettings(before, after, env);

  const overridden = springSettingsFor(
    { ...after, AntiAliasing: "Off" }, env, n => n === "AtiIntelCompatibility_2",
  );
  for (const [key, value] of Object.entries(overridden)) {
    if (key in out) {
      assert.equal(out[key], value, `${key} was written over the compatibility override`);
    }
  }
});

test("the override does not drag in keys nobody touched", () => {
  const env: Environment = { ...ENV, notNvidia: true };
  const before = { ...defaultChoices(env), AtiIntelCompatibility_2: "On", CameraPanSpeed: 50 };
  const after = { ...before, CameraPanSpeed: 60 };
  const out = changedSpringSettings(before, after, env);
  assert.deepEqual(
    Object.keys(out).sort(),
    ["CamFreeScrollSpeed", "FPSScrollSpeed", "MiddleClickScrollSpeed",
      "OverheadScrollSpeed", "RotOverheadScrollSpeed"],
    "Apply wrote settings the player never changed",
  );
});
