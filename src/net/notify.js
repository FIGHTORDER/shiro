/* Desktop notifications.
   The decision about *what* is worth notifying lives in store/notify.ts; this
   is only the part that talks to the OS. */
import { inTauri } from "./connection";

/* Asked for once, then remembered. `isPermissionGranted` is a bridge round
   trip, and a chat conversation would otherwise make one per line. */
let allowed;

async function permitted() {
  if (allowed !== undefined) return allowed;
  const api = await import("@tauri-apps/plugin-notification");
  allowed = await api.isPermissionGranted();
  if (!allowed) allowed = (await api.requestPermission()) === "granted";
  return allowed;
}

/**
 * Post one notification, or do nothing.
 *
 * Never throws. A refused permission, a platform that does not have
 * notifications, or a bridge that is not there are all the same outcome from
 * where the caller stands - the person was not told - and none of them is a
 * reason to take down the batch that was being applied at the time.
 */
export async function post(title, body) {
  if (!inTauri()) return;
  try {
    if (!(await permitted())) return;
    const api = await import("@tauri-apps/plugin-notification");
    api.sendNotification(body ? { title, body } : { title });
  } catch {
    /* Notifying is a courtesy; failing to notify is not an error worth
       surfacing to somebody who is not even looking at the window. */
  }
}

/** Test seam: forget the cached permission answer. */
export function forgetPermission() {
  allowed = undefined;
}
