import React from "react";
import { IconButton, Icon } from "../ds/shiro.js";
import { minimize, toggleMaximize, close } from "../net/window.js";
import logoMark from "../assets/logo-mark.svg";

export const NAV = [
  { id: "battles", icon: "swords", label: "Battles" },
  { id: "chat", icon: "message-square", label: "Chat" },
  { id: "queue", icon: "target", label: "Matchmaker" },
  { id: "maps", icon: "map", label: "Maps" },
  { id: "friends", icon: "users", label: "Friends" },
  { id: "profile", icon: "user", label: "Profile" },
  { id: "debrief", icon: "trophy", label: "Last match" },
  { id: "apps", icon: "package", label: "Apps" }
];

export function TitleBar({ version = "0.1.0", updateReady }) {
  return (
    <div data-tauri-drag-region style={{ height: "var(--shell-titlebar)", flex: "0 0 auto", display: "flex", alignItems: "center",
      gap: "var(--sp-5)", padding: "0 var(--sp-3) 0 var(--sp-5)", borderBottom: "1px solid var(--w-12)",
      background: "var(--surface-base)" }}>
      <img src={logoMark} width="15" height="15" alt=""
        style={{ opacity: 0.9, filter: "var(--logo-filter, none)" }} />
      <span style={{ font: "var(--w-bold) var(--size-micro)/1 var(--font-core)", fontStretch: "100%",
        letterSpacing: "var(--track-wordmark)", color: "var(--text-hi)" }}>SHIRO</span>
      <span style={{ flex: 1 }} />
      {/* The build's own version, and a quiet mark when a newer one is waiting.
          Deliberately not a dialog: an update prompt over a battle is an
          interruption, and Settings is where the button lives. */}
      <span title={updateReady ? "An update is ready - see Settings" : undefined}
        style={{ font: "var(--w-regular) var(--size-micro)/1 var(--font-mono)",
          color: updateReady ? "var(--text-body)" : "var(--text-faint)" }}>
        {version}{updateReady ? " ·" : ""}
      </span>
      <div style={{ display: "flex", gap: 0 }}>
        <IconButton icon="minus" label="Minimise" size="sm" onClick={minimize} />
        <IconButton icon="square" label="Maximise" size="sm" onClick={toggleMaximize} />
        <IconButton icon="x" label="Close" size="sm" onClick={close} />
      </div>
    </div>
  );
}

export function NavRail({ view, onView, inRoom }) {
  return (
    <nav style={{ width: "var(--shell-nav)", flex: "0 0 auto", display: "flex", flexDirection: "column",
      alignItems: "center", gap: "var(--sp-2)", padding: "var(--sp-4) 0",
      borderRight: "1px solid var(--w-12)", background: "var(--surface-sunken)" }}>
      {NAV.map(n => (
        <div key={n.id} style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
          {/* --text-hi, not the ink ramp: the marker is the same ink as the
              item it marks, and only the semantic layer follows a skin. */}
          {view === n.id && <span style={{ position: "absolute", left: 0, top: 3, bottom: 3, width: 2, background: "var(--text-hi)" }} />}
          <IconButton icon={n.icon} label={n.label} size="lg" active={view === n.id} onClick={() => onView(n.id)} />
          {/* A room you are in is a thing you can walk away from and forget.
              The dot follows Battles because that is where the room lives. */}
          {inRoom && n.id === "battles" && (
            <span aria-hidden style={{ position: "absolute", right: 6, top: 6, width: 6, height: 6,
              borderRadius: "50%", background: "var(--text-hi)", pointerEvents: "none" }} />
          )}
        </div>
      ))}
      <span style={{ flex: 1 }} />
      {/* Screens 9 and 10 were deferred, so both of these land on Settings -
          which is where the content policy and the install live. A button that
          does nothing is worse than one that explains itself. */}
      <IconButton icon="download" label="Downloads" size="lg"
        active={view === "downloads"} onClick={() => onView("downloads")} />
      <IconButton icon="settings" label="Settings" size="lg"
        active={view === "settings"} onClick={() => onView("settings")} />
    </nav>
  );
}

export function StatusBar({ connection = "online", users, engine, game, onReconnect, attempt }) {
  const map = {
    online: { icon: "wifi", text: "Connected", color: "var(--text-low)" },
    reconnecting: { icon: "loader", text: attempt ? "Reconnecting - attempt " + attempt : "Connecting", color: "var(--signal-warn)" },
    offline: { icon: "wifi-off", text: "Lost connection", color: "var(--signal-danger)" }
  }[connection];
  return (
    <div style={{ height: "var(--shell-statusbar)", flex: "0 0 auto", display: "flex", alignItems: "center",
      gap: "var(--sp-6)", padding: "0 var(--sp-5)", borderTop: "1px solid var(--w-12)",
      background: "var(--surface-sunken)" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", color: map.color }}>
        <Icon name={map.icon} size={14} style={{ width: 12, height: 12,
          animation: connection === "reconnecting" ? "shiro-pulse 1s var(--ease-standard) infinite" : "none" }} />
        <span style={{ font: "var(--text-label)", letterSpacing: "var(--track-label-tight)", textTransform: "uppercase" }}>{map.text}</span>
      </span>
      {connection !== "online" && (
        <button type="button" onClick={onReconnect} style={{ background: "none", border: 0, padding: 0,
          cursor: "pointer", font: "var(--w-medium) var(--size-micro)/1 var(--font-core)",
          color: "var(--text-hi)", textDecoration: "underline" }}>Retry now</button>
      )}
      <span style={{ flex: 1 }} />
      <span style={{ font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)", color: "var(--text-low)",
        fontVariantNumeric: "tabular-nums" }}>{users} online</span>
      <span style={{ font: "var(--w-regular) var(--size-micro)/1 var(--font-mono)", color: "var(--text-faint)" }}>engine {engine}</span>
      <span style={{ font: "var(--w-regular) var(--size-micro)/1 var(--font-mono)", color: "var(--text-faint)" }}>{game}</span>
    </div>
  );
}

export default function AppShell({ view, onView, inRoom, connection, users, engine, game, onReconnect, attempt, children, overlay,
  version, updateReady }) {
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%",
      minHeight: 0, background: "var(--surface-base)", overflow: "hidden" }}>
      <TitleBar version={version} updateReady={updateReady} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <NavRail view={view} onView={onView} inRoom={inRoom} />
        <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>{children}</main>
      </div>
      <StatusBar connection={connection} users={users} engine={engine} game={game} onReconnect={onReconnect} attempt={attempt} />
      {overlay}
    </div>
  );
}
