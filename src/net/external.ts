/**
 * Opening a link in the user's actual browser.
 *
 * In a Tauri webview a plain `<a href target="_blank">` does nothing at all,
 * and one WITHOUT target is worse: it navigates the webview and replaces the
 * app with a web page, with no way back. So every external link has to go
 * through the opener plugin.
 *
 * The interceptor exists because the links we most want to work are drawn by
 * `src/ds/shiro.js` (MapImage's "open on zero-k.info"), which is vendored and
 * must not be hand-edited. Catching clicks at the document level fixes those
 * without touching the design system, and covers any link added later.
 */
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./connection";

/** Only ever hand the opener a real web URL. */
function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw, window.location.href);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export async function openExternal(url: string): Promise<void> {
  if (!isHttpUrl(url)) return;
  if (!inTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  // Invoked directly rather than through @tauri-apps/plugin-opener: one command,
  // and it saves a dependency whose only job would be to call it.
  await invoke("plugin:opener|open_url", { url });
}

let installed = false;

/**
 * Route every external link click to the browser. Idempotent.
 *
 * Capture phase, so it runs before anything the design system might do, and
 * only for plain left clicks — modifier clicks keep their normal meaning.
 */
export function interceptExternalLinks(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  document.addEventListener("click", event => {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!anchor) return;

    const href = anchor.getAttribute("href") ?? "";
    if (!isHttpUrl(href)) return;

    // Same-origin links are app navigation and are left alone; in a packaged
    // build the app is served from tauri.localhost.
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin) return;

    event.preventDefault();
    void openExternal(url.href);
  }, true);
}
