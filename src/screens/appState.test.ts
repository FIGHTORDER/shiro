/**
 * The app row's state, and the one lie it used to tell.
 *
 * An update that cannot replace a running executable leaves the old one behind
 * with the files around it deleted - `installed-version` among them. Every
 * other symptom of that was recoverable. This was not: the row read the
 * missing version as "current", printed the catalogue's version as though it
 * had been read off the machine, and offered Launch. So the app said 0.1.9,
 * ran 0.1.8, and had no button that would fix it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ACTION, META, appState } from "./appState.ts";
import type { AppStatus, CatalogueApp } from "../net/apps.ts";

const app = (over: Partial<CatalogueApp> = {}): CatalogueApp => ({
  id: "stournament", name: "Stournament", summary: "", description: "",
  kind: "executable", version: "0.1.9", run: "Stournament.exe", ...over,
});

const status = (over: Partial<AppStatus> = {}): AppStatus =>
  ({ id: "stournament", installed: true, ...over });

test("an install whose version cannot be read is out of date, not current", () => {
  /* The whole bug in one line. `installedVersion` is absent when an update was
     interrupted - and absent is the state that most needs the Update button,
     because it is the state something went wrong in. */
  const s = appState(app(), status({ installedVersion: undefined }));
  assert.equal(s, "update");
  assert.equal(ACTION[s], "Update");
});

test("and it never claims the version it has not read", () => {
  /* `installed: () => status.installedVersion || app.version` is what made the
     failure invisible: the row printed what this build *would* install as
     though it were what is on the machine. */
  const line = META.update(app(), status({ installedVersion: undefined }));
  assert.match(line, /version unknown/);
  assert.match(line, /0\.1\.9/);
  assert.doesNotMatch(META.installed(app(), status({ installedVersion: undefined })), /0\.1\.9/);
});

test("a version behind the catalogue offers the update, naming both", () => {
  const s = appState(app(), status({ installedVersion: "0.1.8" }));
  assert.equal(s, "update");
  assert.equal(META.update(app(), status({ installedVersion: "0.1.8" })), "0.1.8 → 0.1.9");
});

test("a version that matches is installed, and says only what it read", () => {
  const s = appState(app(), status({ installedVersion: "0.1.9" }));
  assert.equal(s, "installed");
  assert.equal(ACTION[s], "Launch");
  assert.equal(META.installed(app(), status({ installedVersion: "0.1.9" })), "0.1.9");
});

test("nothing installed is available, whatever version file is lying around", () => {
  assert.equal(appState(app(), status({ installed: false, installedVersion: "0.1.9" })), "available");
  assert.equal(appState(app(), undefined), "available");
});

test("an app that cannot be installed says so before anything else", () => {
  /* Ahead of the version checks on purpose: an entry with nothing published
     has no version to be behind. */
  const blocked = app({ unavailable: "Nothing published yet", version: undefined });
  assert.equal(appState(blocked, status({ installedVersion: "0.1.8" })), "unavailable");
  assert.equal(META.unavailable(blocked), "Nothing published yet");
});

test("an entry with no version in the catalogue is left alone", () => {
  /* Without a version there is nothing to compare, so an installed copy must
     not be nagged to update to a number that does not exist. */
  const v = app({ version: undefined });
  assert.equal(appState(v, status({ installedVersion: "0.1.8" })), "installed");
  assert.equal(appState(v, status({ installedVersion: undefined })), "installed");
});
