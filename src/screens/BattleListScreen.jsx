import React from "react";
import { BattleRow, Button, Input, Select, Checkbox, Badge,
  MapImage, UserChip, EmptyState } from "../ds/shiro.js";
import { useMapResourceId } from "../hooks/useMapResourceId.js";

const DEMO_OCCUPANTS = ["hexed", "quantum", "tinman", "lorelei", "marrow", "nine"];

/* One item of lobby news.

   Every field is optional and absent means absent - the server serialises with
   NullValueHandling.Ignore - so an item is a headline, or a picture, or a
   paragraph, or any combination of the three, and each part is drawn only if it
   arrived. `newsList` in store/adapters.ts is where that is worked out.

   A link is a plain anchor with a target, which the document-level interceptor
   in net/external.ts turns into an opener call. An anchor WITHOUT a target
   navigates the webview and replaces the app with a web page, with no way
   back. */
function NewsItem({ header, text, when, url, image }) {
  const imgRef = React.useRef(null);
  const [broken, setBroken] = React.useState(false);
  /* A news picture is an admin's upload and can be deleted from under us, so
     this is the map thumbnails' 404 again - and so is the trap. The image stays
     mounted and is hidden with `display`, because unmounting it on failure
     takes the ref away exactly when a later src needs to clear the failure, and
     the failure then latches for the life of the strip. `naturalWidth` is asked
     rather than waited for, so a picture already in hand is not hidden by a
     load event that fired before anyone was listening. */
  React.useLayoutEffect(() => {
    const el = imgRef.current;
    if (!el) return undefined;
    const settle = () => setBroken(el.naturalWidth === 0);
    if (el.complete) { settle(); return undefined; }
    setBroken(false);
    el.addEventListener("error", settle);
    return () => el.removeEventListener("error", settle);
  }, [image]);

  const Root = url ? "a" : "div";
  const rootProps = url
    ? { href: url, target: "_blank", rel: "noreferrer", title: "Open " + url }
    : {};
  return (
    <Root {...rootProps} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)",
      textDecoration: "none", color: "inherit" }}>
      {/* Its own shape, not a band. LobbyNewsController resizes every upload to
          256 wide and leaves the height to whatever was sent - the one item on
          the live site today is a square screenshot of a web page - so a fixed
          ratio would crop half of it away. 256 is also wider than this column,
          so nothing here is ever enlarged. The cap is for the portrait upload
          that would otherwise take the strip; it crops from the bottom. */}
      {image && (
        <img ref={imgRef} src={image} alt=""
          style={{ width: "100%", height: "auto", maxHeight: 200, objectFit: "cover",
            objectPosition: "center top", display: broken ? "none" : "block" }} />
      )}
      {when && <span style={{ font: "var(--w-regular) var(--size-micro)/1 var(--font-mono)",
        color: "var(--text-faint)" }}>{when}</span>}
      {header && <span style={{ font: "var(--text-ui-sm)", color: "var(--text-hi)",
        overflowWrap: "anywhere" }}>{header}</span>}
      {text && <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
        color: "var(--text-low)", overflowWrap: "anywhere" }}>{text}</span>}
    </Root>
  );
}

/* Lobby news at the foot of the filter strip.

   ZkLobbyServer has sent this to every client on connect since 2017 and Shiro
   counted it as unhandled. It goes here rather than on a landing screen of its
   own: the battle list is the screen a player is already on, this is the one
   piece of it that is dead space, and a screen between login and the list would
   put a page in the way of the thing people opened the app to do - which is the
   density DESIGN_HANDOFF section 3 spends its anti-goals arguing against.

   Ten items at most, so the strip scrolls rather than the filters moving. */
function NewsStrip({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column",
      paddingTop: "var(--sp-5)", borderTop: "1px solid var(--w-06)" }}>
      <span className="lab">NEWS</span>
      {/* Scrollable, but without a 10px gutter taken out of a 200px column for
          a control nobody drags. The fade at the foot is what says there is
          more below now that the bar does not. */}
      <div className="scroll-quiet"
        style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: "var(--sp-4)",
          display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
        {items.map((n, i) => <NewsItem key={i} {...n} />)}
      </div>
    </div>
  );
}

/* Screen 3 - the default view and the highest-traffic surface.
   Left: filter strip. Centre: the list. Right: detail for the selected battle. */
export default function BattleListScreen({ battles, onJoin, occupants,
  onHost, onSpectate, inRoom, onReturn, onLeaveRoom, news }) {
  /* Nothing is selected until somebody selects something. The default is
     worked out below from the list as it stands, so there is one rule for it
     rather than one at mount and another afterwards - the mount-time one used
     to win, and it picked whatever happened to be first. */
  const [sel, setSel] = React.useState(undefined);
  const [q, setQ] = React.useState("");
  const [mode, setMode] = React.useState("All modes");
  const [hideRunning, setHideRunning] = React.useState(false);
  const [hideLocked, setHideLocked] = React.useState(false);
  const [hideFull, setHideFull] = React.useState(false);
  const list = battles.filter(b =>
    (mode === "All modes" || b.mode === mode) &&
    (!hideRunning || !b.running) &&
    (!hideLocked || !b.locked) &&
    (!hideFull || !b.full) &&
    (q === "" || (b.title + " " + b.founder + " " + b.map).toLowerCase().includes(q.toLowerCase())));
  /* Ordering is busiest-first, which can put a running game at the top - you
     cannot join one of those, so the default selection skips to the first room
     you can actually do something with. An explicit click still wins; this is
     only the fallback when nothing is selected. */
  const current = list.find(b => b.id === sel) || list.find(b => !b.running) || list[0];
  const mapId = useMapResourceId(current && current.map);
  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "200px minmax(0,1fr) 300px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)", padding: "var(--sp-5)",
        minHeight: 0, borderRight: "1px solid var(--w-12)", background: "var(--surface-sunken)" }}>
        <Button variant="primary" icon="plus" block onClick={onHost}>Host a battle</Button>
        <Input label="Filter" placeholder="Title, host, map" icon="search" value={q} onChange={e => setQ(e.target.value)} />
        <Select label="Mode" value={mode} onChange={e => setMode(e.target.value)}
          options={["All modes", "Teams", "1v1", "FFA", "Coop"]} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <Checkbox label="Hide running" checked={hideRunning} onChange={e => setHideRunning(e.target.checked)} />
          <Checkbox label="Hide passworded" checked={hideLocked} onChange={e => setHideLocked(e.target.checked)} />
          <Checkbox label="Hide full" checked={hideFull} onChange={e => setHideFull(e.target.checked)} />
        </div>
        <NewsStrip items={news} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {/* You can look at the list while you are in a room, so the list has to
            say so. Without this the only evidence of still being in one was
            that leaving it changed something. */}
        {inRoom && (
          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: "var(--sp-4)",
            padding: "var(--sp-4) var(--sp-5)", borderBottom: "1px solid var(--w-12)",
            background: "var(--surface-selected)" }}>
            <Badge tone="solid">In a room</Badge>
            <span style={{ flex: 1, minWidth: 0, font: "var(--w-medium) var(--size-small)/1.2 var(--font-core)",
              color: "var(--text-hi)", whiteSpace: "nowrap", overflow: "hidden",
              textOverflow: "ellipsis" }}>{inRoom.title}</span>
            {onLeaveRoom && <Button variant="ghost" size="sm" onClick={onLeaveRoom}>Leave</Button>}
            {onReturn && <Button variant="secondary" size="sm" onClick={onReturn}>Back to room</Button>}
          </div>
        )}
        <div style={{ height: 26, flex: "0 0 auto", display: "flex", alignItems: "center",
          gap: "var(--sp-5)", padding: "0 var(--sp-5) 0 var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab" style={{ width: 96 }}>MAP</span>
          <span className="lab" style={{ flex: 1 }}>BATTLE</span>
          <span className="lab" style={{ width: 88, textAlign: "right" }}>MODE</span>
          <span className="lab" style={{ width: 62, textAlign: "right" }}>PLAYERS</span>
          <span className="lab" style={{ width: 44, textAlign: "right" }}>SPEC</span>
          <span style={{ width: 74 }} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {list.length === 0
            ? <EmptyState numeral={100} title="No battles open right now."
                action={<Button variant="primary" icon="plus" onClick={onHost}>Host a battle</Button>} />
            : list.map((b, i) => (
              /* Double-click joins. BattleRow takes an `onJoin` and never calls
                 it - there is no double-click handler anywhere in the component
                 - so the prop has always been accepted and dropped. The design
                 system is generated and must not be hand-edited, so the
                 handler goes on a wrapper here instead. */
              <div key={b.id} onDoubleClick={() => onJoin(b)} style={{ position: "relative" }}>
                <BattleRow {...b} selected={current && current.id === b.id}
                  onClick={() => setSel(b.id)}
                  style={{ animation: "shiro-enter var(--dur-base) var(--ease-out) " + Math.min(i, 12) * 12 + "ms both" }} />
                {/* A full room used to look exactly like one you could walk
                    into - the count greys out, and that is the whole of it.
                    Over the thumbnail because every other part of the row is
                    text that truncates, and click-through because the row
                    underneath is the thing you are aiming at. */}
                {b.full && (
                  <span style={{ position: "absolute", left: "var(--sp-3)", bottom: "var(--sp-3)",
                    pointerEvents: "none" }}>
                    <Badge tone="solid" mono>{b.queued > 0 ? "FULL +" + b.queued : "FULL"}</Badge>
                  </span>
                )}
              </div>
            ))}
        </div>
      </div>

      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", minHeight: 0 }}>
        {current ? (
          <>
            <MapImage map={current.map} resourceId={mapId} kind="minimap" ratio="1" caption link saturate={1} style={{ flex: "0 0 auto" }} />
            <div style={{ padding: "var(--sp-5)", display: "flex", flexDirection: "column", gap: "var(--sp-5)",
              borderBottom: "1px solid var(--w-06)" }}>
              <span style={{ font: "var(--text-heading)", color: "var(--text-hi)" }}>{current.title}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
                <Badge tone="outline">{current.mode}</Badge>
                <Badge mono>{current.players}/{current.maxPlayers}</Badge>
                {current.full && <Badge tone="solid">Full</Badge>}
                {current.locked && <Badge tone="outline" icon="lock">Locked</Badge>}
                {current.running && <Badge tone="danger">In progress</Badge>}
                {current.matchmaker && <Badge tone="solid">MM</Badge>}
              </div>
              {/* What being full costs you, since the server never says it out
                  loud: it moves the arrival to spectator and sends them a
                  private line. Worth knowing before the click rather than
                  after, and worth saying that no queue is holding you a
                  place - people ask, and the answer is no.

                  Names belong to the room screen, not here. A `BattleHeader`
                  carries counts only, and the per-person statuses that identify
                  who is waiting are broadcast to members of that battle - so
                  the list can say how many and the room can say who. */}
              {current.full && (
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
                  color: "var(--text-low)" }}>
                  {current.queued > 0
                    ? current.queued + " past the cap. Joining makes you a spectator."
                    : "Joining makes you a spectator."}
                </span>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--sp-3) var(--sp-5)" }}>
                <span className="lab">HOST</span>
                <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>{current.founder}</span>
                <span className="lab">MAP</span>
                <span style={{ font: "var(--w-medium) var(--size-tiny)/1.3 var(--font-mono)", color: "var(--text-body)",
                  overflowWrap: "anywhere" }}>{current.map}</span>
                <span className="lab">ENGINE</span>
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.3 var(--font-mono)", color: "var(--text-faint)" }}>2025.06.21</span>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-5)" }}>
              <span className="lab">IN THIS ROOM</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", marginTop: "var(--sp-4)" }}>
                {(() => {
                  /* Live occupancy is derived from User.BattleID - BattleHeader
                     carries no roster, and the full player list only arrives in
                     JoinBattleSuccess once you are actually in the room. */
                  const names = occupants ? occupants(current.id) : DEMO_OCCUPANTS;
                  const shown = names.slice(0, 6);
                  const rest = Math.max(0, (occupants ? names.length : current.players) - shown.length);
                  if (!shown.length) {
                    return <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
                      color: "var(--text-faint)" }}>Nobody here yet.</span>;
                  }
                  return (
                    <>
                      {shown.map(n => <UserChip key={n} name={n} presence="room" size="sm" />)}
                      {rest > 0 && <span className="lab">+{rest} MORE</span>}
                    </>
                  );
                })()}
              </div>
            </div>
            {/* Two named actions rather than one button plus an unlabelled eye.
                Joining and spectating are different intentions, and which one
                the icon meant was a guess - it also said "Watch" on the primary
                for a running game, so both buttons claimed to spectate. */}
            <div style={{ padding: "var(--sp-5)", borderTop: "1px solid var(--w-12)", display: "flex", gap: "var(--sp-4)" }}>
              <Button variant="primary" size="lg" style={{ flex: 1 }} icon="play"
                onClick={() => onJoin(current)}>Join room</Button>
              <Button variant="outline" size="lg" icon="eye"
                onClick={() => (onSpectate ? onSpectate(current) : onJoin(current))}>Spectate</Button>
            </div>
          </>
        ) : <EmptyState icon="swords" title="Nothing selected." />}
      </div>
    </div>
  );
}
