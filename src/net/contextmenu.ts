/**
 * Taking away the webview's own right-click menu.
 *
 * A Tauri window is a browser, and it brings a browser's context menu with it:
 * Back, Forward, Reload, Save as, Print, Inspect. None of that means anything
 * in a lobby - there is nothing to go back to, reloading throws away the
 * connection, and "Save as" would save the app. It reads as a seam where the
 * desktop app stops and the web page underneath shows through.
 *
 * **Editable fields keep theirs.** Right-clicking an input gives Cut, Copy,
 * Paste, Undo, and those are the menu somebody actually wants - typing a
 * password by pasting it is a normal thing to do. So the line is drawn where
 * the complaint is: the *page* menu goes, the *text* menu stays.
 *
 * Selected text keeps it too, for the same reason. Copying a name out of chat
 * to look somebody up is exactly the sort of thing this app is for.
 *
 * Only in Tauri. In a browser tab, taking away the context menu of a page
 * somebody chose to open in their own browser is rude, and the demo is a page.
 */
import { inTauri } from "./connection";

function editable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  /* A button or a checkbox is an `input` with nothing to cut, copy or paste,
     so only the ones that hold text count. */
  return tag === "INPUT"
    && !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"]
      .includes((el as HTMLInputElement).type);
}

function hasSelection(): boolean {
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim());
}

export function suppressPageContextMenu(): void {
  if (!inTauri()) return;
  window.addEventListener("contextmenu", e => {
    if (editable(e.target as Element) || hasSelection()) return;
    e.preventDefault();
  });
}
