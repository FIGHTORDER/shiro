import React from "react";
import { Badge, Button, EmptyState, Icon, Select } from "../ds/shiro.js";

import { DIFFICULTIES, briefing, planetName, reachable } from "../net/galaxy.ts";
import { HOME, clampView, focus, place, planetAt, radius, zoomAt } from "./galaxyView.ts";

/* Zero-K's galaxy campaign.
 *
 * The map is SVG, not DOM. Seventy-one planets with hover, selection and the
 * lines between them, redrawn on every frame of a pan, is not something a
 * stack of absolutely positioned divs does well - and the maths is the same
 * either way, so the only thing DOM would buy is a fight with the layout
 * engine. Same call `Map3D` made for terrain.
 *
 * Everything that can be tested lives in galaxyView.ts (the pan and zoom) and
 * net/galaxy.ts (which planets are reachable). What is left here is drawing and
 * event plumbing.
 *
 * The content is not ours and is not shipped: it is read out of the zkmenu
 * package the player's own Zero-K downloaded, so this screen is empty on a
 * machine with no install and says so rather than looking broken. */

const label = {
  font: "var(--w-regular) var(--size-micro)/1 var(--font-core)",
  letterSpacing: "var(--track-label)",
  textTransform: "uppercase",
  color: "var(--text-faint)",
};

/* The states a planet can be in, and what each looks like. Kept as data
   because there are four of them and the difference between "captured" and
   "reachable" is a colour, not a code path. */
function planetLook(state) {
  if (state === "captured") {
    return { fill: "var(--text-hi)", stroke: "var(--text-hi)", opacity: 1 };
  }
  if (state === "open") {
    return { fill: "var(--surface-raised)", stroke: "var(--text-hi)", opacity: 1 };
  }
  /* A visible edge, not the faintest one: the fill is the same colour as the
     map behind it, so the stroke is the entire planet. */
  /* A colour, not a `--border-*` token: those are whole `border` shorthands
     ("1px solid rgba(...)"), so an SVG `stroke` set to one is invalid and
     computes to `none` - which is a planet with no edge, the same colour as the
     map behind it. The `--w-*` scale is the colour ramp. */
  return { fill: "var(--surface-base)", stroke: "var(--w-32)", opacity: 0.6 };
}

/* One of a planet's tips: a line of advice and the unit it is about.
 *
 * The picture is the one the Codex already ships - upstream names it
 * `unitpics/staticmex.png` and Shiro has `staticmex.webp` for 155 of the 166
 * the campaign mentions. The other eleven are commander modules and chassis
 * rather than units, so a miss is ordinary and the text stands on its own. */
function Tip({ tip }) {
  const [noImage, setNoImage] = React.useState(false);
  const name = typeof tip?.image === "string"
    ? tip.image.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "")
    : undefined;
  const text = typeof tip === "string" ? tip : tip?.text;
  if (!text) return null;
  return (
    <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-start" }}>
      {name && !noImage && (
        <img src={`/unitpics/${name}.webp`} alt="" width={32} height={32}
          onError={() => setNoImage(true)}
          style={{ flex: "0 0 auto", background: "var(--ink-000)" }} />
      )}
      <span style={{ font: "var(--w-regular) var(--size-micro)/1.4 var(--font-core)",
        color: "var(--text-low)" }}>{text}</span>
    </div>
  );
}

function Stat({ name, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--sp-4)" }}>
      <span style={label}>{name}</span>
      <span style={{ font: "var(--w-regular) var(--size-micro)/1.3 var(--font-mono)",
        color: "var(--text-body)", textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default function GalaxyScreen({
  campaign, save, busy, error, onPlay, onDifficulty, onRestart, onRefresh,
}) {
  const planets = campaign?.planets ?? [];
  const [selected, setSelected] = React.useState(undefined);
  const [hovered, setHovered] = React.useState(undefined);
  const [view, setView] = React.useState(HOME);
  const [size, setSize] = React.useState({ width: 900, height: 560 });
  const frame = React.useRef(null);
  const drag = React.useRef(null);

  /* The viewport in pixels, watched rather than measured once: the window is
     resizable and every coordinate here is relative to it. */
  React.useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        setSize({ width: box.width, height: box.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* A resize changes what counts as in bounds, so the view is re-clamped
     rather than left pointing at space that is no longer there. */
  React.useEffect(() => { setView(v => clampView(v, size)); }, [size]);

  const captured = save?.planetsCaptured ?? [];
  const open = React.useMemo(
    () => reachable(campaign ?? { planets: [] }, captured),
    [campaign, captured],
  );

  const marks = React.useMemo(() => planets.map((planet, i) => ({
    id: i + 1,
    planet,
    at: planet?.mapDisplay ?? {},
    size: planet?.mapDisplay?.size,
  })), [planets]);

  const chosen = selected ? marks.find(m => m.id === selected) : undefined;
  const chosenState = chosen
    ? (captured.includes(chosen.id) ? "captured" : open.has(chosen.id) ? "open" : "locked")
    : undefined;

  function pointIn(event) {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function onWheel(event) {
    event.preventDefault();
    // A trackpad sends many small deltas and a mouse a few large ones; the
    // exponent makes both feel like the same gesture.
    setView(v => zoomAt(v, size, Math.exp(-event.deltaY * 0.0015), pointIn(event)));
  }

  function onPointerDown(event) {
    const at = pointIn(event);
    drag.current = { from: at, view, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    const at = pointIn(event);
    if (!drag.current) {
      setHovered(planetAt(at, marks, view, size));
      return;
    }
    const dx = at.x - drag.current.from.x;
    const dy = at.y - drag.current.from.y;
    // A few pixels of slop, so a click with a shaky hand is still a click.
    if (Math.hypot(dx, dy) > 3) drag.current.moved = true;
    setView(clampView(
      { zoom: drag.current.view.zoom, x: drag.current.view.x + dx, y: drag.current.view.y + dy },
      size,
    ));
  }

  function onPointerUp(event) {
    const wasDrag = drag.current?.moved;
    drag.current = null;
    if (wasDrag) return;
    const hit = planetAt(pointIn(event), marks, view, size);
    if (hit) setSelected(hit);
  }

  /* Arrow keys walk the planets in order, which is the only way to reach one
     without a mouse - and the map is otherwise entirely pointer-driven. */
  function onKeyDown(event) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const from = selected ?? 0;
    const next = Math.min(marks.length, Math.max(1, from + step));
    setSelected(next);
    const mark = marks.find(m => m.id === next);
    if (mark) setView(focus(mark.at, size));
  }

  if (planets.length === 0) {
    return (
      <EmptyState icon="globe" title="No campaign here"
        body={error
          ? error
          : "The galaxy campaign is read out of Zero-K's own files. Install Zero-K, "
            + "or start the official lobby once so it downloads the campaign, and it "
            + "will appear here."}
        action={onRefresh ? <Button onClick={onRefresh}>Look again</Button> : null} />
    );
  }

  const difficulty = save?.difficultySetting ?? 2;
  const bonusDone = chosen ? (save?.bonusObjectivesComplete?.[String(chosen.id)] ?? []) : [];
  const beatenAt = chosen ? save?.completionDifficulty?.[String(chosen.id)] : undefined;

  return (
    /* `flex: 1` rather than `height: 100%`: AppShell's <main> is a flex row, so
       a child without a flex basis is sized by its content. The map inside is
       `flex: 1` of that, which is `flex: 1` of nothing - it collapsed to zero
       width while the fixed-width panel beside it still drew, which reads as a
       galaxy with no planets in it. */
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
      {/* The map */}
      <div ref={frame} tabIndex={0} onKeyDown={onKeyDown} onWheel={onWheel}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerLeave={() => { drag.current = null; setHovered(undefined); }}
        style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden",
          background: "var(--surface-sunken)", cursor: drag.current ? "grabbing" : "grab",
          outline: "none", touchAction: "none" }}>

        <svg width={size.width} height={size.height} style={{ display: "block" }}>
          {/* Links first, so a planet always sits on top of its own edges. */}
          <g stroke="var(--w-12)" strokeWidth={1}>
            {(campaign?.planetEdgeList ?? []).map(([a, b], i) => {
              const from = marks[a - 1];
              const to = marks[b - 1];
              if (!from || !to) return null;
              const p = place(from.at, view, size);
              const q = place(to.at, view, size);
              // An edge is lit only when both ends are somewhere the player
              // has been; a line into the dark is the shape of the unknown.
              const lit = captured.includes(a) || captured.includes(b);
              return (
                <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                  stroke={lit ? "var(--text-hi)" : "var(--w-12)"}
                  strokeOpacity={lit ? 0.5 : 0.25} />
              );
            })}
          </g>

          {marks.map(mark => {
            const at = place(mark.at, view, size);
            const r = radius(mark.size, view);
            // Off-screen planets are skipped: at 6x most of the galaxy is, and
            // drawing them is the difference between a smooth pan and a slow one.
            if (at.x < -r || at.y < -r || at.x > size.width + r || at.y > size.height + r) {
              return null;
            }
            const state = captured.includes(mark.id) ? "captured"
              : open.has(mark.id) ? "open" : "locked";
            const look = planetLook(state);
            const active = mark.id === selected;
            const hot = mark.id === hovered;
            return (
              <g key={mark.id} opacity={look.opacity}>
                <circle cx={at.x} cy={at.y} r={r}
                  fill={look.fill} stroke={look.stroke}
                  strokeWidth={active ? 3 : hot ? 2 : 1} />
                {active && (
                  <circle cx={at.x} cy={at.y} r={r + 5} fill="none"
                    stroke="var(--text-hi)" strokeWidth={1} strokeOpacity={0.7} />
                )}
                {/* Names only once there is room for them, which is also when
                    the player is looking at a region rather than the galaxy. */}
                {(view.zoom > 2 || active || hot) && (
                  <text x={at.x} y={at.y + r + 13} textAnchor="middle"
                    style={{ font: "var(--w-regular) var(--size-micro)/1 var(--font-core)",
                      fill: state === "locked" ? "var(--text-faint)" : "var(--text-body)",
                      pointerEvents: "none" }}>
                    {planetName(mark.planet, mark.id)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <div style={{ position: "absolute", left: "var(--sp-4)", bottom: "var(--sp-4)",
          display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          <Button size="sm" onClick={() => setView(v => zoomAt(v, size, 1.4,
            { x: size.width / 2, y: size.height / 2 }))}>+</Button>
          <Button size="sm" onClick={() => setView(v => zoomAt(v, size, 1 / 1.4,
            { x: size.width / 2, y: size.height / 2 }))}>-</Button>
          <Button size="sm" onClick={() => setView(HOME)}>Whole galaxy</Button>
          <span style={{ ...label, marginLeft: "var(--sp-2)" }}>
            {captured.length}/{planets.length} captured
          </span>
        </div>
      </div>

      {/* The briefing */}
      <aside style={{ width: 340, flex: "0 0 auto", display: "flex", flexDirection: "column",
        borderLeft: "1px solid var(--w-12)", background: "var(--surface-base)",
        minHeight: 0 }}>
        {!chosen ? (
          <div style={{ padding: "var(--sp-6)" }}>
            <EmptyState icon="target" title="Pick a planet"
              body="Lit planets are ones you can reach. Drag to pan, scroll to zoom." />
          </div>
        ) : (
          <>
            <div style={{ padding: "var(--sp-5)", borderBottom: "1px solid var(--w-12)",
              display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <span style={{ font: "var(--w-semibold) var(--size-base)/1.2 var(--font-core)",
                  color: "var(--text-hi)", flex: 1 }}>
                  {planetName(chosen.planet, chosen.id)}
                </span>
                {chosenState === "captured" && <Badge tone="success">Captured</Badge>}
                {chosenState === "locked" && <Badge>Locked</Badge>}
              </div>
              <span style={{ font: "var(--w-regular) var(--size-micro)/1 var(--font-mono)",
                color: "var(--text-faint)" }}>
                {chosen.planet?.gameConfig?.mapName ?? "no map named"}
              </span>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-5)",
              display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
              {briefing(chosen.planet) && (
                <p style={{ margin: 0, whiteSpace: "pre-wrap",
                  font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
                  color: "var(--text-body)" }}>
                  {briefing(chosen.planet)}
                </p>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <Stat name="Terrain" value={chosen.planet?.infoDisplay?.terrainType} />
                <Stat name="Radius" value={chosen.planet?.infoDisplay?.radius} />
                <Stat name="Primary" value={chosen.planet?.infoDisplay?.primary} />
                <Stat name="Beaten at"
                  value={beatenAt ? DIFFICULTIES.find(d => d.value === beatenAt)?.name : undefined} />
              </div>

              {(chosen.planet?.gameConfig?.bonusObjectiveConfig ?? []).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                  <span style={label}>Bonus objectives</span>
                  {chosen.planet.gameConfig.bonusObjectiveConfig.map((b, i) => (
                    <div key={i} style={{ display: "flex", gap: "var(--sp-3)",
                      alignItems: "flex-start" }}>
                      <Icon name={bonusDone.includes(i + 1) ? "check" : "circle"} size={13}
                        style={{ marginTop: 2, flex: "0 0 auto",
                          color: bonusDone.includes(i + 1) ? "var(--text-hi)" : "var(--text-faint)" }} />
                      <span style={{ font: "var(--w-regular) var(--size-micro)/1.4 var(--font-core)",
                        color: "var(--text-body)" }}>
                        {b.description ?? `Objective ${i + 1}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {(chosen.planet?.tips ?? []).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
                  <span style={label}>Tips</span>
                  {/* A tip is `{ image, text }`, not a string. Rendering the
                      object put React error #31 on the screen the moment a
                      planet was selected - which was unreachable while the map
                      had no width, so the two bugs hid each other. */}
                  {chosen.planet.tips.map((tip, i) => (
                    <Tip key={i} tip={tip} />
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: "var(--sp-5)", borderTop: "1px solid var(--w-12)",
              display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <Select label="Difficulty" size="sm"
                options={DIFFICULTIES.map(d => ({ value: String(d.value), label: d.name }))}
                value={String(difficulty)}
                onChange={v => onDifficulty?.(Number(v))} />

              {error && (
                <span style={{ font: "var(--w-regular) var(--size-micro)/1.4 var(--font-core)",
                  color: "var(--signal-danger)" }}>{error}</span>
              )}

              <Button variant="primary" disabled={busy || chosenState === "locked"}
                onClick={() => onPlay?.(chosen.id)}>
                {busy ? "Starting..." : chosenState === "locked" ? "Not reachable yet"
                  : chosenState === "captured" ? "Play again" : "Start mission"}
              </Button>
              {onRestart && (
                <Button size="sm" onClick={onRestart}>Restart the campaign</Button>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
