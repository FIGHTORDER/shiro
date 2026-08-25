/* Native window controls. The design draws its own titlebar
   (tauri.conf.json sets decorations:false), so these have to be wired by hand. */
import { inTauri } from "./connection";

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function minimize() { if (inTauri()) (await win()).minimize(); }
export async function toggleMaximize() { if (inTauri()) (await win()).toggleMaximize(); }
export async function close() { if (inTauri()) (await win()).close(); }

/* Restoring the window after a game. The engine takes exclusive fullscreen and
   Windows hands us back un-maximized, so the state has to be captured before
   the launch and put back afterwards - see restoreAfterGame in store/game.ts. */
export async function isMaximized() { return inTauri() ? (await win()).isMaximized() : false; }
export async function maximize() { if (inTauri()) (await win()).maximize(); }
export async function unminimize() { if (inTauri()) (await win()).unminimize(); }
export async function setFocus() { if (inTauri()) (await win()).setFocus(); }

/* Flag the window without stealing focus - a taskbar flash on Windows, a
   bouncing icon on macOS, whatever the desktop does on Linux. The Zero-K
   client does this (`ZeroKLobby/WindowsApi.cs`, FlashWindowEx) and Shiro did
   not, so a ready check firing behind another window made no mark at all.

   Deliberately not setFocus(): pulling a window in front of whatever somebody
   is doing is not an acceptable way to say "your turn", and a ready check can
   arrive while they are mid-sentence in something else. */
export async function requestAttention() {
  if (!inTauri()) return;
  const { UserAttentionType } = await import("@tauri-apps/api/window");
  await (await win()).requestUserAttention(UserAttentionType.Informational);
}
