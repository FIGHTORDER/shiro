import React from "react";
import { Dialog, Button, Select, Tag } from "../ds/shiro.js";
import { listAis, groupAis, variantLabel } from "../net/ais.ts";

/* Choosing an AI, rather than being given the one Shiro used to hardcode.
   Zero-K declares nine of its own and the engine brings more, and every one of
   them carries a line of its own prose - "Will burn your ass" is the difference
   between a picker and a dropdown of opaque strings, so the descriptions are
   shown rather than kept for a tooltip.

   What is deliberately not here is AI options. `UpdateBotStatus` carries four
   fields and none of them is an option dictionary, and the server writes an
   empty [Options] block for every bot - so CircuitAI's difficulty and the
   custom chickens' settings cannot be sent from a lobby at all. Offering them
   would be offering something that quietly does nothing. */

/* One AI, or one family of them. A button rather than a clickable div so it is
   reachable by keyboard and findable by name, and the family's variant picker
   sits beside the button rather than inside it - a <select> in a <button> is
   neither valid nor operable. */
function AiRow({ row, chosen, variant, onChoose, onVariant }) {
  const ai = row.kind === "one" ? row.ai : row.members.find(m => m.lib === variant) || row.members[0];
  const selected = chosen === ai.lib;
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: "var(--sp-3)",
      border: "1px solid " + (selected ? "var(--w-20)" : "var(--w-06)"),
      background: selected ? "var(--surface-hover)" : "transparent",
      transition: "var(--transition-hover)" }}>
      <button type="button" onClick={() => onChoose(ai.lib)}
        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
          alignItems: "flex-start", gap: "var(--sp-2)", padding: "var(--sp-4)",
          background: "transparent", border: 0, cursor: "pointer", textAlign: "left" }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-3)", maxWidth: "100%" }}>
          <span style={{ font: "var(--text-ui-sm)", color: "var(--text-hi)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.kind === "one" ? ai.name : row.label}
          </span>
          {/* Where it came from, because the two behave differently: a LuaAI
              runs inside the game, a skirmish AI is a library the engine
              loads. */}
          {ai.source === "engine" && <Tag>engine</Tag>}
        </span>
        <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
          color: "var(--text-low)" }}>
          {ai.desc || "No description."}
        </span>
      </button>
      {row.kind === "family" && (
        <Select size="sm" value={ai.lib} wrapStyle={{ justifyContent: "center", padding: "var(--sp-3)" }}
          onChange={e => { onVariant(row.label, e.target.value); onChoose(e.target.value); }}
          options={row.members.map(m => ({ value: m.lib, label: variantLabel(row.label, m) }))} />
      )}
    </div>
  );
}

export default function AddAiDialog({ ally, onClose, onAdd, engine, game, installRoot }) {
  const open = ally != null;
  const [list, setList] = React.useState({ ais: [], guessed: false });
  const [chosen, setChosen] = React.useState("");
  const [variants, setVariants] = React.useState({});

  /* Read on every open rather than once. An engine or the game itself can
     arrive between one room and the next - Shiro downloads them - and a list
     cached from before that would be missing whatever just landed. */
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setList({ ais: [], guessed: false });
    listAis(engine, game, installRoot).then(read => {
      if (!live) return;
      setList(read);
      /* The first entry is the game's own general-purpose AI - CAI, in
         Zero-K - so the old one-click behaviour stays one click. */
      setChosen(read.ais.length ? read.ais[0].lib : "");
      setVariants({});
    });
    return () => { live = false; };
  }, [open, engine, game, installRoot]);

  const rows = React.useMemo(() => groupAis(list.ais), [list.ais]);
  const add = () => {
    if (!chosen) return;
    onAdd(chosen, ally);
    onClose();
  };

  return (
    <Dialog open={open} title={"Add an AI to team " + (ally != null ? ally + 1 : "")} width={460}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!chosen} onClick={add}>Add AI</Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)",
          maxHeight: 340, overflowY: "auto" }}>
          {rows.map(row => (
            <AiRow key={row.kind === "one" ? row.ai.lib : row.label} row={row}
              chosen={chosen}
              variant={row.kind === "family" ? variants[row.label] : undefined}
              onChoose={setChosen}
              onVariant={(label, lib) => setVariants(v => ({ ...v, [label]: lib }))} />
          ))}
          {rows.length === 0 && (
            <span style={{ font: "var(--text-ui-sm)", color: "var(--text-low)" }}>
              Reading what this install can run.
            </span>
          )}
        </div>
        {/* Honest about being a guess - Shiro's built-in list, or a real
            reading of a game that is not the one this room is playing. The
            server does not check `AiLib`, so an AI named here but not
            installed starts an engine that fails at load rather than
            reporting anything. */}
        {(list.guessed || list.note) && (
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
            color: list.guessed ? "var(--text-mid)" : "var(--text-low)" }}>
            {list.guessed
              ? (list.note || "Shiro could not read this install, so this is its built-in list.")
              : list.note}
          </span>
        )}
      </div>
    </Dialog>
  );
}
