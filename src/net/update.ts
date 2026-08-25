/**
 * Updates, from the `dev` release on GitHub.
 *
 * Tauri's updater verifies a minisign signature before it will install
 * anything, so the only thing that can arrive here is a build signed with the
 * key whose public half is in `tauri.conf.json`. That is the whole security
 * model: the download is over HTTPS, but it is the signature that matters,
 * because the URL is a public release asset anybody can serve a copy of.
 *
 * Every build published from main is strictly newer than the last - CI stamps
 * `0.1.<run number>` - so "is there an update" is a version comparison the
 * plugin does for us.
 */
import { inTauri } from "./connection.ts";

/** What the endpoint offered, once the plugin has checked. */
export interface Available {
  version: string;
  /** The release notes from `latest.json`, if it carried any. */
  notes?: string;
  date?: string;
}

type UpdateHandle = {
  version: string;
  body?: string;
  date?: string;
  downloadAndInstall: (
    onEvent?: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void,
  ) => Promise<void>;
};

let pending: UpdateHandle | undefined;

/**
 * Ask whether there is a newer build.
 *
 * `null` means we are up to date, or there is nothing to ask - the browser
 * demo has no updater. The handle is kept here rather than returned, so the
 * caller cannot install one update while displaying another.
 */
export async function checkForUpdate(): Promise<Available | null> {
  if (!inTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const found = (await check()) as UpdateHandle | null;
  pending = found ?? undefined;
  if (!found) return null;
  return { version: found.version, notes: found.body, date: found.date };
}

/**
 * Download and install the update found by the last check.
 *
 * `onProgress` is called with 0-100. The plugin reports lengths rather than a
 * percentage, and a server that sends no `Content-Length` means there is no
 * percentage to report - hence the undefined.
 */
export async function installUpdate(
  onProgress?: (percent: number | undefined) => void,
): Promise<void> {
  if (!pending) throw new Error("there is no update to install");
  let total = 0;
  let done = 0;
  await pending.downloadAndInstall(e => {
    if (e.event === "Started") {
      total = e.data?.contentLength ?? 0;
      done = 0;
      onProgress?.(total ? 0 : undefined);
    } else if (e.event === "Progress") {
      done += e.data?.chunkLength ?? 0;
      onProgress?.(total ? Math.min(100, Math.round((done / total) * 100)) : undefined);
    } else if (e.event === "Finished") {
      onProgress?.(100);
    }
  });
}

/** Restart into the new build. Only meaningful after `installUpdate`. */
export async function relaunch(): Promise<void> {
  if (!inTauri()) return;
  const { relaunch: go } = await import("@tauri-apps/plugin-process");
  await go();
}

/**
 * The version this build actually is.
 *
 * Read from the binary rather than written in the UI: CI stamps the version at
 * build time, so anything hard-coded in the source is a number that was true
 * once. Falls back to the package version outside the app.
 */
export async function appVersion(): Promise<string> {
  if (!inTauri()) return "0.1.0";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** Forget any handle from a previous check - used by tests. */
export function forgetPendingUpdate(): void {
  pending = undefined;
}
