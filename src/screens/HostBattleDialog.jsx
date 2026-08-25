import React from "react";
import { Dialog, Button, Input, Select } from "../ds/shiro.js";
import { findMaps, gameModes } from "../net/zkcatalogue.ts";

/* Opening a room. `OpenBattle` takes a whole BattleHeader, but the server
   fills in most of it; these are the five fields a host actually chooses.
   Engine is not offered - it comes from Welcome, so the room runs what
   everyone else is running and is joinable by everyone else. */
const SIZES = ["2", "4", "6", "8", "12", "16", "24", "32"];

/* What kind of room this is. The wire calls it `Mode` and it is a number -
   restated here as literals for the same reason the stores do it: the runner
   strips types and cannot execute a TypeScript enum.

   Planetwars is deliberately absent. It is a real mode, but it belongs to the
   campaign rather than to anybody opening a room, and offering it here would
   host something the server will not run. */
const ROOM_TYPES = [
  { value: "6", label: "Teams" },
  { value: "3", label: "1v1" },
  { value: "4", label: "FFA" },
  { value: "5", label: "Cooperative" },
  { value: "0", label: "Custom" },
];

export default function HostBattleDialog({ open, onClose, onHost, defaultTitle, defaultMap, maps }) {
  const [title, setTitle] = React.useState("");
  const [map, setMap] = React.useState("");
  const [size, setSize] = React.useState("16");
  const [roomType, setRoomType] = React.useState("6");
  const [password, setPassword] = React.useState("");
  const [found, setFound] = React.useState([]);
  const [modes, setModes] = React.useState([]);
  const [modeName, setModeName] = React.useState("");

  /* Reset each time it opens: a dialog that remembers the last attempt is a
     dialog that hosts the wrong room when you reopen it by accident.

     The map starts empty rather than at `maps[0]`. That default was the whole
     of the "it only offers one arbitrary map" complaint - the suggestion list
     is whatever happens to be in an open battle right now, so off-peak it is
     one map, and pre-filling it made that one map look like the only choice. */
  React.useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle || "");
    /* Pre-filled when the dialog was opened from a map, so "host on this one"
       does not mean "type its name again". Cleared otherwise, because a map
       left over from last time is a room hosted somewhere nobody chose. */
    setMap(defaultMap || "");
    setRoomType("6");
    setSize("16");
    setPassword("");
    setFound([]);
    setModeName("");
  }, [open, defaultTitle, defaultMap]);

  /* Zero-K's featured custom modes, from the same service the map search and
     the downloader use. Fetched once per open; a mode list that fails to load
     just means the picker offers Zero-K only. */
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    gameModes().then(
      m => { if (live) setModes(m); },
      () => { if (live) setModes([]); },
    );
    return () => { live = false; };
  }, [open]);

  const mode = modes.find(m => m.shortName === modeName);

  /* Zero Wars is a map, not a game, so choosing it has to fill the map field.
     Left editable: it is a default, not a lock. */
  const chooseMode = shortName => {
    setModeName(shortName);
    const picked = modes.find(m => m.shortName === shortName);
    if (picked && picked.map) setMap(picked.map);
  };

  /* Search Zero-K's own catalogue as you type. The lobby protocol has no way to
     list maps, so without this the only names on offer are the handful the
     server has mentioned in open battles. Debounced, because this is a network
     round trip per keystroke otherwise. */
  React.useEffect(() => {
    const q = map.trim();
    if (!open || q.length < 3) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => {
      findMaps(q).then(
        hits => { if (live) setFound(hits); },
        () => { if (live) setFound([]); },   // offline is not worth an error here
      );
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [open, map]);

  /* What the catalogue found, then what is already in play. Deduped, and the
     search comes first because it is ranked - matchmaker maps at the top. */
  const suggestions = React.useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const name of [...found.map(f => f.name), ...(maps || [])]) {
      if (name && !seen.has(name)) { seen.add(name); out.push(name); }
    }
    return out.slice(0, 40);
  }, [found, maps]);

  const ready = title.trim() !== "" && map.trim() !== "";
  const submit = () => {
    if (!ready) return;
    onHost({
      title: title.trim(),
      map: map.trim(),
      maxPlayers: Number(size),
      mode: Number(roomType),
      password: password.trim(),
      // Only when the mode names one; otherwise the caller's default stands.
      game: mode && mode.game ? mode.game : undefined,
      options: mode ? mode.options : undefined,
    });
    onClose();
  };

  return (
    <Dialog open={open} title="Host a battle" width={440} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready} onClick={submit}>Open room</Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <Input label="Title" placeholder="Teams 8v8 - all welcome" value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} />
        {/* Free text with suggestions rather than a fixed list: a map nobody has
            played recently is still hostable, and Shiro can download it now. */}
        <Input label="Map" placeholder="Type to search" value={map} list="shiro-maps"
          onChange={e => setMap(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} />
        <datalist id="shiro-maps">
          {suggestions.map(m => <option key={m} value={m} />)}
        </datalist>
        {/* A mode may bring a game, a map, modoptions, or a combination -
            Zero Wars is a map on stock Zero-K and Tech-K is one modoption - so
            what this sets depends on the mode rather than being "the game". */}
        <Select label="Game" value={modeName} onChange={e => chooseMode(e.target.value)}
          options={[{ value: "", label: "Zero-K" },
            ...modes.map(m => ({ value: m.shortName, label: m.displayName }))]} />
        <Select label="Room type" value={roomType} onChange={e => setRoomType(e.target.value)}
          options={ROOM_TYPES} />
        <Select label="Player slots" value={size} onChange={e => setSize(e.target.value)} options={SIZES} />
        <Input label="Password" placeholder="Leave empty for an open room" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} />
      </div>
    </Dialog>
  );
}
