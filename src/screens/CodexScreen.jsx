import React from "react";
import { Button, Badge, EmptyState, Icon, Input, Select } from "../ds/shiro.js";
import {
  changesFor, factories, filterUnits, isStructure, roleOf, roles, sortUnits,
} from "../net/codex.ts";

/* Codex - the unit reference, built to the wireframes.
 *
 * Four sections and no more, because the design's own rule is that everything
 * else is a filter rather than a screen. Units and Structures are the same
 * machinery over a different half of the data; Changes reads the generated
 * change log; Modules has no data source yet and says so rather than pretending.
 *
 * The layout is the wiki split the design asks for: the list never moves, the
 * page changes beside it, and the stat card on the right does not scroll away.
 * Everything on a row - cost, health, speed - is there so the list itself
 * answers the fast question without anybody opening anything. */

const label = {
  font: "var(--w-regular) var(--size-micro)/1 var(--font-core)",
  letterSpacing: "var(--track-label)",
  textTransform: "uppercase",
  color: "var(--text-faint)",
};

const mono = {
  font: "var(--w-regular) var(--size-tiny)/1.2 var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-body)",
};

const SECTIONS = [
  { id: "units", label: "Units" },
  { id: "structures", label: "Structures" },
  { id: "modules", label: "Modules" },
  { id: "changes", label: "Changes" },
];

const SORTS = [
  { value: "name", label: "Name" },
  { value: "cost", label: "Cost" },
  { value: "health", label: "Health" },
  { value: "speed", label: "Speed" },
];

const num = n => (n === undefined || n === null ? "-" : Math.round(n * 10) / 10);

/* One row. 32px as drawn, and the numbers sit on it rather than behind a click:
   the whole point of the list is that it answers "which is cheaper" by itself. */
function UnitRow({ unit, active, onPick }) {
  const [hover, setHover] = React.useState(false);
  const role = roleOf(unit);
  return (
    <button type="button" onClick={onPick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        appearance: "none", border: 0, textAlign: "left", width: "100%",
        display: "grid", gridTemplateColumns: "1fr 62px 58px 52px 74px",
        gap: "var(--sp-4)", alignItems: "center", padding: "0 var(--sp-5)",
        height: 32, cursor: "pointer", color: "inherit",
        background: active ? "var(--surface-selected)"
          : hover ? "var(--surface-hover)" : "transparent",
        borderLeft: `2px solid ${active ? "var(--text-hi)" : "transparent"}`,
        boxShadow: "var(--rule-inset)", transition: "var(--transition-hover)",
      }}>
      <span style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: "var(--sp-3)" }}>
        <span style={{ font: "var(--w-semibold) var(--size-tiny)/1.2 var(--font-core)",
          color: "var(--text-hi)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap" }}>{unit.name}</span>
        <span style={{ font: "var(--w-regular) var(--size-micro)/1.2 var(--font-core)",
          color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap" }}>{unit.factory ?? ""}</span>
      </span>
      <span style={mono}>{num(unit.cost)}</span>
      <span style={mono}>{num(unit.health)}</span>
      <span style={mono}>{num(unit.speed)}</span>
      <span style={{ font: "var(--w-regular) var(--size-micro)/1.2 var(--font-core)",
        color: "var(--text-low)", overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap" }}>{role ?? ""}</span>
    </button>
  );
}

/* The unit as the game draws it.
 *
 * `tools/gen-unitpics.mjs` writes one WebP per unit into `public/unitpics`,
 * named by the unit's internal name, so there is nothing to look up. They are
 * the build menu's own pictures: a player recognises those, which is the point
 * of putting one here.
 *
 * Never enlarged. The source is 96 pixels square - a few are 64 - and stretching
 * one to fill the frame only advertises that it is small. It sits at its own
 * size on the sunken plate instead.
 *
 * Four units ship no picture, and the game removing one is a thing that happens
 * between releases, so a miss is a normal state rather than a broken image. */
function UnitPicture({ unit }) {
  /* Deliberately not `loading="lazy"`: the element only exists once a unit page
     is open, so the request is already deferred to the moment it is wanted.
     Deferring it again left the card empty whenever the panel started out of
     view, which in a narrow window is most of the time. */
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [unit.id]);
  return (
    <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center",
      border: "1px solid var(--w-12)", background: "var(--surface-sunken)" }}>
      {failed ? (
        <span style={{ ...label, textAlign: "center", lineHeight: 1.5 }}>
          No picture<br />for this unit
        </span>
      ) : (
        <img src={`/unitpics/${unit.id}.webp`} alt=""
          onError={() => setFailed(true)}
          style={{ maxWidth: "100%", maxHeight: "100%" }} />
      )}
    </div>
  );
}

/* The reference card. Fixed to the right of the prose and deliberately not part
   of the scrolling column: the design's note is that it never scrolls past. */
function StatCard({ unit }) {
  const rows = [
    ["Health", num(unit.health)],
    ["Speed", num(unit.speed)],
    ["Sight", num(unit.sight)],
    ["Cost", num(unit.cost)],
  ];
  const weapon = unit.weapon && [
    ["Damage", num(unit.weapon.damage)],
    ["Reload", unit.weapon.reload === undefined ? "-" : `${num(unit.weapon.reload)}s`],
    ["Range", num(unit.weapon.range)],
  ];
  return (
    <div style={{ width: 210, flex: "0 0 auto", display: "flex", flexDirection: "column",
      gap: "var(--sp-5)" }}>
      <UnitPicture unit={unit} />

      <div>
        <div style={{ ...label, marginBottom: "var(--sp-3)" }}>Core</div>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between",
            padding: "var(--sp-2) 0", boxShadow: "var(--rule-inset)" }}>
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.2 var(--font-core)",
              color: "var(--text-low)" }}>{k}</span>
            <span style={mono}>{v}</span>
          </div>
        ))}
      </div>

      {weapon && (
        <div>
          <div style={{ ...label, marginBottom: "var(--sp-3)" }}>Weapon</div>
          {weapon.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between",
              padding: "var(--sp-2) 0", boxShadow: "var(--rule-inset)" }}>
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.2 var(--font-core)",
                color: "var(--text-low)" }}>{k}</span>
              <span style={mono}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* The unit page: prose on the left, the card on the right. */
function UnitPage({ codex, unit }) {
  const prose = codex.prose[unit.id];
  const history = changesFor(codex, unit.id);
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-6)" }}>
      <div style={{ display: "flex", gap: "var(--sp-7)", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
          gap: "var(--sp-6)" }}>
          <div>
            <div style={{ font: "var(--w-semibold) var(--size-lg)/1.15 var(--font-core)",
              color: "var(--text-hi)" }}>{unit.name}</div>
            <div style={{ ...label, marginTop: 4 }}>
              {[unit.factory, roleOf(unit), unit.description].filter(Boolean).join(" · ")}
            </div>
            <div style={{ font: "var(--w-regular) var(--size-micro)/1.2 var(--font-mono)",
              color: "var(--text-faint)", marginTop: 6 }}>{unit.id}</div>
          </div>

          {prose?.description ? (
            <div>
              <div style={{ ...label, marginBottom: "var(--sp-3)" }}>Description</div>
              <p style={{ margin: 0, maxWidth: "62ch",
                font: "var(--w-regular) var(--size-tiny)/1.55 var(--font-core)",
                color: "var(--text-body)" }}>{prose.description}</p>
            </div>
          ) : (
            <div style={{ ...label }}>No wiki page for this unit</div>
          )}

          {prose?.tactics?.length > 0 && (
            <div>
              <div style={{ ...label, marginBottom: "var(--sp-3)" }}>Tactics</div>
              {/* A point per paragraph the wiki wrote. A reference is scanned
                  rather than read, and three hundred words of continuous prose
                  is the thing nobody scans. */}
              <ul style={{ margin: 0, paddingLeft: "1.1rem", maxWidth: "62ch",
                display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                {prose.tactics.map((point, i) => (
                  <li key={i} style={{ font: "var(--w-regular) var(--size-tiny)/1.55 var(--font-core)",
                    color: "var(--text-body)" }}>{point}</li>
                ))}
              </ul>
            </div>
          )}

          {history.length > 0 && (
            <div>
              <div style={{ ...label, marginBottom: "var(--sp-3)" }}>Recent changes</div>
              {history.map(({ entry, change }) => (
                <div key={entry.game} style={{ padding: "var(--sp-3) 0",
                  boxShadow: "var(--rule-inset)" }}>
                  <div style={{ ...label, marginBottom: 4 }}>{entry.game}</div>
                  {Object.entries(change.fields).map(([field, [was, now]]) => (
                    <div key={field} style={{ ...mono, display: "flex", gap: "var(--sp-3)" }}>
                      <span style={{ color: "var(--text-low)", minWidth: 96 }}>{field}</span>
                      <span>{was ?? "-"} &rarr; {now ?? "-"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* The licence the wiki text arrives under. Required, and it belongs
              beside the prose rather than in an About box nobody opens. */}
          {prose && (
            <div style={{ ...label, lineHeight: 1.5 }}>
              Description from the Zero-K wiki, {codex.proseLicence.licence}
            </div>
          )}
        </div>

        <StatCard unit={unit} />
      </div>
    </div>
  );
}

/* Changes, newest first, as one list across every recorded game build. */
function ChangesList({ codex, onPick }) {
  if (!codex.changes.length) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <EmptyState icon="history" title="No changes recorded yet."
          body="A change list appears once the Codex data has been rebuilt against a newer Zero-K than the one it currently carries." />
      </div>
    );
  }
  const byId = Object.fromEntries(codex.units.map(u => [u.id, u]));
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      {codex.changes.map(entry => (
        <div key={`${entry.previous}->${entry.game}`}>
          <div style={{ ...label, padding: "var(--sp-5) var(--sp-6) var(--sp-3)" }}>
            {entry.game} &mdash; recorded {entry.recorded}
          </div>
          {Object.entries(entry.changed).map(([id, change]) => (
            <button key={id} type="button" onClick={() => byId[id] && onPick(byId[id])}
              style={{ appearance: "none", border: 0, width: "100%", textAlign: "left",
                background: "transparent", color: "inherit", cursor: byId[id] ? "pointer" : "default",
                padding: "var(--sp-3) var(--sp-6)", boxShadow: "var(--rule-inset)",
                display: "flex", gap: "var(--sp-5)", alignItems: "baseline" }}>
              <span style={{ font: "var(--w-semibold) var(--size-tiny)/1.2 var(--font-core)",
                color: "var(--text-hi)", minWidth: 120 }}>{change.name}</span>
              <span style={{ ...mono, display: "flex", gap: "var(--sp-5)", flexWrap: "wrap" }}>
                {Object.entries(change.fields).map(([f, [was, now]]) => (
                  <span key={f}>
                    <span style={{ color: "var(--text-low)" }}>{f} </span>
                    {was ?? "-"} &rarr; {now ?? "-"}
                  </span>
                ))}
              </span>
            </button>
          ))}
          {[["added", entry.added], ["removed", entry.removed]].map(([kind, list]) => (
            list.length > 0 && (
              <div key={kind} style={{ padding: "var(--sp-3) var(--sp-6)",
                boxShadow: "var(--rule-inset)", display: "flex", gap: "var(--sp-4)",
                alignItems: "baseline" }}>
                <span style={{ ...label, minWidth: 120 }}>{kind}</span>
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
                  color: "var(--text-body)" }}>{list.map(u => u.name).join(", ")}</span>
              </div>
            )
          ))}
        </div>
      ))}
    </div>
  );
}

export default function CodexScreen({ gameVersion }) {
  const [codex, setCodex] = React.useState(undefined);
  const [error, setError] = React.useState(undefined);
  const [section, setSection] = React.useState("units");
  const [search, setSearch] = React.useState("");
  const [factory, setFactory] = React.useState(undefined);
  const [role, setRole] = React.useState(undefined);
  const [sort, setSort] = React.useState("cost");
  const [picked, setPicked] = React.useState(undefined);

  React.useEffect(() => {
    let live = true;
    import("../net/codex.ts")
      .then(m => m.loadCodex())
      .then(c => { if (live) setCodex(c); },
            e => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, []);

  const pool = React.useMemo(() => {
    if (!codex) return [];
    return codex.units.filter(u => (section === "structures" ? isStructure(u) : !isStructure(u)));
  }, [codex, section]);

  const shown = React.useMemo(
    () => sortUnits(filterUnits(pool, { search, factory, role }), sort),
    [pool, search, factory, role, sort]);

  /* Keep the selection inside what is on screen: filtering down to a factory
     that does not build the open unit should not leave its page up. */
  const current = shown.find(u => u.id === picked?.id) ?? shown[0];

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <EmptyState icon="alert-triangle" title="The Codex data could not be read." body={error} />
      </div>
    );
  }
  if (!codex) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={label}>Reading the Codex...</span>
      </div>
    );
  }

  /* The dataset ships with the launcher and the game updates on its own, so
     they drift. Saying which build the numbers are from is the honest form of
     that, and the banner only appears when they actually differ. */
  const stale = gameVersion && codex.game !== gameVersion;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ height: 44, flex: "0 0 auto", display: "flex", alignItems: "center",
        gap: "var(--sp-6)", padding: "0 var(--sp-6)", borderBottom: "1px solid var(--w-12)" }}>
        <span className="lab">CODEX</span>
        {SECTIONS.map(s => (
          <button key={s.id} type="button" onClick={() => { setSection(s.id); setPicked(undefined); }}
            style={{ appearance: "none", border: 0, background: "transparent", cursor: "pointer",
              padding: 0, font: `var(--w-${section === s.id ? "semibold" : "regular"}) var(--size-tiny)/1 var(--font-core)`,
              color: section === s.id ? "var(--text-hi)" : "var(--text-low)" }}>
            {s.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ ...label }}>Codex data {codex.game}</span>
      </div>

      {stale && (
        <div role="status" style={{ padding: "var(--sp-3) var(--sp-6)",
          background: "var(--surface-sunken)", boxShadow: "var(--rule-inset)",
          font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-body)" }}>
          These numbers are from {codex.game}. The game on the server is {gameVersion},
          so some of them may have moved.
        </div>
      )}

      {section === "modules" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <EmptyState icon="grid" title="Modules are not in the Codex yet."
            body="Commander modules live on the Zero-K website rather than in the game archive, so there is nothing here to read yet." />
        </div>
      )}

      {section === "changes" && <ChangesList codex={codex} onPick={u => { setSection(isStructure(u) ? "structures" : "units"); setPicked(u); }} />}

      {(section === "units" || section === "structures") && (
        <div style={{ flex: 1, display: "grid", minHeight: 0,
          gridTemplateColumns: "196px minmax(280px, 1fr) minmax(0, 1.35fr)" }}>

          <div style={{ borderRight: "1px solid var(--w-12)", background: "var(--surface-sunken)",
            padding: "var(--sp-5)", display: "flex", flexDirection: "column",
            gap: "var(--sp-6)", overflowY: "auto" }}>
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={section === "structures" ? "Search structures" : "Search units"} />

            {section === "units" && (
              <div>
                <div style={{ ...label, marginBottom: "var(--sp-3)" }}>Factory</div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <FilterRow name="All" active={!factory} onPick={() => setFactory(undefined)} />
                  {factories(pool).map(f => (
                    <FilterRow key={f} name={f} active={factory === f}
                      onPick={() => setFactory(factory === f ? undefined : f)} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <div style={{ ...label, marginBottom: "var(--sp-3)" }}>Role</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
                {roles(pool).map(r => (
                  <button key={r} type="button" onClick={() => setRole(role === r ? undefined : r)}
                    style={{ appearance: "none", cursor: "pointer",
                      border: "1px solid var(--w-12)", padding: "2px 6px",
                      background: role === r ? "var(--text-hi)" : "transparent",
                      color: role === r ? "var(--surface-base)" : "var(--text-low)",
                      font: "var(--w-regular) var(--size-micro)/1.3 var(--font-core)" }}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ ...label, marginBottom: "var(--sp-3)" }}>Sort</div>
              <Select value={sort} onChange={e => setSort(e.target.value)} options={SORTS} />
            </div>
          </div>

          <div style={{ borderRight: "1px solid var(--w-12)", display: "flex",
            flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 62px 58px 52px 74px",
              gap: "var(--sp-4)", padding: "var(--sp-3) var(--sp-5)",
              borderBottom: "1px solid var(--w-12)" }}>
              <span style={label}>{section === "structures" ? "Structure" : "Unit"}</span>
              <span style={label}>Cost</span><span style={label}>HP</span>
              <span style={label}>Spd</span><span style={label}>Role</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {shown.map(u => (
                <UnitRow key={u.id} unit={u} active={current?.id === u.id}
                  onPick={() => setPicked(u)} />
              ))}
              {!shown.length && (
                <div style={{ padding: "var(--sp-6)", ...label }}>Nothing matches that.</div>
              )}
            </div>
            <div style={{ borderTop: "1px solid var(--w-12)", padding: "var(--sp-3) var(--sp-5)" }}>
              <span style={label}>{shown.length} of {pool.length}</span>
            </div>
          </div>

          {current
            ? <UnitPage codex={codex} unit={current} />
            : <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={label}>Nothing selected</span>
              </div>}
        </div>
      )}
    </div>
  );
}

function FilterRow({ name, active, onPick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onPick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ appearance: "none", border: 0, textAlign: "left", cursor: "pointer",
        padding: "var(--sp-2) 0", boxShadow: "var(--rule-inset)",
        background: hover ? "var(--surface-hover)" : "transparent",
        font: `var(--w-${active ? "semibold" : "regular"}) var(--size-tiny)/1.3 var(--font-core)`,
        color: active ? "var(--text-hi)" : "var(--text-body)" }}>
      {name}
    </button>
  );
}
