/**
 * What an app row can say and do, kept apart from the row that draws it.
 *
 * This is here rather than in `AppsScreen.jsx` because it got something wrong
 * that only a test would have caught, and a `.jsx` cannot be imported by one.
 * What it got wrong: an install whose version could not be read fell through
 * to "installed", and the row then printed the *catalogue's* version as though
 * it were the installed one. A copy that had failed to update therefore
 * reported the version it had failed to become, offered Launch instead of
 * Update, and left no way back from inside the app.
 *
 * That is not a hypothetical. An update interrupted by the app being open
 * leaves the old executable - Windows will not replace a running image - with
 * the files around it deleted, `installed-version` among them. The row read
 * that as healthy.
 */
import type { AppStatus, CatalogueApp } from "../net/apps.ts";

export type State = "available" | "installed" | "update" | "unavailable" | "installing";

export function appState(app: CatalogueApp, status?: AppStatus): State {
  /* Either source. The catalogue's is a constant the build carries; the
     status's is worked out for this machine, which is the only one that knows
     a Windows .exe cannot run here. */
  if (app.unavailable || status?.unavailable) return "unavailable";
  if (!status?.installed) return "available";
  /* The catalogue is compiled into Shiro, so "is there a newer one" is a
     comparison against this build's own catalogue rather than a request to
     anywhere - which is why it can be answered at startup, offline, for every
     app at once. A Shiro that has not been updated cannot know about an app
     release newer than itself, and that is the honest limit of this check.

     An unreadable version counts as out of date rather than as current:
     unknown and current are not the same, and only one of them is safe to
     assume. */
  if (app.version && status.installedVersion !== app.version) return "update";
  return "installed";
}

/** The line under the name, per state. */
export const META: Record<State, (app: CatalogueApp, status?: AppStatus) => string> = {
  available: app => (app.version ? `Version ${app.version}` : "Not installed"),
  installing: () => "Downloading and checking",
  // Never `app.version`: that is what this build would install, not what is on
  // the machine, and printing the one as the other is how a failed update hides.
  installed: (_app, status) => status?.installedVersion || "Installed",
  update: (app, status) =>
    `${status?.installedVersion || "version unknown"} → ${app.version}`,
  unavailable: (app, status) => status?.unavailable || app.unavailable || "Unavailable",
};

export const ACTION: Partial<Record<State, string>> = {
  available: "Install",
  installed: "Launch",
  update: "Update",
};
