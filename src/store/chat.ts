/**
 * Chat state: channels, private conversations and battle-room chat.
 *
 * This is a feature slice - it registers with store/slices.ts at module load
 * and receives the same per-animation-frame batch the core lobby store gets.
 * It deliberately owns nothing the core store owns; the only thing it copies is
 * our own account name, which it learns from `LoginResponse` (and which the UI
 * can also push in with `setMe`).
 *
 * Two constraints shape the imports here:
 *
 * - The unit tests run under Node's type-stripping loader, so this module must
 *   not import a TS `enum` (a runtime construct strip-only mode refuses) and
 *   must use explicit `.ts` extensions on runtime imports.
 * - `net/session.ts` reaches Tauri's `invoke` at import time, so it is pulled in
 *   lazily inside the send actions rather than at the top of the file. That
 *   keeps the reducer testable in plain Node with no Tauri shim.
 */
import { create } from "zustand";

import type { CommandName, Message, MessageMap } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import type { SayPlace } from "../protocol/enums.ts";
import { mergePatch } from "../protocol/wire.ts";
import { registerSlice } from "./slices.ts";
import { useSettings } from "./settings.ts";

/**
 * `SayPlace` restated as literals, for the strip-only reason above. The type
 * annotations are checked against the generated enum at compile time, so if
 * upstream renumbers `SayPlace` this file stops compiling rather than silently
 * routing battle chat into a channel.
 */
const PLACE_CHANNEL: SayPlace.Channel = 0;
const PLACE_BATTLE: SayPlace.Battle = 1;
const PLACE_USER: SayPlace.User = 2;
const PLACE_BATTLE_PRIVATE: SayPlace.BattlePrivate = 3;
const PLACE_GAME: SayPlace.Game = 4;

/** Same cap the core store uses for its flat chat log. */
export const MAX_MESSAGES = 500;

/**
 * On join the server replays that channel's backlog - about 20 `Say` messages
 * inside the login flood, all before any live message. Those must land in
 * scrollback without lighting up every tab as unread, so unread counting for a
 * channel starts only once it has been open this long. Measured by arrival, not
 * by `Say.Time`, because the client clock can be skewed against the server's.
 *
 * Only channels get a replay - private and battle chat are never re-sent - so
 * the window is not applied to them, and a DM arriving into a freshly created
 * conversation still rings.
 */
export const BACKLOG_SETTLE_MS = 2000;

export type RoomKind = "channel" | "dm" | "battle";

export interface ChatMessage {
  /** Monotonic per store; a stable React key. The server gives us no id. */
  id: number;
  /** ISO-8601 from the server, absent on locally generated notices. */
  time?: string;
  /** Sender. Absent means a server notice, rendered as a system line. */
  user?: string;
  text?: string;
  emote: boolean;
  ring: boolean;
  system: boolean;
}

export interface Room {
  id: string;
  kind: RoomKind;
  /** Channel name, or the other party's name for a DM. */
  name: string;
  /** Tab label: `#zk` for channels, the bare name for a DM. */
  label: string;
  users: string[];
  topic?: T.Topic;
  messages: ChatMessage[];
  unread: number;
  mention: boolean;
  /** False while a join is in flight, or after we were removed. */
  joined: boolean;
  /** Wall-clock ms when this room appeared; drives the backlog window. */
  openedAt: number;
}

/** Exactly the shape the Shiro `Tabs` component takes. */
export interface TabItem {
  id: string;
  label: string;
  unread: number;
  mention: boolean;
  dm: boolean;
}

/** All battle chat shares one room; you can only be in one battle at a time. */
export const BATTLE_ROOM = "b:battle";

export function roomKey(kind: RoomKind, name: string): string {
  if (kind === "battle") return BATTLE_ROOM;
  return `${kind === "channel" ? "c" : "u"}:${name.toLowerCase()}`;
}

function labelOf(kind: RoomKind, name: string): string {
  if (kind === "battle") return "Battle";
  return kind === "channel" ? `#${name}` : name;
}

/**
 * How far back a replayed line is looked for.
 *
 * The replay is the channel's last twenty or so; a little more than that is
 * enough to find any of them and cheap enough to do per `Say`.
 */
const REPLAY_LOOKBACK = 60;

/**
 * Is this line already in the scrollback?
 *
 * Only asked inside a channel's settle window, where the answer means the
 * server is replaying a backlog we already hold. `Time` is the server's own
 * stamp and is carried through unchanged, so an exact match on speaker, words
 * and stamp is the replay. A line with no stamp is not matched: without it
 * there is nothing to tell a replay from somebody saying "gg" twice.
 */
function alreadySaid(room: Room, say: T.Say): boolean {
  if (!say.Time) return false;
  const from = Math.max(0, room.messages.length - REPLAY_LOOKBACK);
  for (let i = room.messages.length - 1; i >= from; i--) {
    const m = room.messages[i];
    if (m.time === say.Time && m.user === say.User && m.text === say.Text) return true;
  }
  return false;
}

/**
 * Which room a `Say` belongs to.
 *
 * `Place=User` is a private message and is echoed to both parties, so the
 * conversation is named after whichever of `User`/`Target` is not us. Battle,
 * BattlePrivate and Game all render in the battle room. MessageBox is a modal
 * server notice, not chat, and is dropped here.
 */
/**
 * The bot that posts battle results into channels.
 *
 * Its lines carry the whole roster, so every player in them is "named" - which
 * would ring the entire channel after every game. Upstream excludes it for this
 * exact reason (`ZeroKLobby/MicroLobby/ChatControl.cs`), and the name is a
 * server constant (`GlobalConst.NightwatchName`).
 */
const NIGHTWATCH = "Nightwatch";

/**
 * Did somebody say your name?
 *
 * **Not `Say.Ring`.** The flag exists, and the server throws it away before it
 * reaches you: `ZkLobbyServer/ConnectedUser.cs` keeps `Ring` only for an admin,
 * or for the founder of a battle saying it in battle chat -
 *
 *     if (say.Ring)
 *         if (!User.IsAdmin)
 *             if (((say.Place != SayPlace.Battle) && ...) || MyBattle == null ||
 *                 (MyBattle.FounderName != Name)) say.Ring = false;
 *
 * so in an ordinary channel it is always false for an ordinary player. Anything
 * keyed on it can essentially never fire, which is why the mention mark had
 * never appeared.
 *
 * The Zero-K client reads the text instead - `e.Text.Contains(LobbyPlayerName)
 * && e.UserName != NightwatchName` - and so does this. Two deliberate
 * differences: the match is case-insensitive, because people type `qrow` for
 * `Qrow`; and it is bounded by non-name characters, so `Qrowd` is not `Qrow`.
 * Upstream's bare `Contains` does neither, and both are wrong often enough to
 * be worth not copying.
 */
/* A name is whatever the server allows in one, so the boundary is "not a
   character a name could contain" rather than \b - which would treat the
   underscore in `[clan]_Qrow` as part of the word and miss it. */
const namey = (c?: string) => Boolean(c) && /[A-Za-z0-9_\[\]]/.test(c as string);

/**
 * Does `text` say `term` as a word of its own?
 *
 * Every occurrence, not just the first. Checking only the first meant one
 * embedded near-match hid a real one behind it: "Qrowd and Qrow both played"
 * did not ring, because the scan stopped at `Qrowd` and gave up.
 */
export function saysTerm(text: string, term: string): boolean {
  if (!term) return false;
  const hay = text.toLowerCase();
  const needle = term.toLowerCase();
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    if (!namey(text[at - 1]) && !namey(text[at + term.length])) return true;
  }
  return false;
}

/**
 * @param extra Words the player asked to be told about as well as their name.
 */
export function mentionsMe(
  text?: string, me?: string, from?: string, extra?: readonly string[],
): boolean {
  if (!text || from === NIGHTWATCH) return false;
  if (me && saysTerm(text, me)) return true;
  return (extra ?? []).some(t => saysTerm(text, t.trim()));
}

/* Read at the moment a line arrives rather than captured once, so a rule
   added mid-session applies to the next message and not the next launch. */
function highlights(): readonly string[] {
  return useSettings.getState().highlights;
}

export function routeSay(d: T.Say, me?: string): { kind: RoomKind; name: string } | null {
  switch (d.Place) {
    case PLACE_CHANNEL:
      return d.Target ? { kind: "channel", name: d.Target } : null;
    case PLACE_USER: {
      const other = me && d.User === me ? d.Target : d.User;
      return other ? { kind: "dm", name: other } : null;
    }
    case PLACE_BATTLE:
    case PLACE_BATTLE_PRIVATE:
    case PLACE_GAME:
      return { kind: "battle", name: "Battle" };
    default:
      return null;
  }
}

interface ChatState {
  rooms: Record<string, Room>;
  /** Tab order, oldest first. */
  order: string[];
  active?: string;
  me?: string;
  /** Last rejected join, for surfacing "no such channel" style failures. */
  lastError?: { channel: string; reason: string };
  nextId: number;

  applyBatch: (messages: Message[]) => void;
  applyMessage: (m: Message) => void;
  setMe: (name?: string) => void;
  setActive: (id: string) => void;
  openDm: (name: string) => string;
  join: (channel: string) => void;
  leave: (channel: string) => void;
  /** Ask for every channel we are in again, after a reconnect. */
  rejoinChannels: () => void;
  close: (id: string) => void;
  say: (id: string, text: string) => void;
  reset: () => void;
}

const EMPTY = {
  rooms: {} as Record<string, Room>,
  order: [] as string[],
  active: undefined as string | undefined,
  lastError: undefined as { channel: string; reason: string } | undefined,
  nextId: 1,
};

/**
 * Send a command without dragging `net/session` (and therefore Tauri) into this
 * module's import graph. Failures are logged, never thrown: a dropped Say must
 * not take a store action down with it.
 */
function tx<K extends CommandName>(cmd: K, data: MessageMap[K]): void {
  void import("../net/session")
    .then(m => m.send(cmd, data))
    .catch(err => console.error(`chat: ${cmd} failed:`, err));
}

export const useChat = create<ChatState>((set, get) => ({
  ...EMPTY,
  me: undefined,

  applyMessage: m => get().applyBatch([m]),

  /**
   * Apply one batch in a single store write. The login flood is ~90 messages
   * over four seconds and the caller already coalesces per animation frame, so
   * the only rule here is: touch state once, never per message.
   */
  applyBatch: messages => {
    /** Channels the server told us to join; dispatched after the state write. */
    const autoJoin: string[] = [];

    set(state => {
      const now = Date.now();
      const rooms: Record<string, Room> = { ...state.rooms };
      let order = state.order;
      let me = state.me;
      let lastError = state.lastError;
      let nextId = state.nextId;
      const touched = new Set<string>();

      /** Get a mutable copy of a room, creating it if this is the first we hear of it. */
      const ensure = (kind: RoomKind, name: string): Room => {
        const id = roomKey(kind, name);
        const existing = rooms[id];
        if (!existing) {
          if (order === state.order) order = [...order];
          order.push(id);
          rooms[id] = {
            id,
            kind,
            name,
            label: labelOf(kind, name),
            // A DM's "membership" is the other party; channels fill in from the server.
            users: kind === "dm" ? [name] : [],
            messages: [],
            unread: 0,
            mention: false,
            // A channel is not joined until the server confirms it.
            joined: kind !== "channel",
            openedAt: now,
          };
          touched.add(id);
          return rooms[id];
        }
        if (!touched.has(id)) {
          rooms[id] = { ...existing, users: [...existing.users], messages: [...existing.messages] };
          touched.add(id);
        }
        return rooms[id];
      };

      const push = (room: Room, msg: Omit<ChatMessage, "id">): void => {
        room.messages.push({ id: nextId++, ...msg });
      };

      const notice = (room: Room, text: string): void => {
        push(room, { text, emote: false, ring: false, system: true });
      };

      /**
       * A full or partial ChannelHeader. Absent fields mean "unchanged" - see
       * mergePatch in protocol/wire.ts - so a header carrying only a new topic
       * must not blank the user list.
       */
      const applyHeader = (room: Room, h: T.ChannelHeader): void => {
        if (h.Users) room.users = [...h.Users];
        if (h.Topic) room.topic = mergePatch(room.topic, h.Topic);
      };

      for (const m of messages) {
        switch (m.cmd) {
          case "LoginResponse": {
            const d = m.data as T.LoginResponse;
            if (d.ResultCode === 0 && d.Name) me = d.Name;
            break;
          }

          case "JoinChannelResponse": {
            const d = m.data as T.JoinChannelResponse;
            const name = d.ChannelName ?? d.Channel?.ChannelName;
            if (!name) break;
            if (!d.Success) {
              lastError = { channel: name, reason: d.Reason ?? "Could not join that channel." };
              // Drop the optimistic tab, but only if nothing was ever said in it.
              const id = roomKey("channel", name);
              const room = rooms[id];
              if (room && room.messages.length === 0) {
                delete rooms[id];
                if (order === state.order) order = [...order];
                order = order.filter(x => x !== id);
                touched.delete(id);
              }
              break;
            }
            const room = ensure("channel", name);
            room.joined = true;
            if (d.Channel) applyHeader(room, d.Channel);
            break;
          }

          /* A topic change is broadcast on its own, and is worth a line in the
             channel: it is usually why the channel suddenly went quiet. */
          case "ChangeTopic": {
            const d = m.data as T.ChangeTopic;
            if (!d.ChannelName || !rooms[roomKey("channel", d.ChannelName)]) break;
            const room = ensure("channel", d.ChannelName);
            if (d.Topic) {
              room.topic = mergePatch(room.topic, d.Topic);
              if (d.Topic.Text) {
                notice(room, `${d.Topic.SetBy ?? "somebody"} set the topic: ${d.Topic.Text}`);
              }
            }
            break;
          }

          case "ChannelHeader": {
            const d = m.data as T.ChannelHeader;
            if (!d.ChannelName) break;
            const room = ensure("channel", d.ChannelName);
            room.joined = true;
            applyHeader(room, d);
            break;
          }

          case "ChannelUserAdded": {
            const d = m.data as T.ChannelUserAdded;
            if (!d.ChannelName || !d.UserName) break;
            const room = ensure("channel", d.ChannelName);
            if (!room.users.includes(d.UserName)) room.users.push(d.UserName);
            if (me && d.UserName === me) room.joined = true;
            break;
          }

          case "ChannelUserRemoved": {
            const d = m.data as T.ChannelUserRemoved;
            if (!d.ChannelName || !d.UserName) break;
            const id = roomKey("channel", d.ChannelName);
            if (!rooms[id]) break;
            const room = ensure("channel", d.ChannelName);
            room.users = room.users.filter(u => u !== d.UserName);
            // Keep the tab and its scrollback if it was us; only the membership changed.
            if (me && d.UserName === me) room.joined = false;
            break;
          }

          case "KickFromChannel": {
            const d = m.data as T.KickFromChannel;
            if (!d.ChannelName) break;
            const room = ensure("channel", d.ChannelName);
            const reason = d.Reason ? ` (${d.Reason})` : "";
            if (d.UserName) room.users = room.users.filter(u => u !== d.UserName);
            if (!d.UserName || (me && d.UserName === me)) {
              room.joined = false;
              notice(room, `You were removed from ${room.label}${reason}.`);
            } else {
              notice(room, `${d.UserName} was removed from the channel${reason}.`);
            }
            break;
          }

          case "ForceJoinChannel": {
            // The server is telling a client to enter a channel. Open the tab
            // now and ask to join; a JoinChannelResponse confirms it.
            const d = m.data as T.ForceJoinChannel;
            if (!d.ChannelName) break;
            if (d.UserName && me && d.UserName !== me) break;
            ensure("channel", d.ChannelName);
            autoJoin.push(d.ChannelName);
            break;
          }

          case "Say": {
            const d = m.data as T.Say;
            const dest = routeSay(d, me);
            if (!dest) break;
            const room = ensure(dest.kind, dest.name);
            const backlog = room.kind === "channel" && now - room.openedAt < BACKLOG_SETTLE_MS;

            /* A reconnect re-joins every channel and the server replays each
               one's backlog, so inside the settle window the same twenty lines
               arrive on top of the twenty already in the scrollback. Same
               speaker, same words, same server timestamp is that replay and
               not a person repeating themselves to the second. */
            if (backlog && alreadySaid(room, d)) break;

            push(room, {
              time: d.Time,
              user: d.User,
              text: d.Text,
              emote: Boolean(d.IsEmote),
              ring: Boolean(d.Ring),
              system: !d.User,
            });

            const mine = Boolean(me && d.User === me);
            if (!mine && !backlog && room.id !== state.active) {
              room.unread += 1;
              /* `Ring` as well as the text, not instead of it: the server does
                 let it through for a battle founder ringing their own room, and
                 that is a real call for attention. */
              if (d.Ring || mentionsMe(d.Text, me, d.User, highlights())) room.mention = true;
            }
            break;
          }

          default:
            break;
        }
      }

      for (const id of touched) {
        const room = rooms[id];
        if (room.messages.length > MAX_MESSAGES) {
          room.messages = room.messages.slice(-MAX_MESSAGES);
        }
      }

      /* Land on the first room that appears. Without this the chat screen has
         tabs and no selection until you click one, which reads as a channel
         you joined but that has no backlog. Later rooms do not steal focus. */
      const active = state.active && rooms[state.active] ? state.active : order[0];

      return { rooms, order, me, lastError, nextId, active };
    });

    for (const channel of autoJoin) get().join(channel);
  },

  setMe: name => {
    if (name !== get().me) set({ me: name });
  },

  setActive: id => set(state => {
    const room = state.rooms[id];
    if (!room) return { active: id };
    return {
      active: id,
      rooms: { ...state.rooms, [id]: { ...room, unread: 0, mention: false } },
    };
  }),

  openDm: name => {
    const id = roomKey("dm", name);
    if (!get().rooms[id]) {
      set(state => ({
        rooms: {
          ...state.rooms,
          [id]: {
            id, kind: "dm", name, label: labelOf("dm", name), users: [name],
            messages: [], unread: 0, mention: false, joined: true, openedAt: Date.now(),
          },
        },
        order: [...state.order, id],
      }));
    }
    get().setActive(id);
    return id;
  },

  join: channel => {
    const id = roomKey("channel", channel);
    if (!get().rooms[id]) {
      set(state => ({
        rooms: {
          ...state.rooms,
          [id]: {
            id, kind: "channel", name: channel, label: labelOf("channel", channel), users: [],
            messages: [], unread: 0, mention: false, joined: false, openedAt: Date.now(),
          },
        },
        order: [...state.order, id],
      }));
    }
    tx("JoinChannel", { ChannelName: channel });
  },

  leave: channel => {
    tx("LeaveChannel", { ChannelName: channel });
    get().close(roomKey("channel", channel));
  },

  /* A reconnect is a fresh session on the server's side: it force-joins the
     default channels again and knows nothing about the ones this player typed
     `/join` for. Their tabs were still here, still showing scrollback, and
     silent - messages went nowhere and none arrived. Asking again is cheap and
     idempotent; the server answers with a JoinChannelResponse either way. */
  rejoinChannels: () => {
    /* The settle window starts again here. A tab that has been open all
       evening has an `openedAt` hours old, so without this the replay that
       answers each of these joins lands outside the window: every tab lit up
       with twenty unread, and any replayed line that named you rang the
       taskbar and fired an OS notification for a conversation you had already
       had. */
    const now = Date.now();
    set(state => {
      const rooms = { ...state.rooms };
      for (const room of Object.values(rooms)) {
        if (room.kind === "channel") rooms[room.id] = { ...room, openedAt: now };
      }
      return { rooms };
    });
    for (const room of Object.values(get().rooms)) {
      if (room.kind === "channel") tx("JoinChannel", { ChannelName: room.name });
    }
  },

  close: id => set(state => {
    if (!state.rooms[id]) return {};
    const rooms = { ...state.rooms };
    delete rooms[id];
    const at = state.order.indexOf(id);
    const order = state.order.filter(x => x !== id);
    const active = state.active === id
      ? order[Math.min(at, order.length - 1)]
      : state.active;
    return { rooms, order, active };
  }),

  /**
   * Send to a room. No local echo: the server relays our own Say back to us,
   * and echoing here would double every line.
   */
  say: (id, text) => {
    const room = get().rooms[id];
    if (!room) return;
    let body = text.trim();
    if (!body) return;

    // `/me does a thing` is the standard emote form; the server takes it as a flag.
    const emote = body.toLowerCase().startsWith("/me ");
    if (emote) body = body.slice(4).trim();
    if (!body) return;

    const place = room.kind === "channel" ? PLACE_CHANNEL
      : room.kind === "dm" ? PLACE_USER
      : PLACE_BATTLE;

    tx("Say", {
      Place: place,
      Target: room.kind === "battle" ? undefined : room.name,
      Text: body,
      IsEmote: emote,
      Ring: false,
    });
  },

  reset: () => set({ ...EMPTY, me: undefined }),
}));

/** Tab models for the Shiro `Tabs` component, in the order rooms were opened. */
export function selectTabs(state: Pick<ChatState, "rooms" | "order">): TabItem[] {
  const out: TabItem[] = [];
  for (const id of state.order) {
    const room = state.rooms[id];
    if (!room) continue;
    out.push({
      id: room.id,
      label: room.label,
      unread: room.unread,
      mention: room.mention,
      dm: room.kind === "dm",
    });
  }
  return out;
}

registerSlice(messages => useChat.getState().applyBatch(messages));
