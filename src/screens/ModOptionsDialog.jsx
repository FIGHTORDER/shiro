import React from "react";
import { Dialog, Button, Input, Select, Checkbox, Tabs, Tooltip } from "../ds/shiro.js";
import {
  sections, defaultFor, defaults, encode, merge, resetToDefaults,
} from "../net/modOptions.ts";

/* The room's game options, laid out the way Zero-K's own client lays them out:
   one tab per section in the order the game declares them, and one row per
   option with its name on the left and its control on the right. The control
   vocabulary is upstream's too - a tickbox, a dropdown, a number field, a text
   field - because it is the whole vocabulary the option table needs.

   Two things here are not upstream's, and both are in src/net/modOptions.ts
   rather than in this file: what we send is the room's dictionary with our
   edits laid over it, never just our edits, and reset leaves alone the keys the
   server set for itself. `SetModOptions` replaces the room's options wholesale,
   so anything we leave out is gone. */

const ROW = {
  display: "flex", alignItems: "center", gap: "var(--sp-4)",
  minHeight: 32, padding: "var(--sp-2) 0",
};

/** One option. The control it gets is decided by the option's own type. */
function OptionRow({ option, value, onChange }) {
  const set = raw => {
    const next = encode(option, raw);
    // undefined means it could not be made into a valid value - keep the old.
    if (next !== undefined) onChange(option.key, next);
  };

  const changed = value !== defaultFor(option);

  const control = (() => {
    switch (option.kind) {
      case "bool":
        return (
          <Checkbox aria-label={option.name} checked={value === "1"}
            onChange={e => set(e.target.checked)} />
        );
      case "list":
        return (
          <Select size="sm" aria-label={option.name} value={value} onChange={e => set(e.target.value)}
            options={option.items.map(i => ({ value: i.key, label: i.name }))}
            wrapStyle={{ width: 180 }} />
        );
      case "number":
        return <NumberField option={option} value={value} onCommit={set} />;
      default:
        return (
          <Input aria-label={option.name} value={value}
            onChange={e => onChange(option.key, e.target.value)}
            wrapStyle={{ width: 180 }} />
        );
    }
  })();

  return (
    <div style={ROW}>
      <Tooltip label={option.desc || option.key} side="top">
        <span style={{
          font: "var(--text-ui-sm)",
          color: changed ? "var(--text-body)" : "var(--text-mid)",
          /* The host's own changes stand out from the ninety that are still
             whatever the game says, which is the question being asked of this
             screen: what did somebody touch. */
          fontWeight: changed ? "var(--w-medium)" : undefined,
        }}>
          {option.name}
        </span>
      </Tooltip>
      <div style={{ flex: 1 }} />
      <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "flex-end" }}>
        {control}
      </div>
    </div>
  );
}

/* Numbers are typed, not dragged - upstream's control is an edit box despite
   the comment above it saying slider. It clamps and rounds when you leave the
   field rather than while you type, so a half-typed "1" on the way to "150"
   does not get snapped to the minimum under your hands. */
function NumberField({ option, value, onCommit }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => { setText(value); }, [value]);

  const commit = () => {
    const next = encode(option, text);
    if (next === undefined) setText(value);      // not a number: put it back
    else { setText(next); onCommit(next); }
  };

  return (
    <Input aria-label={option.name} value={text} wrapStyle={{ width: 180 }}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }} />
  );
}

export default function ModOptionsDialog({ open, current, onClose, onApply }) {
  const groups = React.useMemo(() => sections(), []);
  const [tab, setTab] = React.useState(groups[0]?.section.key);
  const [edits, setEdits] = React.useState({});

  /* Seeded from the room each time it opens, the way upstream seeds its working
     copy: what is on screen is what the room actually has, including anything
     set by the server or by a custom game mode. */
  React.useEffect(() => {
    if (!open) return;
    setEdits({});
    setTab(groups[0]?.section.key);
  }, [open, groups]);

  const values = React.useMemo(
    () => ({ ...defaults(), ...(current || {}), ...edits }),
    [current, edits],
  );

  const change = (key, value) => setEdits(e => ({ ...e, [key]: value }));

  const group = groups.find(g => g.section.key === tab) || groups[0];
  const dirty = Object.keys(edits).length > 0;

  const apply = () => {
    onApply(merge(current || {}, edits));
    onClose();
  };

  /* Reset does not send. It fills the form with the defaults so you can see
     what you are about to do, and Apply is still the thing that commits it. */
  const reset = () => {
    const after = resetToDefaults(current || {});
    const next = {};
    for (const g of groups) {
      for (const o of g.options) {
        if (after[o.key] === undefined) next[o.key] = defaultFor(o);
      }
    }
    setEdits(next);
  };

  const countFor = g => g.options.filter(o => values[o.key] !== defaultFor(o)).length;

  return (
    <Dialog open={open} title="Game options" width={720} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={reset}>Reset to defaults</Button>
        <div style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!dirty} onClick={apply}>Apply</Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* One tab per section, in the game's own order - which puts the
            commonly-used options first and the chicken ones last. The count is
            of options changed away from their default, so a room's oddities are
            findable without opening all seven. */}
        <Tabs value={group?.section.key} onChange={setTab}
          items={groups.map(g => ({
            id: g.section.key,
            label: g.section.name,
            unread: countFor(g) || undefined,
          }))} />
        <div style={{ height: 360, overflowY: "auto", paddingTop: "var(--sp-4)" }}>
          {group?.options.map(o => (
            <OptionRow key={o.key} option={o} value={values[o.key]} onChange={change} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}
