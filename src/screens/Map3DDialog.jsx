import React from "react";

import { Dialog, Button, Checkbox, EmptyState } from "../ds/shiro.js";
import { asTerrainFailure, mapTerrain, worldAspect } from "../net/mapterrain.ts";
import Map3D from "./Map3D.jsx";
import { floodedAt } from "./mapwater.ts";

/* The 3D view, in a window of its own.
 *
 * Big, because the whole point is to see relief that a 172px card cannot show,
 * and a shape you cannot turn is just a second picture. */

/**
 * The panel to show instead of the map, from the kind of failure it was.
 *
 * Only `missing` is entitled to say anything about the map itself. An
 * unreachable site is a fact about the connection, and saying "Zero-K has not
 * published a heightmap" there is a confident claim about a map nobody
 * managed to ask about.
 */
function failurePanel(failure) {
  const asset = failure.asset === "minimap" ? "minimap" : "heightmap";
  if (failure.kind === "missing") {
    return { title: "No 3D view for this map.", body: `Zero-K has not published a ${asset} for it.` };
  }
  if (failure.kind === "network") {
    return {
      title: "Could not reach zero-k.info.",
      body: "The map images did not arrive. This is the connection, not the map.",
    };
  }
  return { title: "No 3D view for this map.", body: failure.message };
}

function Slider({ label, value, min, max, step, onChange, hint, readout }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", flex: 1, minWidth: 150 }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: "var(--sp-3)" }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-3)", minWidth: 0 }}>
          <span className="lab">{label}</span>
          {/* Tabular, so the number does not jog the label as it changes. */}
          {readout && <span style={{ font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)",
            color: "var(--text-mid)", fontVariantNumeric: "tabular-nums" }}>{readout}</span>}
        </span>
        {hint && <span style={{ font: "var(--text-ui-sm)", color: "var(--text-faint)" }}>{hint}</span>}
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)" }} />
    </label>
  );
}

export default function Map3DDialog({ map, open, onClose }) {
  const name = map?.name;
  const [terrain, setTerrain] = React.useState(null);
  const [failure, setFailure] = React.useState(null);
  const [water, setWater] = React.useState(0.28);
  const [showWater, setShowWater] = React.useState(false);
  const [profile, setProfile] = React.useState(undefined);

  React.useEffect(() => {
    if (!open || !name) return undefined;
    let live = true;
    setTerrain(null);
    setFailure(null);
    /* The measurement belongs to the map that was on screen a moment ago, and
       nothing else clears it: the dialog stays mounted between maps, so the
       waterline hint would keep quoting the old map's flooded percentage for
       the whole fetch, or forever if the new one fails. */
    setProfile(undefined);
    mapTerrain(name).then(
      t => { if (live) setTerrain(t); },
      e => { if (live) setFailure(asTerrainFailure(e)); },
    );
    return () => { live = false; };
  }, [open, name]);

  const aspect = worldAspect(map);

  return (
    <Dialog open={Boolean(open && map)} title={name ? `${name} in 3D` : "Map in 3D"}
      width={860} onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 10",
          background: "var(--surface-sunken)", border: "1px solid var(--w-12)",
          overflow: "hidden" }}>
          {failure
            ? <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
                padding: "var(--sp-5)" }}>
                <EmptyState icon="image" title={failurePanel(failure).title}
                  body={failurePanel(failure).body} />
              </div>
            : terrain
              ? <Map3D heightmap={terrain.heightmap} minimap={terrain.minimap}
                  aspect={aspect} water={water} showWater={showWater}
                  onProfile={setProfile} />
              : <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
                  font: "var(--text-ui-sm)", color: "var(--text-low)" }}>
                  Fetching the terrain...
                </div>}
        </div>

        <div style={{ display: "flex", gap: "var(--sp-5)", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", flex: 1, minWidth: 150 }}>
            <Checkbox checked={showWater} onChange={e => setShowWater(e.target.checked)} label="Show water" />
            {showWater && (
              <Slider label="WATERLINE" value={water} min={0} max={1} step={0.01}
                onChange={setWater}
                readout={Math.round(water * 100) + "%"}
                hint={floodedAt(profile, water)} />
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
