/**
 * Which arrivals are worth interrupting somebody for.
 *
 * Shiro had no way to reach a player who was not looking at it. The Zero-K
 * client has three - it flashes the taskbar (`ZeroKLobby/WindowsApi.cs`,
 * `FlashWindowEx`), keeps a tray icon, and pops balloon tips
 * (`MainWindow.cs`, `ShowBalloonTip`) - and a ready check firing while you are
 * alt-tabbed was completely silent here. Missing one costs the match and can
 * earn the matchmaker ban `QueueScreen` already draws a countdown for.
 *
 * The bar for firing one is *something is waiting on you*, not *something
 * happened*. Four things qualify:
 *
 *   AreYouReady    a deadline, and a ban if you miss it
 *   OnPartyInvite  a deadline, and a person waiting on the answer
 *   Say            a direct message, or a channel line that named you
 *   ConnectSpring  the game you are in is starting without you
 *
 * Everything else does not: battle-list churn, ordinary channel traffic, a
 * download finishing. `docs/DESIGN_HANDOFF.md` §6 already settled the shape of
 * this argument for the updater - "an update prompt over a battle is an
 * interruption" - and the same judgement applies to a notification.
 *
 * The decision is a pure function so it can be tested without a webview, a
 * notification permission or an OS. `subscribe` is the only part that touches
 * anything.
 */
import type { Message } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { registerSlice } from "./slices.ts";
import { routeSay, roomKey, mentionsMe, useChat, BACKLOG_SETTLE_MS } from "./chat.ts";
import { useSettings } from "./settings.ts";

export type AlertKind = "readyCheck" | "partyInvite" | "mention" | "battleStart";

export interface Alert {
  kind: AlertKind;
  title: string;
  /** The second line, where there is one worth reading. */
  body?: string;
}

export interface AlertContext {
  /** Our own name, so our own messages do not notify us. */
  me?: string;
  /** Looking at Shiro right now. Nothing fires when this is true. */
  focused: boolean;
  /** Whether this kind is switched on in settings. */
  enabled: (kind: AlertKind) => boolean;
  /**
   * Whether a channel has been open long enough that a line in it is new.
   *
   * Rejoining a channel replays its backlog, and a replayed mention is not
   * somebody calling you - it is the same call you already answered. The chat
   * store makes exactly this distinction for its unread marks; this asks it
   * rather than restating the rule. Direct messages are never replayed, so the
   * question is not asked about them.
   */
  settled: (channel: string) => boolean;
  /**
   * The player's own highlight words.
   *
   * A highlight is defined as ringing the way a name does, and a name reaches
   * you when Shiro is behind another window - so a highlight has to as well,
   * or the setting means two different things depending on where you are
   * looking. The `mention` switch still governs both.
   */
  highlights?: readonly string[];
}

/** What deserves an interruption, out of one batch. */
export function alertsFor(messages: Message[], ctx: AlertContext): Alert[] {
  /* Somebody watching the window does not need telling. This is the whole
     reason the effect is separated from the decision: "is it focused" is a
     fact about the world, and every rule below is not. */
  if (ctx.focused) return [];

  const out: Alert[] = [];
  const add = (kind: AlertKind, title: string, body?: string): void => {
    if (ctx.enabled(kind)) out.push({ kind, title, body });
  };

  for (const m of messages) {
    switch (m.cmd) {
      case "AreYouReady":
        add("readyCheck", "Match found", "Accept before the countdown runs out.");
        break;

      case "OnPartyInvite": {
        const d = m.data as T.OnPartyInvite;
        /* The invite names everybody who would be in the party, us included,
           so the inviter is whoever is not us. With nobody left to name, the
           title still says what happened. */
        const from = (d.UserNames ?? []).filter(n => n !== ctx.me);
        add("partyInvite", "Party invite", from.length ? from.join(", ") : undefined);
        break;
      }

      case "ConnectSpring":
        add("battleStart", "Your game is starting");
        break;

      case "Say": {
        const d = m.data as T.Say;
        const dest = routeSay(d, ctx.me);
        // MessageBox and anything unroutable are not chat; routeSay says so.
        if (!dest || !d.User || d.User === ctx.me) break;
        if (dest.kind === "dm") {
          add("mention", d.User, d.Text);
        } else if (dest.kind === "channel"
          && mentionsMe(d.Text, ctx.me, d.User, ctx.highlights) && ctx.settled(dest.name)) {
          /* Reading the text, not `Say.Ring`. The server strips Ring for an
             ordinary player in an ordinary channel, so a rule keyed on it never
             fires - see mentionsMe in chat.ts for the code that does the
             stripping. This is the branch that makes the mention category
             worth having at all. */
          add("mention", `${d.User} in #${dest.name}`, d.Text);
        }
        break;
      }

      default:
        break;
    }
  }
  return out;
}

/** The context as it actually is, right now. */
function live(): AlertContext {
  const s = useSettings.getState();
  const enabled: Record<AlertKind, boolean> = {
    readyCheck: s.notifyReadyCheck,
    partyInvite: s.notifyPartyInvite,
    mention: s.notifyMention,
    battleStart: s.notifyBattleStart,
  };
  return {
    me: useChat.getState().me,
    highlights: s.highlights,
    /* `document.hasFocus()` rather than anything from Tauri: it is true for
       exactly the case we care about - the window is in front of the person -
       and it needs no permission and no bridge, so the browser demo behaves
       the same as the desktop app. */
    focused: typeof document !== "undefined" && document.hasFocus(),
    enabled: kind => enabled[kind],
    settled: channel => {
      const room = useChat.getState().rooms[roomKey("channel", channel)];
      /* No room yet means the line arrived before the join was processed, which
         is not a replay - a replay only happens into a room we just opened. */
      return !room || Date.now() - room.openedAt >= BACKLOG_SETTLE_MS;
    },
  };
}

/*
 * Registered at load, the same as every other slice. Both effects fire, and
 * deliberately: a flash is what somebody with the window merely behind another
 * one sees, and a notification is what reaches somebody who has it minimised.
 * Neither covers the other.
 *
 * Outside Tauri both are no-ops, so the browser demo runs this code and does
 * nothing with it - which is what makes it safe to register unconditionally.
 */
registerSlice(messages => {
  const alerts = alertsFor(messages, live());
  if (!alerts.length) return;
  /* Imported here rather than at the top, the same way party.ts reaches
     net/session: these two are plain .js with extensionless imports, so a
     static import would drag them into `node --test`, which resolves neither.
     Nothing is loaded until something is actually worth announcing. */
  void import("../net/window.js").then(w => w.requestAttention());
  void import("../net/notify.js").then(n => {
    for (const a of alerts) void n.post(a.title, a.body);
  });
});
