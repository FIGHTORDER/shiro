import React from "react";
import { Tabs, ChatLine, Input, Button, UserChip, EmptyState, IconButton } from "../ds/shiro.js";
import { useStickyScroll } from "../hooks/useStickyScroll.js";
import ChatText from "./ChatText.jsx";
import { completeAt } from "../store/complete.ts";

/* Screen 5 - channels and DMs. Tabs carry unread counts and mention (Ring) state.

   Driven either by the live chat store or, with no handlers, by the demo data
   in data.js: without `onSend` the composer echoes locally so the click-through
   still reads as a conversation. */
export default function ChatScreen({ channels, users, messages, active, onTab, onSend,
  onClose, onJoin, onUser, topic, onZk }) {
  const [tab, setTab] = React.useState(active || (channels[0] && channels[0].id));
  const [msg, setMsg] = React.useState("");
  /* Where a Tab cycle got to. A ref rather than state: it is read and written
     inside the keystroke that uses it, and re-rendering for it would be a
     render per Tab for something nothing draws. */
  const cycle = React.useRef(undefined);

  /* Tab completes a name; Enter sends. Without this Tab did what Tab does in a
     browser and moved the focus out of the box you were typing in. Candidates
     are the people in this conversation - the wider fallback ZeroKLobby keeps
     is `#zk`'s roster, which this screen does not hold. */
  const onComposerKey = e => {
    if (e.key === "Enter") { send(); return; }
    if (e.key !== "Tab" || e.shiftKey) return;
    const el = e.target;
    const next = completeAt(el.value, el.selectionStart ?? el.value.length,
      [users.map(u => u.name)], cycle.current);
    // No word to complete: let Tab move the focus, as it always has.
    if (!next) return;
    e.preventDefault();
    cycle.current = next;
    setMsg(next.text);
    /* The caret has to be put back after React has written the new value, or
       the browser leaves it at the end of the whole line. */
    requestAnimationFrame(() => el.setSelectionRange(next.caret, next.caret));
  };
  const [echo, setEcho] = React.useState([]);
  const [joining, setJoining] = React.useState("");

  const current = active != null ? active : tab;
  React.useEffect(() => { setEcho([]); }, [current]);

  const pick = id => { setTab(id); if (onTab) onTab(id); };
  const send = () => {
    const body = msg.trim();
    if (!body) return;
    setMsg("");
    if (onSend) onSend(body);
    else setEcho(l => [...l, { time: "21:07", user: { name: "Shadowfury", clan: "ZKF", country: "DE" }, text: body }]);
  };
  const join = () => {
    const name = joining.trim().replace(/^#/, "");
    if (!name || !onJoin) return;
    onJoin(name);
    setJoining("");
  };

  const lines = [...(messages || []), ...echo];
  // Follow new messages, but never yank the reader out of history.
  const scroll = useStickyScroll({ count: lines.length, resetKey: current });
  const meta = (channels || []).find(c => c.id === current) || {};
  const label = meta.label || current || "";

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--w-12)" }}>
          <Tabs value={current} onChange={pick} items={channels} style={{ flex: 1, minWidth: 0, borderBottom: "none" }} />
          {onClose && current && (
            <IconButton icon="x" label={"Close " + label} onClick={() => onClose(current)}
              style={{ alignSelf: "center", marginRight: "var(--sp-4)" }} />
          )}
        </div>
        {topic && (
          <div style={{ padding: "var(--sp-3) var(--sp-5)", borderBottom: "1px solid var(--w-06)",
            font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
            {topic}
          </div>
        )}
        <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
          <div ref={scroll.ref} onScroll={scroll.onScroll}
            style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingTop: "var(--sp-4)" }}>
            {lines.length === 0
              ? <EmptyState icon="message-square" title={"Nothing in " + label + " yet."} body="Say something." />
              : lines.map((l, i) => (
                /* `text` takes React children, so the links go in without
                   touching the generated design system. */
                <ChatLine key={l.id != null ? l.id : i} {...l}
                  text={<ChatText text={l.text} onZk={onZk} />} />
              ))}
          </div>
          {/* Only while the reader has scrolled away, so it never covers the
              conversation they are actually looking at. */}
          {!scroll.pinned && lines.length > 0 && (
            <Button variant="secondary" size="sm" icon="arrow-down" onClick={scroll.jump}
              style={{ position: "absolute", right: "var(--sp-6)", bottom: "var(--sp-5)",
                boxShadow: "var(--elev-menu)" }}>
              Newest
            </Button>
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-4) var(--sp-5)",
          borderTop: "1px solid var(--w-12)" }}>
          <Input placeholder={"Message " + label} value={msg} onChange={e => setMsg(e.target.value)}
            onKeyDown={onComposerKey} wrapStyle={{ flex: 1 }} />
          <Button variant="quiet" onClick={send}>Send</Button>
        </div>
      </div>
      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ height: 26, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 var(--sp-4)", borderBottom: "1px solid var(--w-06)" }}>
          <span className="lab">IN CHANNEL</span>
          <span style={{ font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)", color: "var(--text-low)" }}>{users.length}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-2) 0" }}>
          {users.map(u => (
            <div key={u.name} onClick={onUser ? () => onUser(u.name) : undefined}
              title={onUser ? "Message " + u.name : undefined}
              style={{ height: "var(--row-compact)", display: "flex", alignItems: "center",
                padding: "0 var(--sp-4)", cursor: onUser ? "pointer" : "default" }}>
              <UserChip {...u} size="sm" style={{ minWidth: 0 }} />
            </div>
          ))}
        </div>
        {onJoin && (
          <div style={{ display: "flex", gap: "var(--sp-3)", padding: "var(--sp-4)",
            borderTop: "1px solid var(--w-06)" }}>
            <Input placeholder="#channel" size="sm" value={joining} wrapStyle={{ flex: 1 }}
              onChange={e => setJoining(e.target.value)}
              onKeyDown={e => e.key === "Enter" && join()} />
            <Button variant="quiet" size="sm" onClick={join}>Join</Button>
          </div>
        )}
      </div>
    </div>
  );
}
