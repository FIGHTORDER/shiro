/**
 * `zk://` links followed from outside Shiro.
 *
 * Zero-K's own links look like `zk://@join_player:Qrow`, and the Zero-K client
 * has claimed that scheme on Windows since forever
 * (`ZeroKLobby/Utils.cs` sets `URL Protocol`). Shiro now claims it too, so on a
 * machine with both, whichever installed last owns the links. That is the
 * accepted cost of behaving like the client we are replacing.
 *
 * Everything here funnels into `useSite.offer()`, which is the same slot the
 * website's `SiteToLobbyCommand` lands in - so a link followed from a browser,
 * a link clicked in chat and a button pressed on zero-k.info all reach one
 * handler in App.jsx rather than three that have to be kept agreeing.
 *
 * That slot is also what makes a link work before login: the app only drains it
 * once the session is live, so a cold start holds the intent rather than losing
 * it on the login screen.
 */
import { inTauri } from "./connection";
import { useSite } from "../store/site.ts";

/** Hand one URL to the app, if it is one of ours. */
function take(url) {
  if (typeof url === "string" && url.toLowerCase().startsWith("zk://")) {
    useSite.getState().offer(url);
  }
}

export async function listenForDeepLinks() {
  if (!inTauri()) return;
  try {
    const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");

    /* Two arrivals, because a link reaches a running app and a cold start by
       different routes and neither covers the other:

       - `getCurrent()` is the link that started this process. Without it,
         following a link with Shiro closed opens Shiro and does nothing.
       - `onOpenUrl` is the plugin's own event. It covers a running app on
         every platform: macOS delivers one directly, and on Windows and Linux
         the single-instance plugin hands the second process's command line to
         the deep-link plugin, which raises the same event. That is why lib.rs
         does not read argv itself - doing both delivers every link twice. */
    (await getCurrent())?.forEach(take);
    await onOpenUrl(urls => urls.forEach(take));
  } catch {
    /* A link that cannot be listened for is a feature that does not work, not a
       lobby that does not start. */
  }
}
