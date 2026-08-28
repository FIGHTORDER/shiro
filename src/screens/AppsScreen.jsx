import React from "react";
import { Button, Badge, EmptyState, Icon, Switch, Input } from "../ds/shiro.js";
import { ACTION, META, appState } from "./appState.ts";
import { SWATCH } from "../store/settings.ts";

/* Add-ons: the things Shiro can add to itself or to Zero-K, by kind.
 *
 * Six kinds, one rail. Only two of them have anything in them today - the four
 * apps that ship in the catalogue, and the skins that used to live in
 * Settings - and the rest say so plainly rather than being hidden until they
 * are ready.
 *
 * The catalogue still ships with Shiro; nothing here is fetched. Entries
 * arrive by pull request rather than over the wire.
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

/* The in-game half of a Shiro skin.

   Shaped like SkinRow next door because it is the same idea one layer down,
   but it has the app rows' states rather than none: this one is downloaded
   into the Zero-K install, so it can be absent, arriving, or already there.
   The swatch is the matching Shiro skin's, since that is what it pairs with. */
function UiSkinRow({ skin, installed, installedVersion, busy, onInstall, onRemove }) {
  const [hover, setHover] = React.useState(false);
  const swatch = SWATCH[skin.matches] || SWATCH.slate;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: "var(--sp-5)",
        padding: "var(--sp-4) var(--sp-5)", minWidth: 0,
        background: hover ? "var(--surface-hover)" : "transparent",
        boxShadow: "var(--rule-inset)", transition: "var(--transition-hover)",
      }}>
      <span aria-hidden="true"
        style={{ width: 28, height: 28, flex: "0 0 auto", display: "inline-flex",
          border: "1px solid var(--w-12)", background: swatch.paper }}>
        <span style={{ width: 14, background: swatch.ink }} />
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ font: "var(--w-semibold) var(--size-base)/1.2 var(--font-core)",
          color: "var(--text-hi)" }}>{skin.name}</span>
        <span style={{ font: "var(--w-regular) var(--size-tiny)/1.35 var(--font-core)",
          color: "var(--text-low)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap" }}>{skin.summary}</span>
      </div>

      {/* The version is only worth the room once there is a copy on disk. */}
      {installed && installedVersion && (
        <span style={{ flex: "0 0 auto",
          font: "var(--w-regular) var(--size-tiny)/1.35 var(--font-mono)",
          color: "var(--text-low)" }}>{installedVersion}</span>
      )}

      {/* Nothing published means no button: an Install here would only fail,
          and the reason is better said than found out. */}
      {skin.unavailable
        ? <Badge tone="outline">{skin.unavailable}</Badge>
        : installed
          ? <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}
              aria-label={`Remove ${skin.name}`}>{busy ? "Removing..." : "Remove"}</Button>
          : <Button variant="secondary" size="sm" disabled={busy} onClick={onInstall}
              aria-label={`Install ${skin.name}`}>
              {busy ? "Installing..." : "Install"}
            </Button>}
    </div>
  );
}

/* Chili skins for Zero-K's own interface.

   Two sources, joined here: the catalogue ships with Shiro, and what is
   actually on disk is read from the Zero-K install. Selecting one afterwards
   is the game's business, which is the one thing this panel has to say out
   loud, so it says it once at the bottom rather than on every row. */
function UiSkinsPanel() {
  const [state, setState] = React.useState({ loading: true });
  const [busy, setBusy] = React.useState(undefined);
  /* An install or a removal that failed, kept apart from the list: losing the
     rows to report one row's problem would say something untrue. */
  const [failed, setFailed] = React.useState(undefined);

  const load = React.useCallback(async () => {
    try {
      const net = await import("../net/uiskins.ts");
      const [skins, statuses] = await Promise.all([
        net.uiSkinCatalogue(), net.uiSkinStatus()]);
      setState({ skins, statuses });
    } catch (e) {
      setState({ error: String((e && e.message) || e) });
    }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const act = async (skin, remove) => {
    setBusy(skin.id);
    setFailed(undefined);
    try {
      const net = await import("../net/uiskins.ts");
      if (remove) await net.removeUiSkin(skin.id);
      else await net.installUiSkin(skin.id);
      await load();
    } catch (e) {
      setFailed(String((e && e.message) || e));
    } finally {
      setBusy(undefined);
    }
  };

  if (state.loading) return <NotePanel body="Reading your Zero-K install..." />;
  if (state.error) {
    return <NotePanel icon="alert-triangle" title="Nothing to show yet." body={state.error} />;
  }
  /* Empty in a browser tab, where there is no install to put anything in. */
  if (!state.skins || state.skins.length === 0) {
    return (
      <NotePanel icon="monitor" title="Game UI skins need the desktop app."
        body="These are installed into your Zero-K files, which a browser tab cannot reach." />
    );
  }

  const statusOf = id => (state.statuses || []).find(s => s.id === id);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {failed && (
        <span style={{ padding: "var(--sp-4) var(--sp-5)", boxShadow: "var(--rule-inset)",
          font: "var(--w-regular) var(--size-tiny)/1.45 var(--font-core)",
          color: "var(--danger)" }}>{failed}</span>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {state.skins.map(sk => {
          const st = statusOf(sk.id);
          return (
            <UiSkinRow key={sk.id} skin={sk} installed={!!(st && st.installed)}
              installedVersion={st && st.installedVersion}
              busy={busy === sk.id}
              onInstall={() => act(sk, false)}
              onRemove={() => act(sk, true)} />
          );
        })}
      </div>
      <span style={{ padding: "var(--sp-4) var(--sp-5)", boxShadow: "var(--rule-inset)",
        font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
        These skin Zero-K itself, not Shiro. Installing one puts it in your Zero-K
        files; you pick it in Zero-K&apos;s own settings, and the game needs a LuaUI
        reload or a restart before the new one shows.
      </span>
    </div>
  );
}

/* One widget in the Zero-K install, with the switch that turns it on.

   The switch writes an entry into Zero-K's own ZK_order.lua, keyed on the name
   the widget declares rather than its filename - so the name shown here is the
   one the game uses, not the file it came from. */
function WidgetRow({ widget, busy, onToggle, onRemove }) {
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
      {/* Only what Shiro wrote. A widget the player copied in themselves is
          theirs to delete, and a button here would be reaching into a folder
          Shiro has no record of. */}
      {onRemove && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}
          aria-label={`Remove ${widget.name}`}>Remove</Button>
      )}
    </div>
  );
}

/* Asking before removing, and saying what "this" is.

   The unit is the add-on, not the file: a pack's widgets include each other,
   and taking one out of the middle leaves the rest calling something that is
   no longer there. So a Remove on any row removes the pack that row came from,
   and this says so with the count rather than letting it be a surprise. */
function ConfirmRemove({ widget, addon, busy, onCancel, onConfirm }) {
  const count = addon && addon.files.length ? addon.files.length : 1;
  const what = addon && addon.repo ? addon.repo : widget.name;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)",
      padding: "var(--sp-4) var(--sp-5)", boxShadow: "var(--rule-inset)",
      background: "var(--surface-hover)" }}>
      <span style={{ flex: 1, minWidth: 0,
        font: "var(--w-regular) var(--size-tiny)/1.45 var(--font-core)",
        color: "var(--text-body)" }}>
        Remove {what}?{" "}
        {count > 1
          ? `All ${count} of its files go, ${widget.name} among them.`
          : "Its file is deleted."}{" "}
        Anything it moved aside is put back.
      </span>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Keep</Button>
      <Button variant="secondary" size="sm" disabled={busy} onClick={onConfirm}>
        {busy ? "Removing..." : "Remove"}
      </Button>
    </div>
  );
}

/* Adding a pack from a repository.

   Two outcomes, and the difference matters enough to be the whole design of
   this panel. A pack of ordinary widgets installs with no decision to make. A
   pack that replaces Zero-K's own widgets is a different thing to agree to, so
   it is never installed without the number being said out loud first. */
function AddFromSource({ onInstalled }) {
  const [repo, setRepo] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState(undefined);
  const [error, setError] = React.useState(undefined);

  const look = async () => {
    setBusy(true); setError(undefined); setPreview(undefined);
    try {
      const net = await import("../net/widgets.ts");
      setPreview(await net.fetchAddon(repo));
    } catch (e) {
      setError(String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  const install = async mode => {
    setBusy(true); setError(undefined);
    try {
      const net = await import("../net/widgets.ts");
      await net.installWidgets(preview.id, mode);
      setPreview(undefined); setRepo("");
      onInstalled();
    } catch (e) {
      setError(String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  const blocked = preview && preview.refused.length > 0;
  const replaces = preview ? preview.replaces.length : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)",
      padding: "var(--sp-5)", boxShadow: "var(--rule-inset)" }}>
      <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input label="Add from GitHub" value={repo} icon="github"
            placeholder="Helwor/New-Hel-K"
            onChange={e => setRepo(e.target.value)}
            onKeyDown={e => e.key === "Enter" && repo.trim() && look()} />
        </div>
        <Button variant="secondary" size="sm" disabled={busy || !repo.trim()}
          onClick={look}>{busy ? "Looking..." : "Look"}</Button>
      </div>

      {error && (
        <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
          color: "var(--danger)" }}>{error}</span>
      )}

      {preview && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <span style={{ font: "var(--w-semibold) var(--size-base)/1.2 var(--font-core)",
            color: "var(--text-hi)" }}>{preview.repo}</span>
          {/* The build, named the way Git names it, so two installs of the
              same pack can be told apart. */}
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
            color: "var(--text-low)" }}>
            {preview.build.kind} {preview.build.label} · {preview.build.sha.slice(0, 7)}
            {preview.build.date ? " · " + preview.build.date.slice(0, 10) : ""}
            {" · "}{preview.files} files
          </span>

          {blocked && (
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.45 var(--font-core)",
              color: "var(--danger)" }}>
              Cannot install: {preview.refused.join("; ")}
            </span>
          )}

          {!blocked && replaces === 0 && (
            <Button size="sm" disabled={busy}
              onClick={() => install("namespaced")}>Install</Button>
          )}

          {!blocked && replaces > 0 && (
            <>
              {/* Said plainly and before the button, because this is the part
                  somebody has to actually agree to.

                  The second sentence used to stop at Zero-K's own copies, which
                  is the easy half: those live in the game archive and are never
                  touched. A widget the player copied in by hand sits at the same
                  path the pack writes to, and it is only restorable because the
                  install now moves it aside first. Said here because the promise
                  is what somebody is agreeing to. */}
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.45 var(--font-core)",
                color: "var(--text-body)" }}>
                This replaces {replaces} of Zero-K&apos;s own widgets, including{" "}
                {preview.replaces.slice(0, 3).join(", ")}
                {replaces > 3 ? " and " + (replaces - 3) + " more" : ""}. Zero-K&apos;s
                copies are not changed, and any widget you already had at one of
                those names is kept beside it as .shiro-backup, so removing this
                pack puts both back.
              </span>
              <Button variant="secondary" size="sm" disabled={busy}
                onClick={() => install("replace")}>
                Replace {replaces} widgets and install
              </Button>
            </>
          )}
        </div>
      )}
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
  /* Which row is asking. Cleared on every reload, so a removal that took the
     row away cannot leave the question behind it. */
  const [confirm, setConfirm] = React.useState(undefined);
  /* A toggle or a removal that failed, kept apart from the error that means
     the list could not be read at all. Zero-K refuses both while it is running,
     which is the ordinary way to hit this, and reporting it by replacing the
     whole panel with "nothing to show" would say something untrue. */
  const [failed, setFailed] = React.useState(undefined);

  const load = React.useCallback(async () => {
    try {
      const net = await import("../net/widgets.ts");
      const [widgets, localOn, addons] = await Promise.all([
        net.widgetList(), net.localWidgetsOn(), net.widgetAddons()]);
      setState({ widgets, localOn, addons });
    } catch (e) {
      setState({ error: String((e && e.message) || e) });
    }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const addonOf = w => (state.addons || []).find(a => a.id === w.addon);

  const remove = async w => {
    setBusy(w.name);
    setFailed(undefined);
    try {
      const net = await import("../net/widgets.ts");
      await net.removeWidgets(w.addon);
      setConfirm(undefined);
      await load();
    } catch (e) {
      setFailed(String((e && e.message) || e));
    } finally {
      setBusy(undefined);
    }
  };

  const toggle = async w => {
    setBusy(w.name);
    setFailed(undefined);
    try {
      const net = await import("../net/widgets.ts");
      await net.setWidgetEnabled(w.name, !w.enabled);
      await load();
    } catch (e) {
      setFailed(String((e && e.message) || e));
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
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <AddFromSource onInstalled={load} />
        <NotePanel title="No widgets installed."
          body={state.localOn
            ? "Widgets you install will appear here."
            : "Zero-K is not set to load local widgets yet. Installing one turns that on."} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <AddFromSource onInstalled={load} />
      {failed && (
        <span style={{ padding: "var(--sp-4) var(--sp-5)", boxShadow: "var(--rule-inset)",
          font: "var(--w-regular) var(--size-tiny)/1.45 var(--font-core)",
          color: "var(--danger)" }}>{failed}</span>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {state.widgets.map(w => (
          confirm === w.file ? (
            <ConfirmRemove key={w.file} widget={w} addon={addonOf(w)}
              busy={busy === w.name} onCancel={() => setConfirm(undefined)}
              onConfirm={() => remove(w)} />
          ) : (
            <WidgetRow key={w.file} widget={w} busy={busy === w.name}
              onToggle={() => toggle(w)}
              onRemove={w.addon ? () => setConfirm(w.file) : undefined} />
          )
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
        {kind === "uiskins" && <UiSkinsPanel />}
        {!["apps", "skins", "widgets", "uiskins"].includes(kind) && <NotYet />}

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
