import React from "react";

import { Dialog, Button, Checkbox, EmptyState } from "../ds/shiro.js";
import { mapTerrain, worldAspect } from "../net/mapterrain.ts";
import Map3D from "./Map3D.jsx";

/* The 3D view, in a window of its own.
 *
 * Big, because the whole point is to see relief that a 172px card cannot show,
 * and a shape you cannot turn is just a second picture. */

/**
 * How much of the map sits under a waterline, as a sentence.
 *
 * The slider's own position already shows where the line is; the number worth
 * reading is what that does to the map. `undefined` until the heightmap has
 * been measured, which is one frame after the dialog opens.
 */
function floodedAt(profile, water) {
  if (!profile || !profile.total) return undefined;
  const cut = Math.min(100, Math.max(0, Math.round(water * 100)));
  let under = 0;
  for (let b = 0; b < cut; b++) under += profile.buckets[b];
  const pct = (under / profile.total) * 100;
  if (pct <= 0) return "nothing under water";
  if (pct >= 99.5) return "all under water";
  // Under a percent is still worth distinguishing from none at all.
  return (pct < 1 ? "<1" : Math.round(pct)) + "% under water";
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
  const [error, setError] = React.useState(null);
  const [water, setWater] = React.useState(0.28);
  const [showWater, setShowWater] = React.useState(false);
  const [profile, setProfile] = React.useState(undefined);

  React.useEffect(() => {
    if (!open || !name) return undefined;
    let live = true;
    setTerrain(null);
    setError(null);
    mapTerrain(name).then(
      t => { if (live) setTerrain(t); },
      e => { if (live) setError(String(e?.message ?? e)); },
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
          {error
            ? <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
                padding: "var(--sp-5)" }}>
                <EmptyState icon="image" title="No 3D view for this map."
                  body={/heightmap/.test(error)
                    ? "Zero-K has not published a heightmap for it."
                    : error} />
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
