import React from "react";

import { IconButton, EmptyState } from "../ds/shiro.js";

/* The inbox: what happened while you were on another screen.
 *
 * The point of it is that a ping should not cost you a trip to the chat panel
 * to find out about, so it holds more than the notifications do - a
 * notification is only sent when Shiro is not in front of you, and this list is
 * most useful when it is. store/notify.ts keeps the two decisions apart for
 * exactly that reason. */

const KIND_ICON = {
  readyCheck: "target",
  partyInvite: "user-plus",
  mention: "message-square",
  battleStart: "play",
};

/* Coarse on purpose. To the minute is enough to know whether you missed
   something, and a live-updating clock in a dropdown is a render loop for no
   gain. */
export function ago(then, now) {
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Item({ item, now, onPick }) {
  const clickable = Boolean(item.to && onPick);
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onPick(item) : undefined}
      onKeyDown={clickable
        ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(item); } }
        : undefined}
      style={{
        display: "flex", gap: "var(--sp-4)", padding: "var(--sp-4) var(--sp-5)",
        borderBottom: "1px solid var(--w-06)", cursor: clickable ? "pointer" : "default",
        background: item.read ? "transparent" : "var(--w-04)",
        alignItems: "flex-start",
      }}>
      <span aria-hidden style={{ marginTop: 2, flex: "0 0 auto", opacity: 0.75 }}>
        <IconButton icon={KIND_ICON[item.kind] || "message-square"} label="" size="sm"
          style={{ pointerEvents: "none" }} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
        gap: "var(--sp-2)" }}>
        <span style={{ display: "flex", gap: "var(--sp-3)", alignItems: "baseline" }}>
          <span style={{ font: "var(--text-ui-sm)", color: "var(--text-hi)",
            overflowWrap: "anywhere" }}>{item.title}</span>
          <span style={{ flex: 1 }} />
          <span style={{ font: "var(--text-ui-sm)", color: "var(--text-faint)",
            whiteSpace: "nowrap" }}>{ago(item.at, now)}</span>
        </span>
        {item.body && (
          <span style={{ font: "var(--text-ui-sm)", color: "var(--text-low)",
            overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.body}</span>
        )}
      </span>
    </div>
  );
}

export default function Inbox({ items = [], unread = 0, onRead, onClear, onPick }) {
  const [open, setOpen] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const wrap = React.useRef(null);

  /* Stamped when the panel opens rather than ticking: the times are to the
     minute, and nothing here is on screen long enough to go stale. */
  React.useEffect(() => { if (open) setNow(Date.now()); }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Opening it is reading it. Nothing else marks these.
    if (next && unread > 0 && onRead) onRead();
  };

  return (
    <div ref={wrap} style={{ position: "relative", display: "flex" }}>
      <IconButton icon="bell" size="sm" active={open}
        label={unread > 0 ? `Inbox, ${unread} new` : "Inbox"}
        onClick={toggle} />
      {unread > 0 && (
        <span aria-hidden style={{
          position: "absolute", right: 3, top: 3, minWidth: 6, height: 6,
          borderRadius: 3, background: "var(--text-hi)", pointerEvents: "none",
        }} />
      )}
      {open && (
        <div role="dialog" aria-label="Inbox" style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, width: 340,
          maxHeight: 420, display: "flex", flexDirection: "column", zIndex: 70,
          background: "var(--surface-panel)", border: "1px solid var(--w-20)",
          boxShadow: "var(--elev-menu)",
        }}>
          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center",
            gap: "var(--sp-3)", padding: "var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-5)",
            borderBottom: "1px solid var(--w-12)" }}>
            <span className="lab">INBOX</span>
            <span style={{ flex: 1 }} />
            {items.length > 0 && onClear && (
              <IconButton icon="x" label="Clear the inbox" size="sm" onClick={onClear} />
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {items.length === 0
              ? <div style={{ padding: "var(--sp-6) var(--sp-5)" }}>
                  <EmptyState icon="bell" title="Nothing yet."
                    body="Pings, party invites and matches show up here." />
                </div>
              : items.map(i => <Item key={i.id} item={i} now={now} onPick={onPick} />)}
          </div>
        </div>
      )}
    </div>
  );
}
