import React from "react";
import { Icon } from "../ds/shiro.js";

/**
 * The right-click menu on a player, wherever a player is listed.
 *
 * Issue #1. Every action here already existed - the friends store has add,
 * remove, ignore, unignore and report, and a direct message is a click away on
 * the same row - but each lived on a different screen. Right-clicking a name is
 * where people look for them, which is what upstream does too
 * (`ZeroKLobby/MicroLobby/ContextMenus.cs`).
 *
 * Nothing new is sent to the server. This is a way in, not a new capability.
 */

const MENU_MIN_WIDTH = 176;
/* Keeps the menu off the very edge when it opens near one. */
const EDGE = 8;

/**
 * Wire a menu into a screen.
 *
 * Returns the element to render once, and an `open` to hand to a row's
 * `onContextMenu`. Kept as a hook so a screen has one menu rather than one per
 * row: a hundred mounted menus in a sixteen-team room is a hundred key
 * listeners, and only one can ever be open.
 */
export function usePlayerMenu(build) {
  const [at, setAt] = React.useState(undefined);

  const open = React.useCallback((e, user) => {
    if (!user || user.bot) return;
    e.preventDefault();
    e.stopPropagation();
    setAt({ x: e.clientX, y: e.clientY, user });
  }, []);

  const close = React.useCallback(() => setAt(undefined), []);

  const menu = at
    ? <PlayerMenu x={at.x} y={at.y} user={at.user} items={build(at.user)} onClose={close} />
    : null;

  return { open, close, menu };
}

function PlayerMenu({ x, y, user, items, onClose }) {
  const ref = React.useRef(null);
  const [pos, setPos] = React.useState({ left: x, top: y, ready: false });
  const live = items.filter(Boolean);

  /* Placed after mount, because where it fits depends on how tall it turned
     out. Drawn hidden for that one frame rather than at the wrong place and
     then jumping. */
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = globalThis.innerWidth ?? 0;
    const h = globalThis.innerHeight ?? 0;
    setPos({
      left: Math.max(EDGE, Math.min(x, w - r.width - EDGE)),
      top: Math.max(EDGE, Math.min(y, h - r.height - EDGE)),
      ready: true,
    });
  }, [x, y]);

  /* Anything that moves the menu away from the name it belongs to closes it:
     a click elsewhere, Escape, or the list scrolling underneath. */
  React.useEffect(() => {
    const away = e => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", away, true);
    document.addEventListener("contextmenu", away, true);
    document.addEventListener("keydown", key, true);
    globalThis.addEventListener("resize", onClose);
    globalThis.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("contextmenu", away, true);
      document.removeEventListener("keydown", key, true);
      globalThis.removeEventListener("resize", onClose);
      globalThis.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  /* Focus lands on the menu so Escape and the arrow keys work without a click,
     which is also what makes it reachable from the keyboard at all. */
  React.useEffect(() => { ref.current?.focus(); }, []);

  const onKeyDown = e => {
    const buttons = [...(ref.current?.querySelectorAll("button") ?? [])];
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons[(i + 1) % buttons.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(i <= 0 ? buttons.length : i) - 1].focus();
    }
  };

  return (
    <div ref={ref} role="menu" tabIndex={-1} onKeyDown={onKeyDown}
      aria-label={"Actions for " + user.name}
      style={{
        position: "fixed", left: pos.left, top: pos.top, zIndex: 60,
        minWidth: MENU_MIN_WIDTH, padding: "var(--sp-2) 0",
        background: "var(--surface-panel)", border: "1px solid var(--w-12)",
        boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,.18))",
        visibility: pos.ready ? "visible" : "hidden",
        outline: "none",
      }}>
      <div style={{ padding: "var(--sp-2) var(--sp-5) var(--sp-3)",
        font: "var(--w-semibold) var(--size-tiny)/1.2 var(--font-core)",
        color: "var(--text-low)", overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap" }}>{user.name}</div>
      {live.map((item, i) => (
        item.divider
          ? <div key={"d" + i} style={{ height: 1, margin: "var(--sp-2) 0",
              background: "var(--w-06)" }} />
          : <MenuItem key={item.label} {...item} onClose={onClose} />
      ))}
    </div>
  );
}

function MenuItem({ label, icon, danger, onSelect, onClose }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" role="menuitem"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      onClick={() => { onClose(); onSelect(); }}
      style={{
        display: "flex", alignItems: "center", gap: "var(--sp-4)", width: "100%",
        padding: "var(--sp-3) var(--sp-5)", border: 0, cursor: "pointer",
        textAlign: "left", font: "var(--text-ui-sm)",
        background: hover ? "var(--surface-hover)" : "transparent",
        color: danger ? "var(--signal-danger)" : "var(--text-body)",
      }}>
      {icon && <Icon name={icon} size={14} />}
      <span>{label}</span>
    </button>
  );
}

/**
 * The standard set, so every list offers the same actions in the same order.
 *
 * `me` gets a shorter menu: befriending or reporting yourself is not a thing,
 * and offering it is the kind of detail that makes a menu feel unconsidered.
 */
export function playerMenuItems({ user, me, friends, ignores, actions }) {
  if (!user || user.bot) return [];
  const name = user.name;
  const self = name === me;
  const isFriend = friends?.includes(name);
  const isIgnored = ignores?.includes(name);

  return [
    !self && actions.message
      && { label: "Message", icon: "message-square", onSelect: () => actions.message(name) },
    actions.profile
      && { label: "Profile", icon: "user", onSelect: () => actions.profile(name) },
    !self && { divider: true },
    !self && actions.friend && (isFriend
      ? { label: "Remove friend", icon: "user-minus", onSelect: () => actions.unfriend(name) }
      : { label: "Add friend", icon: "user-plus", onSelect: () => actions.friend(name) }),
    !self && actions.ignore && (isIgnored
      ? { label: "Unignore", icon: "volume-2", onSelect: () => actions.unignore(name) }
      : { label: "Ignore", icon: "volume-x", onSelect: () => actions.ignore(name) }),
    !self && actions.report
      && { label: "Report...", icon: "flag", danger: true, onSelect: () => actions.report(name) },
  ].filter(Boolean);
}

export default PlayerMenu;
