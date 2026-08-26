import React from "react";
import { Button, Badge, EmptyState, Icon, Switch } from "../ds/shiro.js";
import { ACTION, META, appState } from "./appState.ts";

/* Add-ons: the things Shiro can add to itself or to Zero-K, by kind.
 *
 * Six kinds, one rail. Only two of them have anything in them today - the four
 * apps that ship in the catalogue, and the skins that used to live in
 * Settings - and the rest say so plainly rather than being hidden until they
 * are ready.
 *
 * The catalogue still ships with Shiro; nothing here is fetched. See
 * docs/APPS.md for why entries arrive by pull request rather than over the
 * wire.
 *
 * The design problem is the states, not the list: an add-on can be built in,
 * installed, not installed, or unavailable because there is nothing published
 * yet, and the last of those has to look deliberate rather than broken. */

/* Kinds in rail order. Apps first because it is the one with a working
   catalogue; the empty ones keep their place so the shape of the section does
   not move as they fill up. */
const KINDS = [
  { id: "apps", icon: "package", label: "Apps" },
  { id: "skins", icon: "palette", label: "Shiro skins" },
  { id: "loadscreens", icon: "image", label: "Loading screens" },
  { id: "widgets", icon: "puzzle", label: "Widgets" },
  { id: "uiskins", icon: "monitor", label: "Game UI skins" },
  { id: "campaign", icon: "book-open", label: "Campaign" },
];

const label = {
  font: "var(--text-label)", letterSpacing: "var(--track-label)",
  textTransform: "uppercase", color: "var(--text-faint)",
};


function Row({ app, status, state, selected, onSelect, onAct, busy }) {
  const [hover, setHover] = React.useState(false);
  const shown = busy ? "installing" : state;
  const verb = ACTION[shown];
  const meta = META[shown]?.(app, status);

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: "var(--sp-5)",
        padding: "var(--sp-4) var(--sp-5)", minWidth: 0,
        background: selected ? "var(--surface-selected)"
          : hover ? "var(--surface-hover)" : "transparent",
        boxShadow: "var(--rule-inset)", transition: "var(--transition-hover)",
      }}>
      {selected && <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
        background: "var(--ink-000)" }} />}

      {/* The selectable part is a real button rather than a clickable div: this
          row is how somebody reaches an app, and a div is unreachable by
          keyboard. The action beside it is a sibling, because a button inside a
          button is invalid and the browser makes the inner one dead. */}
      <button type="button" onClick={onSelect}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center",
          gap: "var(--sp-5)", background: "transparent", border: 0, padding: 0,
          cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit" }}>
      <span style={{ width: 28, height: 28, flex: "0 0 auto", display: "inline-flex",
        alignItems: "center", justifyContent: "center", border: "1px solid var(--w-12)",
        color: "var(--text-mid)" }}>
        <Icon name="package" size={16} />
      </span>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ font: "var(--w-semibold) var(--size-base)/1.2 var(--font-core)",
          color: "var(--text-hi)", whiteSpace: "nowrap", overflow: "hidden",
          textOverflow: "ellipsis" }}>{app.name}</span>
        <span style={{ font: "var(--w-regular) var(--size-tiny)/1.35 var(--font-core)",
          color: "var(--text-low)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap" }}>{app.summary}</span>
      </div>

      <span style={{ width: 220, flex: "0 0 auto", textAlign: "right",
        font: "var(--w-regular) var(--size-tiny)/1.35 var(--font-mono)",
        color: shown === "unavailable" ? "var(--text-mid)" : "var(--text-low)",
        overflowWrap: "anywhere" }}>{meta}</span>
      </button>

      <span style={{ width: 120, flex: "0 0 auto", display: "flex", justifyContent: "flex-end" }}>
        {verb && (
          <Button size="sm" variant={shown === "installed" ? "primary" : "secondary"}
            onClick={() => onAct(app)}>{verb}</Button>
        )}
        {shown === "installing" && (
          <span style={{ font: "var(--text-label)", letterSpacing: "var(--track-label)",
            textTransform: "uppercase", color: "var(--text-faint)" }}>Installing</span>
        )}
        {/* Named, so the row says what is wrong rather than looking wrong. */}
        {shown === "unavailable" && <Badge tone="outline">Unavailable</Badge>}
      </span>
    </div>
  );
}


function KindRow({ kind, active, onPick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onPick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: "var(--sp-4)",
        width: "100%", padding: "var(--sp-4) var(--sp-5)", border: 0, cursor: "pointer",
        textAlign: "left", font: "var(--text-ui-sm)",
        color: active ? "var(--text-hi)" : "var(--text-mid)",
        background: active ? "var(--surface-selected)"
          : hover ? "var(--surface-hover)" : "transparent",
        transition: "var(--transition-hover)",
      }}>
      {active && <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
        background: "var(--ink-000)" }} />}
      <Icon name={kind.icon} size={15} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap" }}>{kind.label}</span>
    </button>
  );
}

/* The paper and ink each skin paints with, for the preview square only.
 *
 * Literal rather than `data-skin` on the swatch: Paper deliberately has no
 * block in skins.css - it is the base set in colors.css, and settings.ts
 * clears the attribute for it - so a swatch driven by the attribute would show
 * Paper as whatever skin is currently on. Two values each, and the preview is
 * the only thing that reads them. */
const SWATCH = {
  paper: { paper: "#ffffff", ink: "#0a0a0a" },
  vellum: { paper: "#faf7f0", ink: "#14100a" },
  graphite: { paper: "#0d0d0d", ink: "#ffffff" },
  slate: { paper: "#0b0e13", ink: "#f5f8fc" },
};

/* A skin is a set of colour tokens on <html>. Picking one is the whole
   interaction - there is nothing to download and nothing to confirm, which is
   why this row has no state machine and the app rows do. */
function SkinRow({ skin, active, onPick, onInstall }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: "var(--sp-5)",
        padding: "var(--sp-4) var(--sp-5)", minWidth: 0,
        background: hover ? "var(--surface-hover)" : "transparent",
        boxShadow: "var(--rule-inset)", transition: "var(--transition-hover)",
      }}>
      <button type="button" onClick={onPick}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center",
          gap: "var(--sp-5)", background: "transparent", border: 0, padding: 0,
          cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit" }}>
        <span aria-hidden="true"
          style={{ width: 28, height: 28, flex: "0 0 auto", display: "inline-flex",
            border: "1px solid var(--w-12)",
            background: (SWATCH[skin.id] || SWATCH.paper).paper }}>
          <span style={{ width: 14,
            background: (SWATCH[skin.id] || SWATCH.paper).ink }} />
        </span>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ font: "var(--w-semibold) var(--size-base)/1.2 var(--font-core)",
            color: "var(--text-hi)" }}>{skin.name}</span>
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.35 var(--font-core)",
            color: "var(--text-low)", overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap" }}>{skin.note}</span>
        </div>
      </button>
      {/* Three states, not two: a skin that ships is always usable, a
          downloaded one has to arrive first, and one with nothing published
          says so rather than offering a button that fails. */}
      {skin.unavailable
        ? <Badge tone="outline">{skin.unavailable}</Badge>
        : skin.needsInstall
          ? <Button variant="secondary" size="sm" disabled={skin.busy}
              onClick={onInstall}>{skin.busy ? "Getting..." : "Get"}</Button>
          : active
            ? <Badge tone="solid">In use</Badge>
            : <Button variant="secondary" size="sm" onClick={onPick}>Use</Button>}
    </div>
  );
}

/* One widget in the Zero-K install, with the switch that turns it on.

   The switch writes an entry into Zero-K's own ZK_order.lua, keyed on the name
   the widget declares rather than its filename - so the name shown here is the
   one the game uses, not the file it came from. */
function WidgetRow({ widget, busy, onToggle }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)",
        padding: "var(--sp-4) var(--sp-5)", minWidth: 0,
        background: hover ? "var(--surface-hover)" : "transparent",
        boxShadow: "var(--rule-inset)", transition: "var(--transition-hover)" }}>
      <button type="button" role="switch" aria-checked={widget.enabled}
        aria-label={widget.name} disabled={busy} onClick={onToggle}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center",
          gap: "var(--sp-5)", background: "transparent", border: 0, padding: 0,
          cursor: busy ? "wait" : "pointer", textAlign: "left", color: "inherit",
          font: "inherit" }}>
        <Switch checked={widget.enabled} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ font: "var(--w-semibold) var(--size-base)/1.2 var(--font-core)",
            color: widget.enabled ? "var(--text-hi)" : "var(--text-body)" }}>{widget.name}</span>
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.35 var(--font-core)",
            color: "var(--text-low)", overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap" }}>{widget.file}</span>
        </div>
      </button>
      {widget.ours && <Badge tone="outline">Shiro</Badge>}
    </div>
  );
}

/* The widgets Zero-K will load next time it starts.

   Read from the install rather than from a catalogue: widgets the player put
   there by hand are shown beside the ones Shiro installed, because a list that
   hid them would misrepresent what is going to run. */
function WidgetsPanel() {
  const [state, setState] = React.useState({ loading: true });
  const [busy, setBusy] = React.useState(undefined);

  const load = React.useCallback(async () => {
    try {
      const net = await import("../net/widgets.ts");
      const [widgets, localOn] = await Promise.all([net.widgetList(), net.localWidgetsOn()]);
      setState({ widgets, localOn });
    } catch (e) {
      setState({ error: String((e && e.message) || e) });
    }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const toggle = async w => {
    setBusy(w.name);
    try {
      const net = await import("../net/widgets.ts");
      await net.setWidgetEnabled(w.name, !w.enabled);
      await load();
    } catch (e) {
      setState(s => ({ ...s, error: String((e && e.message) || e) }));
    } finally {
      setBusy(undefined);
    }
  };

  if (state.loading) return <NotePanel body="Reading your Zero-K install..." />;
  /* A missing install is the ordinary case for somebody who has not run the
     game yet, not a fault, so it reads as a step rather than an error. */
  if (state.error) return <NotePanel icon="alert-triangle" title="Nothing to show yet." body={state.error} />;
  if (!state.widgets || state.widgets.length === 0) {
    return (
      <NotePanel title="No widgets installed."
        body={state.localOn
          ? "Widgets you install will appear here."
          : "Zero-K is not set to load local widgets yet. Installing one turns that on."} />
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {state.widgets.map(w => (
          <WidgetRow key={w.file} widget={w} busy={busy === w.name}
            onToggle={() => toggle(w)} />
        ))}
      </div>
      {/* Zero-K rewrites its own config at every start and on shutdown, so a
          change made while it is open is lost. Better said than discovered. */}
      <span style={{ padding: "var(--sp-4) var(--sp-5)", boxShadow: "var(--rule-inset)",
        font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
        Takes effect next time Zero-K starts. Close the game before changing these.
      </span>
    </div>
  );
}

/* A centred line of prose where a list would go. */
function NotePanel({ icon = "package", title, body }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      padding: "var(--sp-9)" }}>
      <EmptyState icon={icon} title={title} body={body} />
    </div>
  );
}

/* Every kind that has nothing in it yet. One sentence, and no controls: a
   disabled button here would imply something is coming that we can name. */
function NotYet() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      padding: "var(--sp-9)" }}>
      <EmptyState icon="package" title="Nothing here yet."
        body="Check back soon!" />
    </div>
  );
}

export default function AppsScreen({ apps = [], statuses = [], onLaunch, onInstall,
  onUninstall, installing, error, skins = [], skin, onSkin, onSkinInstall }) {
  const [kind, setKind] = React.useState("apps");
  const [sel, setSel] = React.useState(undefined);
  const [confirming, setConfirming] = React.useState(undefined);
  const byId = React.useMemo(
    () => Object.fromEntries(statuses.map(s => [s.id, s])), [statuses]);

  const current = apps.find(a => a.id === sel) || apps[0];
  const status = current ? byId[current.id] : undefined;
  const state = current ? appState(current, status) : undefined;

  const open = app => onLaunch?.(app.id);

  const active = KINDS.find(k => k.id === kind) || KINDS[0];
  /* The detail column belongs to the apps list. Nothing else has a detail view
     yet, and an empty 360px gutter beside "Nothing here yet" reads as a pane
     that failed to load. */
  const showDetail = kind === "apps" && apps.length > 0;
  const count = kind === "apps" ? apps.length : kind === "skins" ? skins.length : 0;

  return (
    <div style={{ flex: 1, display: "grid", minHeight: 0,
      gridTemplateColumns: showDetail ? "200px minmax(0,1fr) 360px" : "200px minmax(0,1fr)" }}>
      {/* The kinds. Every one is listed whether or not it has anything in it -
          a kind that appears only once it is populated makes the section look
          like it changed shape rather than filled up. */}
      <div style={{ borderRight: "1px solid var(--w-12)", background: "var(--surface-sunken)",
        display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
        <div style={{ height: 44, flex: "0 0 auto", display: "flex", alignItems: "center",
          padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab">ADD-ONS</span>
        </div>
        {KINDS.map(k => (
          <KindRow key={k.id} kind={k} active={k.id === kind}
            onPick={() => setKind(k.id)} />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ height: 44, flex: "0 0 auto", display: "flex", alignItems: "center",
          padding: "0 var(--sp-6)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab">{active.label}</span>
          <span style={{ flex: 1 }} />
          {count > 0 && <span style={label}>{count} available</span>}
        </div>

        {kind === "skins" && (
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {skins.map(sk => (
              <SkinRow key={sk.id} skin={sk} active={sk.id === skin}
                onPick={() => onSkin?.(sk.id)}
                onInstall={() => onSkinInstall?.(sk.id)} />
            ))}
          </div>
        )}

        {kind === "widgets" && <WidgetsPanel />}
        {kind !== "apps" && kind !== "skins" && kind !== "widgets" && <NotYet />}

        {kind === "apps" && apps.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <EmptyState icon="package" title="Apps need the desktop app."
              body="The launcher installs and runs programs, which a browser tab cannot do." />
          </div>
        )}

        {kind === "apps" && apps.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {apps.map(a => (
            <Row key={a.id} app={a} status={byId[a.id]}
              state={appState(a, byId[a.id])}
              selected={current && current.id === a.id}
              busy={installing === a.id}
              onSelect={() => setSel(a.id)}
              onAct={x => (["available", "update"].includes(appState(x, byId[x.id]))
                ? onInstall?.(x.id) : open(x))} />
          ))}
        </div>
        )}
      </div>

      {/* Detail, for the apps list only. */}
      {showDetail && (
      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        padding: "var(--sp-6)", display: "flex", flexDirection: "column",
        gap: "var(--sp-5)", overflowY: "auto" }}>
        {current && (
          <>
            <div>
              <span style={{ font: "var(--w-bold) var(--size-xl)/1.1 var(--font-core)",
                color: "var(--text-hi)" }}>{current.name}</span>
            </div>
            <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", lineHeight: 1.5 }}>
              {current.description}
            </span>

            {status?.path && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                <span style={label}>Installed at</span>
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                  color: "var(--text-low)", overflowWrap: "anywhere" }}>{status.path}</span>
              </div>
            )}

            {/* Greyed with the reason, rather than a button that fails. */}
            {state === "unavailable" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <span style={label}>Not available</span>
                <span style={{ font: "var(--text-ui-sm)", color: "var(--text-mid)" }}>
                  {current.unavailable}
                </span>
              </div>
            )}

            {error && (
              <span style={{ font: "var(--text-ui-sm)", color: "var(--signal-warn)" }}>
                {error}
              </span>
            )}

            <span style={{ flex: 1 }} />
            {state === "update" && (
              <Button variant="primary" size="lg" disabled={installing === current.id}
                onClick={() => onInstall?.(current.id)}>
                {installing === current.id ? "Updating…" : `Update to ${current.version}`}
              </Button>
            )}
            {(state === "installed" || state === "update") && (
              <Button variant={state === "update" ? "secondary" : "primary"} size="lg"
                onClick={() => open(current)}>Launch</Button>
            )}
            {state === "available" && (
              <Button variant="primary" size="lg" disabled={installing === current.id}
                onClick={() => onInstall?.(current.id)}>
                {installing === current.id ? "Installing…" : "Install"}
              </Button>
            )}
            {/* Uninstall is a quiet button rather than a hidden one. Anything a
                launcher installs it should be able to remove; leaving that to
                the file manager makes the app directory somebody else's
                problem. Confirmed first, because it is not undoable. */}
            {(state === "installed" || state === "update") && onUninstall && (
              confirming === current.id ? (
                <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center" }}>
                  <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", flex: 1 }}>
                    Remove {current.name}?
                  </span>
                  <Button variant="ghost" size="sm"
                    onClick={() => setConfirming(undefined)}>Cancel</Button>
                  <Button variant="secondary" size="sm"
                    onClick={() => { setConfirming(undefined); onUninstall(current.id); }}>
                    Remove
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm"
                  onClick={() => setConfirming(current.id)}>Uninstall</Button>
              )
            )}
          </>
        )}
      </div>
      )}
    </div>
  );
}
