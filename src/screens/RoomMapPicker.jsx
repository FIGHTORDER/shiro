import React from "react";

import { Dialog, Button, Input, Badge, MapImage, EmptyState } from "../ds/shiro.js";
import { mapCatalogue, minimapRatio, normaliseMapName, sizeOf } from "../net/zkcatalogue.ts";
import { useNearViewport } from "../hooks/useNearViewport.js";

/* The map list, small enough to sit over a battle room.
 *
 * Picking one says `!map <name>` in battle chat, which is how the site's own
 * `select_map` link already does it and what every autohost takes. It is a
 * request, not a setting: an autohost may refuse, and the room's map only
 * changes when the server says it has. */

function Card({ map, current, onPick }) {
  const ref = React.useRef(null);
  const near = useNearViewport(ref);
  const [hover, setHover] = React.useState(false);
  const isCurrent = normaliseMapName(map.name) === normaliseMapName(current || "");
  return (
    <button ref={ref} type="button"
      onClick={() => onPick(map.name)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title={map.name}
      style={{
        display: "flex", flexDirection: "column", gap: "var(--sp-3)", padding: "var(--sp-3)",
        textAlign: "left", cursor: "pointer", background: hover ? "var(--surface-hover)" : "transparent",
        border: "1px solid " + (isCurrent ? "var(--text-hi)" : hover ? "var(--w-20)" : "var(--w-06)"),
        transition: "var(--transition-hover)", minWidth: 0,
      }}>
      {near && <MapImage map={map.name} kind="thumbnail" ratio={minimapRatio(map)} saturate={1}
        style={{ width: "100%" }} />}
      <span style={{ font: "var(--text-ui-sm)", color: "var(--text-hi)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{map.name}</span>
      <span style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center" }}>
        <span style={{ font: "var(--text-ui-sm)", color: "var(--text-faint)" }}>
          {sizeOf(map) ?? ""}
        </span>
        <span style={{ flex: 1 }} />
        {isCurrent && <Badge tone="solid">NOW</Badge>}
      </span>
    </button>
  );
}

export default function RoomMapPicker({ open, current, onPick, onClose }) {
  const [all, setAll] = React.useState(undefined);
  const [q, setQ] = React.useState("");

  React.useEffect(() => {
    if (!open || all) return undefined;
    let live = true;
    // Memoised for the session, so opening this twice is one request.
    mapCatalogue().then(
      c => { if (live) setAll([...c.values()]); },
      () => { if (live) setAll([]); },
    );
    return () => { live = false; };
  }, [open, all]);

  const query = q.trim().toLowerCase();
  const matches = React.useMemo(() => {
    const list = all ?? [];
    if (!query) return list;
    return list.filter(m => m.name.toLowerCase().includes(query));
  }, [all, query]);

  return (
    <Dialog open={Boolean(open)} title="Maps" width={720} onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <Input placeholder="Search the map list" value={q} size="sm"
          onChange={e => setQ(e.target.value)} />

        <div style={{ maxHeight: 420, overflowY: "auto", minHeight: 0 }}>
          {all === undefined
            ? <div style={{ padding: "var(--sp-6)", font: "var(--text-ui-sm)",
                color: "var(--text-low)", textAlign: "center" }}>Loading the map list...</div>
            : matches.length === 0
              ? <div style={{ padding: "var(--sp-6) var(--sp-5)" }}>
                  <EmptyState icon="search" title="No map by that name." />
                </div>
              : <div style={{ display: "grid", gap: "var(--sp-4)",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                  {matches.map(m => (
                    <Card key={m.name} map={m} current={current} onPick={onPick} />
                  ))}
                </div>}
        </div>
      </div>
    </Dialog>
  );
}
