import { test } from "node:test";
import assert from "node:assert/strict";
import { springSettingsFor, defaultChoices } from "./gameSettings.ts";

const env = { screen: { width: 2560, height: 1440 }, notNvidia: false, current: {} };

test("Zero-K's defaults turn vsync off", () => {
  const out = springSettingsFor(defaultChoices(env), env);
  // The engine defaults this to -1 (adaptive), which is what a fresh managed
  // install was running - and what gets reported as a stuttery camera.
  assert.equal(out.VSync, "0");
});

test("and cover the settings a fresh install was missing", () => {
  const out = springSettingsFor(defaultChoices(env), env);
  for (const key of ["VSync", "HardwareCursor", "Shadows", "MaxParticles"]) {
    assert.ok(key in out, `${key} is not written by the defaults`);
  }
});
