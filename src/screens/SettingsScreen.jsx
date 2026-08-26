import React from "react";
import { Button, Input, Select, Checkbox, Badge, Icon, IconButton, Meter } from "../ds/shiro.js";
import {
  ENGINE_FIELDS, readEngineSettings, writeEngineSettings,
  loadGameSettings, saveGameSettings,
} from "../net/engineSettings.ts";
import { applyPreset, resolveRef, changedSettingNames } from "../net/gameSettings.ts";
import { SETTINGS_TABS } from "../protocol/settings.ts";

/* Screen 9 was deferred in the handoff, so this is built from the same
   primitives rather than a design. It covers the three things that actually
   need to be settable - who you are, where Zero-K is, and which server - plus
   the content policy, because "why can I not download a map" is otherwise a
   support question with no answer in the app. */
function Section({ title, children, hint }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)",
      padding: "var(--sp-7) var(--sp-8)", borderBottom: "1px solid var(--w-06)" }}>
      {title && <span className="lab">{title}</span>}
      {hint && (
        <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
          {hint}
        </span>
      )}
      {children}
    </div>
  );
}

/* Status, hints and errors all read the same size; only the colour changes. */
function Note({ children, tone }) {
  return (
    <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
      color: tone === "danger" ? "var(--signal-danger)" : "var(--text-low)" }}>
      {children}
    </span>
  );
}

/* Where add-on apps live.

   Empty means Shiro's own data directory, the same convention the Zero-K path
   above uses: a cleared box is "wherever you would have put it", not a path of
   its own. Changing it re-reads the folder, so apps already sitting there are
   found rather than being downloaded again. */
function AppsRootRow({ appsRoot, onSettings }) {
  const [path, setPath] = React.useState(appsRoot ?? "");
  React.useEffect(() => { setPath(appsRoot ?? ""); }, [appsRoot]);
  const dirty = (path.trim() || undefined) !== appsRoot;
  return (
    <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-end" }}>
      <Input label="Add-on folder" placeholder="Leave empty to keep them with Shiro"
        value={path} onChange={e => setPath(e.target.value)}
        wrapStyle={{ flex: 1 }} size="sm" />
      <Button variant="quiet" size="sm" disabled={!dirty}
        onClick={() => onSettings && onSettings({ appsRoot: path.trim() || undefined })}>
        Apply
      </Button>
    </div>
  );
}

/* Putting the game's UI back to how it ships.

   Deliberately here rather than in Add-ons: the reason to reach for it is that
   a widget pack has broken the game badly enough that its own widget list
   cannot be opened, and hunting through an add-on screen for the fix is the
   wrong thing to ask of somebody in that state.

   Two steps rather than one. The button does something irreversible-looking to
   a directory of files, so it says what it will do and waits to be told again. */
function WidgetReset() {
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(undefined);
  const [error, setError] = React.useState(undefined);

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const net = await import("../net/widgets.ts");
      setDone(await net.resetWidgets());
      setAsking(false);
    } catch (e) {
      setError(String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <>
        <Note>
          {done.movedTo
            ? "Moved " + done.widgets + " widget" + (done.widgets === 1 ? "" : "s")
              + " aside into LuaUI/" + done.movedTo + "."
            : "There were no local widgets to move."}
          {done.orderReset ? " The widget list was reset." : ""}
          {done.localWidgetsOff ? " Local widgets are now off." : ""}
        </Note>
        <Note>Start Zero-K to see the change. Nothing was deleted.</Note>
      </>
    );
  }

  return (
    <>
      {!asking && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
            Reset in-game widgets
          </Button>
        </div>
      )}
      {asking && (
        <>
          <Note tone="danger">
            This moves every local widget out of Zero-K&apos;s LuaUI folder, clears the
            widget list, and turns local widgets off. Zero-K&apos;s own interface is not
            touched.
          </Note>
          <Note>
            Nothing is deleted: the folder is renamed and the settings files are copied
            to .bak first, so it can be undone by hand.
          </Note>
          <div style={{ display: "flex", gap: "var(--sp-4)" }}>
            <Button variant="danger" size="sm" disabled={busy} onClick={run}>
              {busy ? "Resetting..." : "Reset them"}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy}
              onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        </>
      )}
      {error && <Note tone="danger">{error}</Note>}
    </>
  );
}

/**
 * A labelled fact.
 *
 * `wide` stacks the value under the label instead of beside it. A filesystem
 * path in a 120px-label grid has about two thirds of the panel to wrap into,
 * and `overflowWrap: anywhere` breaks it at whatever character happens to land
 * on the edge - so a path arrives as a ragged three-line block that reads as a
 * layout fault rather than as an address. Given the whole width it usually
 * fits on one line, and when it does not it breaks in fewer places.
 */
/* Words that ring a conversation the way your own name does.
 *
 * Comma separated, committed when the field is left or Enter is pressed
 * rather than on every keystroke - typing "teams, tour" would otherwise spend
 * a moment with a rule for "t" in it, and ring on anything.
 *
 * The blur handler sits on the wrapper because `Input` spreads its extra props
 * over its own, and an `onBlur` passed straight in would replace the one
 * drawing its focus ring. */
function HighlightWords({ settings, onSettings }) {
  const saved = (settings && settings.highlights) || [];
  const asText = saved.join(", ");
  const [text, setText] = React.useState(asText);

  React.useEffect(() => { setText(asText); }, [asText]);

  const commit = () => {
    const seen = new Set();
    const words = [];
    for (const raw of text.split(",")) {
      const word = raw.trim();
      if (!word || seen.has(word.toLowerCase())) continue;
      seen.add(word.toLowerCase());
      words.push(word);
    }
    setText(words.join(", "));
    const same = words.length === saved.length
      && words.every((w, i) => w === saved[i]);
    if (onSettings && !same) {
      onSettings({ highlights: words });
    }
  };

  return (
    <div onBlur={commit}>
      <Input label="Other words I want notifications for"
        placeholder="teams, tourney, my clan tag"
        hint="Separated by commas."
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
    </div>
  );
}

function Row({ label, value, wide }) {
  const text = (
    <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)", color: "var(--text-body)",
      overflowWrap: "anywhere" }}>{value}</span>
  );
  if (wide) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <span className="lab">{label}</span>
        {text}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "var(--sp-5)", alignItems: "baseline" }}>
      <span className="lab">{label}</span>
      {text}
    </div>
  );
}

/**
 * The update control, and everything it can be doing.
 *
 * Restarting is a separate press from installing: an update that closes the app
 * while you are in a game is worse than one that waits, and the plugin will not
 * apply the new build until the process ends anyway.
 */
function UpdateRow({ state, onCheck, onInstall, onRestart }) {
  const kind = state?.kind ?? "idle";
  const line = {
    idle: "",
    checking: "Checking…",
    current: "Up to date",
    available: state?.kind === "available" ? `Version ${state.update.version} is available` : "",
    downloading: state?.kind === "downloading"
      ? (state.percent == null ? "Downloading…" : `Downloading… ${state.percent}%`)
      : "",
    ready: state?.kind === "ready" ? `Version ${state.update.version} installs on restart` : "",
    failed: state?.kind === "failed" ? `Could not check: ${state.why}` : "",
  }[kind];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "var(--sp-5)",
      alignItems: "center" }}>
      <span className="lab">Updates</span>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        {kind === "available" && (
          <Button size="sm" variant="primary" onClick={onInstall}>Install update</Button>
        )}
        {kind === "ready" && (
          <Button size="sm" variant="primary" onClick={onRestart}>Restart now</Button>
        )}
        {kind !== "available" && kind !== "ready" && (
          <Button size="sm" variant="secondary" onClick={onCheck}
            disabled={kind === "checking" || kind === "downloading"}>
            Check for updates
          </Button>
        )}
        {line && (
          <span style={{ font: "var(--text-ui-sm)",
            color: kind === "failed" ? "var(--text-faint)" : "var(--text-body)" }}>
            {line}
          </span>
        )}
      </div>
    </div>
  );
}

/* Zero-K's own settings menu, ported.
 *
 * These are the game's settings, not the lobby's: the engine reads them out of
 * the Zero-K data dir when a match starts, and until Shiro wrote them a game
 * booted with whatever the last client left behind - most visibly at the wrong
 * interface scale.
 *
 * The menu itself is generated from upstream (src/protocol/settings.ts) so the
 * options, their groupings and the values behind them are the official
 * client's, not a re-interpretation. Three rules hold the whole thing together:
 *
 *   - It opens showing what the files on disk actually say, worked out by
 *     running the menu backwards. Anything that matches no option is labelled
 *     Custom rather than shown as a default it is not set to.
 *   - Apply writes only what changed, so a Custom setting - or any of the ~110
 *     keys this menu does not model - is never rewritten.
 *   - Presets set the same settings upstream's do, and are just a shortcut for
 *     moving several dropdowns at once; nothing is written until Apply.
 */
function GameSettingsSection({ installRoot, disabled }) {
  const [loaded, setLoaded] = React.useState(null);   // what disk said
  const [chosen, setChosen] = React.useState(null);   // what the user has picked
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [tab, setTab] = React.useState(SETTINGS_TABS[0].name);

  React.useEffect(() => {
    let live = true;
    setLoaded(null);
    loadGameSettings(installRoot).then(
      l => { if (live) { setLoaded(l); setChosen(l.chosen); } },
      e => { if (live) setError(String(e)); },
    );
    return () => { live = false; };
  }, [installRoot]);

  const dirty = loaded && chosen
    ? changedSettingNames(loaded.chosen, chosen)
    : [];

  const save = async () => {
    setStatus("");
    setError("");
    try {
      await saveGameSettings(loaded.chosen, chosen, loaded.env, installRoot);
      // The new baseline: what we just wrote is now what disk says.
      setLoaded({ ...loaded, chosen });
      setStatus("Written. Takes effect the next time a game starts.");
    } catch (e) {
      setError(String(e));
    }
  };

  if (error && !loaded) {
    return (
      <Section title="In-game settings">
        <Note tone="danger">{error}</Note>
      </Section>
    );
  }
  if (!loaded || !chosen) {
    return (
      <Section title="In-game settings">
        <Note>Reading the Zero-K settings...</Note>
      </Section>
    );
  }

  const active = SETTINGS_TABS.find(t => t.name === tab) || SETTINGS_TABS[0];

  return (
    <Section title="In-game settings">
      <div style={{ display: "flex", gap: "var(--sp-3)" }}>
        {SETTINGS_TABS.map(t => (
          <Button key={t.name} size="sm" variant={t.name === tab ? "quiet" : "ghost"}
            onClick={() => setTab(t.name)}>{t.name}</Button>
        ))}
      </div>

      {/* Upstream's presets. They move several settings at once and are worth
          nothing until Apply, same as any other change here. */}
      {active.presets.length > 0 && (
        <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
          <span className="lab">Preset</span>
          {active.presets.map(p => (
            <Button key={p.name} size="sm" variant="ghost" disabled={disabled}
              onClick={() => setChosen(c => applyPreset(c, p, loaded.env))}>{p.name}</Button>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-5)" }}>
        {active.settings.map(setting => (
          <SettingControl key={setting.name} setting={setting} disabled={disabled}
            env={loaded.env} value={chosen[setting.name]}
            custom={loaded.custom.includes(setting.name)
              && chosen[setting.name] === loaded.chosen[setting.name]}
            onChange={v => setChosen(c => ({ ...c, [setting.name]: v }))} />
        ))}
      </div>

      <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="quiet" size="sm" onClick={save}
          disabled={disabled || dirty.length === 0}>Apply</Button>
        <Button variant="ghost" size="sm" disabled={disabled || dirty.length === 0}
          onClick={() => setChosen(loaded.chosen)}>Revert</Button>
        {dirty.length > 0 && <Note>{dirty.length} changed</Note>}
        {status && <Note>{status}</Note>}
        {error && <Note tone="danger">{error}</Note>}
      </div>
    </Section>
  );
}

/** One dropdown or number box, under the name the official client gives it. */
function SettingControl({ setting, value, onChange, disabled, env, custom }) {
  if (setting.kind === "unsupported") return null;

  if (setting.kind === "number") {
    const bound = b => (b && typeof b === "object" ? resolveRef(b.ref, env) : b);
    const min = bound(setting.min);
    const max = bound(setting.max);
    return (
      <Input label={setting.humanName} size="sm" type="number" disabled={disabled}
        min={min != null ? Math.round(min) : undefined}
        max={max != null ? Math.round(max) : undefined}
        value={value != null ? String(value) : ""}
        onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
    );
  }

  const options = (setting.options || []).map(o => o.name);
  return (
    <Select label={custom ? `${setting.humanName} (custom)` : setting.humanName}
      size="sm" disabled={disabled}
      // A value the file produced but no option carries would otherwise select
      // the first entry silently, which is a lie about what the game is set to.
      options={custom ? ["Custom", ...options] : options}
      value={custom ? "Custom" : (value != null ? String(value) : "")}
      onChange={e => onChange(e.target.value)} />
  );
}

/* The engine keys Zero-K's menu has no control for. Resolution is upstream's
   "Display Mode", which also drives Chobby's own window and so has no Shiro
   equivalent; the keys behind it are still worth reaching. */
function EngineSection({ installRoot, disabled }) {
  const [values, setValues] = React.useState(null);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");

  React.useEffect(() => {
    let live = true;
    readEngineSettings(installRoot)
      .then(s => { if (live) setValues(s); })
      .catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [installRoot]);

  const save = async () => {
    setStatus("");
    setError("");
    const changes = {};
    for (const f of ENGINE_FIELDS) {
      const v = (values && values[f.key]) || "";
      if (v !== "") changes[f.key] = String(v);
    }
    try {
      await writeEngineSettings(changes, installRoot);
      setStatus("Written to springsettings.cfg.");
    } catch (e) {
      setError(String(e));
    }
  };

  if (error && !values) {
    return <Section title="Advanced"><Note tone="danger">{error}</Note></Section>;
  }

  return (
    <Section title="Advanced">
      {values === null ? (
        <Note>Reading springsettings.cfg...</Note>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-5)" }}>
            {ENGINE_FIELDS.map(f => (
              <Input key={f.key} label={f.label} size="sm" type="number"
                min={f.min} max={f.max} disabled={disabled}
                value={values[f.key] != null ? values[f.key] : ""}
                onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
            ))}
          </div>
          <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center" }}>
            <Button variant="quiet" size="sm" onClick={save} disabled={disabled}>Apply</Button>
            {status && <Note>{status}</Note>}
            {error && <Note tone="danger">{error}</Note>}
          </div>
        </>
      )}
    </Section>
  );
}

/**
 * Zero-K, installed by Shiro rather than found.
 *
 * Offered when there is no installation, and available afterwards for anyone
 * who would rather Shiro kept its own. The engine is a 45 MB download from
 * Zero-K's own server with `pr-downloader` inside it, so one fetch turns an
 * empty folder into something that can pull the game and every map after it.
 *
 * Nothing here runs by itself. This is gigabytes, and it starts because
 * somebody pressed the button.
 */
function ManagedInstallSection({ engine, managed, onPrepare, onRemove, busy, progress, error,
  loadScreen, onLoadScreen }) {
  if (!managed) return null;
  const pct = progress && progress.total
    ? Math.round((progress.received / progress.total) * 100)
    : undefined;

  return (
    <Section title="Managed install">
      <Row label="Directory" value={managed.root} wide />
      {managed.prepared && (
        <Row label="Archives installed" value={String(managed.archives)} />
      )}
      {engine && (
        <Row label="Engine" value={managed.engineInstalled ? `${engine} - installed` : engine} />
      )}

      {busy && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>
            {pct === undefined ? "Downloading the engine…" : `Downloading the engine - ${pct}%`}
          </span>
          <Meter value={pct ?? 0} />
        </div>
      )}
      {error && (
        <span style={{ font: "var(--text-ui-sm)", color: "var(--signal-warn)" }}>{error}</span>
      )}

      {/* Only for an install Shiro made. Zero-K's own loading screen looks in
          the data directory before its archive, so this is a file placed there
          rather than a patched game - the checksum the server checks is
          untouched. Off puts the original back. */}
      {managed.prepared && onLoadScreen && (
        <Checkbox label="Use Shiro's loading screen"
          hint="On by default."
          checked={Boolean(loadScreen)}
          onChange={e => onLoadScreen(e.target.checked)} />
      )}

      <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center" }}>
        <Button variant="primary" size="sm" disabled={busy || !engine}
          onClick={onPrepare}>
          {managed.engineInstalled ? "Check for engine updates" : "Set up an install here"}
        </Button>
        {managed.prepared && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}>Remove it</Button>
        )}
        {!engine && (
          <span style={{ font: "var(--text-ui-sm)", color: "var(--text-low)" }}>
            Log in first - the server names the engine version to install.
          </span>
        )}
      </div>
    </Section>
  );
}

export default function SettingsScreen({ me, install, installError, engine, settings, onSettings,
  onRedetect, onLogout, onPreview, away, onAway, version = "0.1.0", update, managed }) {
  const [host, setHost] = React.useState((settings && settings.host) || "");
  const [port, setPort] = React.useState((settings && settings.port) ? String(settings.port) : "");
  const [root, setRoot] = React.useState((settings && settings.installRoot) || "");
  const [saved, setSaved] = React.useState("");
  const [preview, setPreview] = React.useState(null);
  const [previewError, setPreviewError] = React.useState("");

  const runPreview = async () => {
    setPreview(null);
    setPreviewError("");
    try {
      setPreview(await onPreview());
    } catch (e) {
      setPreviewError(e && e.message ? e.message : String(e));
    }
  };

  const applyServer = () => {
    if (!onSettings) return;
    const trimmed = host.trim();
    const n = Number(port);
    onSettings({
      host: trimmed || undefined,
      // An unparseable port is not a port; fall back to the default rather
      // than sending NaN at the socket.
      port: Number.isFinite(n) && n > 0 ? n : undefined,
    });
    setSaved("Applies on the next login.");
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ maxWidth: 720 }}>
        <Section title="Account">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)" }}>
            <span style={{ font: "var(--text-heading)", color: "var(--text-hi)" }}>{me || "Not logged in"}</span>
            {settings && settings.remember && <Badge tone="outline">Password saved</Badge>}
          </div>
          {onAway && (
            <Checkbox label="Away" checked={Boolean(away)}
              onChange={e => onAway(e.target.checked)} />
          )}
          <div style={{ display: "flex", gap: "var(--sp-4)" }}>
            {settings && settings.remember && onSettings && (
              <Button variant="secondary" size="sm"
                onClick={() => onSettings({ password: undefined, remember: false })}>
                Forget saved password
              </Button>
            )}
            {onLogout && <Button variant="danger" size="sm" onClick={onLogout}>Log out</Button>}
          </div>
        </Section>

        <Section title="Zero-K installation">
          {install ? (
            <>
              <Row label="Found via" value={install.source} />
              <Row label="Path" value={install.root} />
              {engine && <Row label="Engine wanted" value={engine} />}
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-4)" }}>
              <Icon name="alert-triangle" size={16} style={{ color: "var(--signal-warn)", marginTop: 2 }} />
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", whiteSpace: "pre-wrap" }}>
                {/* The detector says where it looked, which is the whole
                    difference between "broken" and "it is on my D: drive". */}
                {installError || "No installation found. Games cannot be launched until there is one."}
              </span>
            </div>
          )}
          <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-end" }}>
            <Input label="Override path" placeholder="Leave empty to detect automatically"
              value={root} onChange={e => setRoot(e.target.value)} wrapStyle={{ flex: 1 }} size="sm" />
            <Button variant="quiet" size="sm"
              onClick={() => { if (onSettings) onSettings({ installRoot: root.trim() || undefined });
                if (onRedetect) onRedetect(); }}>Apply</Button>
            {onRedetect && <Button variant="ghost" size="sm" onClick={onRedetect}>Re-detect</Button>}
          </div>
          {onPreview && (
            <>
              <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center" }}>
                <Button variant="secondary" size="sm" onClick={runPreview}>Check launch setup</Button>
              </div>
              {previewError && (
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-mono)",
                  color: "var(--signal-danger)", whiteSpace: "pre-wrap" }}>{previewError}</span>
              )}
              {preview && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)",
                  padding: "var(--sp-5)", background: "var(--surface-sunken)", border: "1px solid var(--w-06)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                    <Icon name="check" size={16} style={{ color: "var(--text-mid)" }} />
                    <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>
                      Ready to launch.
                    </span>
                  </div>
                  <Row label="Engine" value={preview.exe} />
                  <Row label="Working dir" value={preview.cwd} />
                  <Row label="Data dir" value={(preview.env.find(e => e[0] === "SPRING_DATADIR") || [])[1] || "-"} />
                  <Row label="Script" value={preview.scriptPath} />
                </div>
              )}
            </>
          )}
        </Section>

        <ManagedInstallSection engine={engine} managed={managed && managed.state}
          loadScreen={managed && managed.loadScreen}
          onLoadScreen={managed && managed.onLoadScreen}
          busy={managed && managed.busy} progress={managed && managed.progress}
          error={managed && managed.error}
          onPrepare={managed && managed.onPrepare}
          onRemove={managed && managed.onRemove} />

        <Section title="Server">
          <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-end" }}>
            <Input label="Host" placeholder="zero-k.info" value={host} size="sm"
              onChange={e => setHost(e.target.value)} wrapStyle={{ flex: 1 }} />
            <Input label="Port" placeholder="8200" value={port} size="sm"
              onChange={e => setPort(e.target.value)} wrapStyle={{ width: 100 }} />
            <Button variant="quiet" size="sm" onClick={applyServer}>Apply</Button>
          </div>
          {saved && (
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
              {saved}
            </span>
          )}
        </Section>

        {/* Everything here is something waiting on an answer, which is the
            whole bar for being allowed to interrupt somebody. The window is
            flagged as well as notified, and neither is offered as a switch:
            a flash is what you see with Shiro behind another window, a
            notification is what reaches you with it minimised, and turning off
            the half that happens to work for you is not a useful control. */}
        <Section title="Notification settings">
          <Checkbox label="A match is found and wants a ready check"
            checked={Boolean(settings && settings.notifyReadyCheck)}
            onChange={e => onSettings && onSettings({ notifyReadyCheck: e.target.checked })} />
          <Checkbox label="Somebody invites me to a party"
            checked={Boolean(settings && settings.notifyPartyInvite)}
            onChange={e => onSettings && onSettings({ notifyPartyInvite: e.target.checked })} />
          <Checkbox label="Somebody messages me, says my name, or uses one of my words"
            checked={Boolean(settings && settings.notifyMention)}
            onChange={e => onSettings && onSettings({ notifyMention: e.target.checked })} />
          <Checkbox label="My game starts"
            checked={Boolean(settings && settings.notifyBattleStart)}
            onChange={e => onSettings && onSettings({ notifyBattleStart: e.target.checked })} />
          <HighlightWords settings={settings} onSettings={onSettings} />
        </Section>

        <Section title="Post game settings">
          <Checkbox label="Open the results screen when a match ends"
            checked={Boolean(settings && settings.autoOpenDebriefing)}
            onChange={e => onSettings && onSettings({ autoOpenDebriefing: e.target.checked })} />
        </Section>

        <GameSettingsSection installRoot={settings && settings.installRoot} disabled={!install} />

        <EngineSection installRoot={settings && settings.installRoot} disabled={!install} />

        {/* Beside the Zero-K path rather than in Add-ons: it is the same kind
            of answer - where something lives on this machine - and somebody
            looking for one will look for the other in the same place. */}
        <Section>
          <AppsRootRow appsRoot={settings.appsRoot} onSettings={onSettings} />
        </Section>

        <Section title="In-game widgets">
          <WidgetReset />
        </Section>

        <Section title="Content">
          <a href="https://zero-k.info" target="_blank" rel="noreferrer"
            style={{ font: "var(--text-ui-sm)", color: "var(--text-hi)" }}>zero-k.info &#8599;</a>
        </Section>

        <Section title="About">
          <Row label="Version" value={version} />
          <Row label="Design system" value="Shiro 0f4b7d9c" />
          {update && <UpdateRow state={update.state} onCheck={update.check}
            onInstall={update.install} onRestart={update.restart} />}
        </Section>
      </div>
    </div>
  );
}
