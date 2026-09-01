import React from "react";
import {
  Badge, Button, Checkbox, EmptyState, Icon, IconButton, Input, MapImage, Select, Tag,
} from "../ds/shiro.js";
import {
  engineMismatch, listReplays, outcomeFor, rowFromArchive, rowFromReplay, rowMode,
  rowRating, searchReplays, sides, sortReplays, versus, watchReplay,
} from "../net/replays.ts";
import { downloadReplay, lookupPlayers, searchBattles } from "../net/zkbattles.ts";

/* Replays - built to the wireframe, against two sources that are deliberately
   not merged.
 *
 * The demos folder holds what this machine played. zero-k.info holds every game
 * since 2011. They share no key: an archive row and a local file could only be
 * matched by guessing from the map, the length and a printed local time, and a
 * guess that is wrong sometimes is worse than no guess at all.
 *
 * So "only replays on this machine" switches the source rather than filtering a
 * merged list. That also settles what each row can show: a local row is parsed,
 * so it knows its teams, ratings and who won; an archive row knows what the
 * list page printed until somebody opens it. */

const label = {
  font: "var(--w-regular) var(--size-micro)/1 var(--font-core)",
  letterSpacing: "var(--track-label)",
  textTransform: "uppercase",
  color: "var(--text-faint)",
};

const mono = {
  font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-body)",
};

const MODES = [
  { value: "", label: "All modes" },
  { value: "Teams", label: "Teams" },
  { value: "1v1", label: "1v1" },
  { value: "FFA", label: "FFA" },
  { value: "Cooperative", label: "Cooperative" },
];

/* The site's own age options, and only those. It offers no arbitrary range, so
   neither does this - a date picker with nothing behind it would filter one
   page of forty and silently misreport the other thousand. */
const AGES = [
  { value: "0", label: "Any time" },
  { value: "1", label: "Today" },
  { value: "2", label: "This week" },
  { value: "3", label: "This month" },
];

const SORTS = [
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "longest", label: "Longest first" },
  { value: "shortest", label: "Shortest first" },
];

const clock = seconds => {
  if (seconds === undefined || seconds === null) return "-";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const day = row => {
  if (row.playedText) return row.playedText.split(" ")[0] ?? row.playedText;
  if (!row.playedAt) return "-";
  return new Date(row.playedAt * 1000).toISOString().slice(0, 10);
};

const outcomeTone = outcome =>
  outcome === "won" ? "var(--signal-ok)"
    : outcome === "lost" ? "var(--signal-danger)"
      : "var(--text-faint)";

/* One row. 44px as drawn, with the map picture the site and the client both
   already have, so the list is scanned by shape rather than read. */
function ReplayRow({ row, me, active, onPick, onWatch }) {
  const [hover, setHover] = React.useState(false);
  const mode = rowMode(row);
  const rating = rowRating(row);
  const outcome = row.replay ? outcomeFor(row.replay, me) : undefined;
  const teams = row.replay ? versus(row.replay, me) : undefined;
  return (
    <div onClick={onPick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: "var(--sp-5)",
        padding: "0 var(--sp-5)", height: 44, cursor: "pointer",
        borderBottom: "1px solid var(--w-06)",
        borderLeft: `2px solid ${active ? "var(--text-hi)" : outcome && outcome !== "undecided"
          ? outcomeTone(outcome) : "transparent"}`,
        background: active ? "var(--surface-selected)" : hover ? "var(--w-06)" : "transparent",
        transition: "var(--transition-hover)",
      }}>
      <div style={{ width: 64, height: 36, flex: "0 0 auto", overflow: "hidden",
        background: "var(--ink-000)" }}>
        <MapImage map={row.map ?? ""} kind="thumbnail" ratio="16/9" />
      </div>

      <div style={{ width: 150, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ font: "var(--w-semibold) var(--size-tiny)/1.2 var(--font-core)",
          color: "var(--text-hi)", whiteSpace: "nowrap", overflow: "hidden",
          textOverflow: "ellipsis" }}>{row.map ?? "Unknown map"}</span>
        <span style={{ font: "var(--w-regular) var(--size-micro)/1 var(--font-mono)",
          color: "var(--text-faint)", whiteSpace: "nowrap", overflow: "hidden",
          textOverflow: "ellipsis" }}>{row.engine ? `engine ${row.engine}` : (row.game ?? "")}</span>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center",
        gap: "var(--sp-4)", font: "var(--w-regular) var(--size-tiny)/1.2 var(--font-core)",
        color: "var(--text-body)" }}>
        {teams ? (
          <>
            <span style={{ flex: 1, minWidth: 0, textAlign: "right", whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis" }}>{teams.a}</span>
            <span style={{ ...label, color: "var(--text-faint)" }}>vs</span>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden",
              textOverflow: "ellipsis" }}>{teams.b}</span>
          </>
        ) : (
          /* The archive's list page names nobody. Saying so is better than an
             empty column that reads as a game with no players in it. */
          <span style={{ ...label }}>Players listed once downloaded</span>
        )}
      </div>

      <span style={{ width: 72, textAlign: "right",
        font: "var(--w-regular) var(--size-tiny)/1 var(--font-core)",
        color: "var(--text-mid)" }}>{mode ?? ""}</span>
      <span style={{ ...mono, width: 44, textAlign: "right" }}>{row.players ?? "-"}</span>
      <span style={{ ...mono, width: 56, textAlign: "right" }}>{rating ?? "-"}</span>
      <span style={{ ...mono, width: 56, textAlign: "right" }}>{clock(row.duration)}</span>
      <span style={{ width: 88, textAlign: "right",
        font: "var(--w-regular) var(--size-tiny)/1 var(--font-mono)",
        color: "var(--text-low)", fontVariantNumeric: "tabular-nums" }}>{day(row)}</span>
      <div style={{ width: 78, display: "flex", justifyContent: "flex-end" }}>
        {hover && row.path && (
          <Button variant="primary" size="sm" icon="play"
            onClick={e => { e.stopPropagation(); onWatch(row); }}>Watch</Button>
        )}
      </div>
    </div>
  );
}

/* The panel. Everything per-team reads from the parsed replay, so an archive
   row that has not been opened says what it needs rather than showing blanks. */
function Detail({ row, me, onWatch, onDownload, downloading, installedEngine, problem }) {
  if (!row) return <EmptyState icon="play" title="Nothing selected." />;
  const replay = row.replay;
  const mode = rowMode(row);
  const rating = rowRating(row);
  const facts = [
    ["Played", row.playedText ?? (row.playedAt
      ? new Date(row.playedAt * 1000).toISOString().replace("T", " ").slice(0, 16) : "-")],
    ["Avg rating", rating ?? "-"],
    ["Engine", row.engine ?? "-"],
    ["Size", row.replay ? `${(row.replay.bytes / 1024 / 1024).toFixed(1)} MB` : "-"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <MapImage map={row.map ?? ""} kind="minimap" ratio="1" caption link saturate={1} />

      <div style={{ padding: "var(--sp-5)", display: "flex", flexDirection: "column",
        gap: "var(--sp-5)", borderBottom: "1px solid var(--w-06)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
          {mode && <Badge tone="outline">{mode}</Badge>}
          {row.players !== undefined && <Badge mono>{row.players} players</Badge>}
          <Badge mono>{clock(row.duration)}</Badge>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr",
          gap: "var(--sp-3) var(--sp-5)" }}>
          {facts.map(([k, v]) => (
            <React.Fragment key={k}>
              <span style={label}>{k}</span>
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.3 var(--font-mono)",
                color: "var(--text-body)" }}>{v}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-5)",
        display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
        {replay ? sides(replay).map(side => {
          const won = replay.winners.includes(side.ally);
          return (
            <div key={side.ally} style={{ display: "flex", flexDirection: "column",
              gap: "var(--sp-4)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                <span style={label}>Team {side.ally + 1}</span>
                <span style={{ flex: 1 }} />
                {replay.winners.length > 0 && (
                  <span style={{ ...label, color: won ? "var(--signal-ok)" : "var(--text-faint)" }}>
                    {won ? "Won" : "Lost"}
                  </span>
                )}
              </div>
              {side.players.map(p => (
                <div key={p.name} style={{ display: "flex", alignItems: "center",
                  gap: "var(--sp-4)", height: 26, borderBottom: "1px solid var(--w-04)" }}>
                  <span style={{ flex: 1, minWidth: 0,
                    font: "var(--w-regular) var(--size-tiny)/1 var(--font-core)",
                    color: "var(--text-hi)", whiteSpace: "nowrap", overflow: "hidden",
                    textOverflow: "ellipsis" }}>{p.name}</span>
                  {p.clan && <span style={{ ...label }}>{p.clan}</span>}
                  <span style={{ font: "var(--w-regular) var(--size-tiny)/1 var(--font-mono)",
                    color: "var(--text-low)", fontVariantNumeric: "tabular-nums" }}>
                    {p.elo ?? ""}
                  </span>
                </div>
              ))}
            </div>
          );
        }) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)",
            alignItems: "center", padding: "var(--sp-6) 0" }}>
            <EmptyState icon="download"
              title="Teams are in the replay itself."
              body="The archive's list does not name players. Fetch this replay to see who played, their ratings and who won." />
            <Button variant="secondary" size="sm" icon="download"
              disabled={downloading} onClick={() => onDownload(row)}>
              {downloading ? "Fetching" : "Fetch replay"}
            </Button>
          </div>
        )}
      </div>

      <div style={{ padding: "var(--sp-5)", borderTop: "1px solid var(--w-12)",
        display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
        {/* Said before the button rather than after it fails: a demo only plays
            on the build it was recorded on, so this is the difference between
            watching it and a launch that goes nowhere. */}
        {row.replay && engineMismatch(row.replay, installedEngine) && (
          <div style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-4)",
            background: "var(--w-04)", border: "1px solid var(--w-12)",
            borderLeft: "2px solid var(--signal-warn)" }}>
            <Icon name="alert-triangle" size={14} />
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.45 var(--font-core)",
              color: "var(--text-body)" }}>
              Recorded on engine {row.engine}. This machine has {installedEngine}, and a
              replay only plays on its own build.
            </span>
          </div>
        )}
        {problem && (
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
            color: "var(--signal-danger)" }}>{problem}</span>
        )}
        {row.path && (
          <Button variant="primary" size="lg" icon="play" onClick={() => onWatch(row)}>
            Watch replay
          </Button>
        )}
        {row.battleId && (
          <a href={`https://zero-k.info/Battles/Detail/${row.battleId}`}
            target="_blank" rel="noreferrer"
            style={{ ...label, color: "var(--text-low)", textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
            Match page on zero-k.info ↗
          </a>
        )}
      </div>
    </div>
  );
}

function ReplaysView({
  rows = [], me, loading, note, more, source, onSource, onWatch,
  query, onQuery, mode, onMode, age, onAge, mineOnly, onMine, sort, onSort, onMore,
  installedEngine, problem, onDownload, downloading, who, unknownName,
}) {
  const [selected, setSelected] = React.useState(undefined);
  const current = rows.find(r => r.key === selected) ?? rows[0];

  const chips = [
    /* The account, not the text typed: the archive filters on ids, and knowing
       which person was matched is the difference between a filter and a
       mystery. */
    query && { key: "q", label: who ? who.name : query, clear: () => onQuery("") },
    mode && { key: "m", label: mode, clear: () => onMode("") },
    age && age !== "0" && {
      key: "a", label: AGES.find(a => a.value === age)?.label ?? "", clear: () => onAge("0"),
    },
    mineOnly && { key: "i", label: "Mine", clear: () => onMine(false) },
  ].filter(Boolean);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid",
      gridTemplateColumns: "232px minmax(0,1fr) 372px" }}>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)",
        padding: "var(--sp-5)", borderRight: "1px solid var(--w-12)",
        background: "var(--surface-sunken)", overflowY: "auto" }}>
        <Input label="Player" placeholder="Name in either team" icon="search"
          value={query} onChange={e => onQuery(e.target.value)} />
        <Select label="Mode" value={mode} onChange={e => onMode(e.target.value)} options={MODES} />
        <Select label="When" value={age} onChange={e => onAge(e.target.value)} options={AGES} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <Checkbox label="Only matches I played in" checked={mineOnly}
            onChange={e => onMine(e.target.checked)} />
          {/* Not a filter over a merged list - it chooses which of the two
              sources the list is. See the note at the top of this file. */}
          <Checkbox label="Only replays on this machine" checked={source === "local"}
            onChange={e => onSource(e.target.checked ? "local" : "archive")} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div style={{ height: 38, flex: "0 0 auto", display: "flex", alignItems: "center",
          gap: "var(--sp-5)", padding: "0 var(--sp-5)",
          borderBottom: "1px solid var(--w-12)" }}>
          <span style={{ font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
            color: "var(--text-mid)", fontVariantNumeric: "tabular-nums" }}>
            {/* "shown", never a total: the archive reports no count, and a
                number that looks like one would be a number we made up. */}
            {rows.length} shown
          </span>
          <div style={{ display: "flex", gap: "var(--sp-3)", minWidth: 0, overflow: "hidden" }}>
            {chips.map(c => <Tag key={c.key} onRemove={c.clear}>{c.label}</Tag>)}
          </div>
          <span style={{ flex: 1 }} />
          <span style={label}>Sort</span>
          <Select size="sm" value={sort} onChange={e => onSort(e.target.value)} options={SORTS} />
        </div>

        <div style={{ height: 26, flex: "0 0 auto", display: "flex", alignItems: "center",
          gap: "var(--sp-5)", padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-12)",
          background: "var(--surface-sunken)" }}>
          <span style={{ ...label, width: 64 }}>Map</span>
          <span style={{ ...label, width: 150 }}>Replay</span>
          <span style={{ ...label, flex: 1, minWidth: 0 }}>Teams</span>
          <span style={{ ...label, width: 72, textAlign: "right" }}>Mode</span>
          <span style={{ ...label, width: 44, textAlign: "right" }}>Pl</span>
          <span style={{ ...label, width: 56, textAlign: "right" }}>Rating</span>
          <span style={{ ...label, width: 56, textAlign: "right" }}>Length</span>
          <span style={{ ...label, width: 88, textAlign: "right" }}>Date</span>
          <span style={{ width: 78 }} />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {note ? (
            <EmptyState icon="wifi-off" title="The replay archive is unreachable."
              body={`${note} Replays already on this machine can still be searched - tick "only replays on this machine".`} />
          ) : rows.length === 0 && !loading ? (
            <EmptyState icon="search"
              title={unknownName ? `Nobody on zero-k.info is called "${query}".`
                : "No replays match these filters."}
              body={unknownName
                ? "The archive is searched by account, so a name it does not know narrows to nothing."
                : source === "local"
                  ? "This machine has no replay matching that. Untick \"only replays on this machine\" to search the archive."
                  : "Widen the date range, or clear the player."} />
          ) : (
            <>
              {rows.map(row => (
                <ReplayRow key={row.key} row={row} me={me}
                  active={current && row.key === current.key}
                  onPick={() => setSelected(row.key)} onWatch={onWatch} />
              ))}
              {loading && (
                <div style={{ height: 44, display: "flex", alignItems: "center",
                  justifyContent: "center", gap: "var(--sp-4)", color: "var(--text-low)" }}>
                  <Icon name="loader" size={14} />
                  <span style={label}>Loading</span>
                </div>
              )}
              {more && !loading && (
                <div style={{ padding: "var(--sp-5)", display: "flex", justifyContent: "center" }}>
                  <Button variant="secondary" size="sm" onClick={onMore}>Load more</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Detail row={current} me={me} onWatch={onWatch} onDownload={onDownload}
          downloading={Boolean(current) && downloading === current.key}
          installedEngine={installedEngine} problem={problem} />
      </div>
    </div>
  );
}


/**
 * The screen, with its own data.
 *
 * Two sources, loaded differently on purpose. The local one is a single read of
 * the demos folder that is then searched in memory - it is a few hundred rows
 * and every filter is exact. The archive is a request per page, and only the
 * filters the site's own form offers are sent, because anything else would
 * narrow one page of forty and say nothing true about the rest.
 */
export default function Replays({ me, installRoot }) {
  const [source, setSource] = React.useState("local");
  const [query, setQuery] = React.useState("");
  const [mode, setMode] = React.useState("");
  const [age, setAge] = React.useState("0");
  const [mineOnly, setMineOnly] = React.useState(false);
  const [sort, setSort] = React.useState("recent");

  const [local, setLocal] = React.useState([]);
  const [localNote, setLocalNote] = React.useState(undefined);
  const [archive, setArchive] = React.useState([]);
  const [archiveNote, setArchiveNote] = React.useState(undefined);
  const [more, setMore] = React.useState(false);
  const [offset, setOffset] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [installedEngine, setInstalledEngine] = React.useState(undefined);
  const [problem, setProblem] = React.useState(undefined);
  const [downloading, setDownloading] = React.useState(undefined);
  /* Who the typed name resolved to, and my own account. Both are ids the
     archive filters on; neither is needed for the local source. */
  const [who, setWho] = React.useState(undefined);
  const [myId, setMyId] = React.useState(undefined);
  const [unknownName, setUnknownName] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    listReplays(installRoot).then(list => {
      if (!live) return;
      setLocal(list.replays.map(rowFromReplay));
      setLocalNote(list.note);
      setInstalledEngine(list.engine);
    });
    return () => { live = false; };
  }, [installRoot]);

  /* My own account, once, and only when something needs it. */
  React.useEffect(() => {
    if (!me || !mineOnly || source !== "archive" || myId) return;
    let live = true;
    lookupPlayers(me).then(found => {
      const exact = found.find(p => p.name.toLowerCase() === me.toLowerCase());
      if (live && exact) setMyId(exact.id);
    });
    return () => { live = false; };
  }, [me, mineOnly, source, myId]);

  /* The typed name, resolved to an account before it can filter anything.
     Debounced: this is somebody else's server and the field is typed into. */
  React.useEffect(() => {
    if (source !== "archive") { setWho(undefined); setUnknownName(false); return undefined; }
    if (!query.trim()) { setWho(undefined); setUnknownName(false); return undefined; }
    let live = true;
    const timer = setTimeout(() => {
      lookupPlayers(query).then(found => {
        if (!live) return;
        const exact = found.find(p => p.name.toLowerCase() === query.trim().toLowerCase());
        const pick = exact ?? found[0];
        setWho(pick);
        /* A name nobody has is not a reason to show every battle ever played.
           Without this the field silently stopped filtering. */
        setUnknownName(!pick);
      });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [source, query]);

  /* Debounced, because this is somebody else's server and the player field is
     typed into. Every keystroke is not a search. */
  React.useEffect(() => {
    if (source !== "archive") return undefined;
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      /* Ids, not the typed text. The archive filters on accounts, and several
         are ANDed - so "me" plus a name is the games we both played. */
      const players = [who?.id, mineOnly ? myId : undefined].filter(Boolean);
      searchBattles({ age: Number(age) || 0, players: players.length ? players : undefined,
        offset: 0 })
        .then(page => {
          if (!live) return;
          setArchive(page.battles.map(rowFromArchive));
          setArchiveNote(page.note);
          setMore(page.more);
          setOffset(page.offset);
          setLoading(false);
        });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [source, age, who, mineOnly, myId]);

  const loadMore = React.useCallback(() => {
    setLoading(true);
    const players = [who?.id, mineOnly ? myId : undefined].filter(Boolean);
    searchBattles({ age: Number(age) || 0, players: players.length ? players : undefined,
      offset: offset + 40 })
      .then(page => {
        setArchive(rows => [...rows, ...page.battles.map(rowFromArchive)]);
        setMore(page.more);
        setOffset(page.offset);
        setLoading(false);
      });
  }, [age, who, mineOnly, myId, offset]);

  const rows = React.useMemo(() => {
    const base = source === "local" ? local : archive;
    if (source === "archive" && unknownName) return [];
    let out = base;
    if (source === "local") {
      /* The local search is the real one: the whole folder is in memory, so a
         filter is exact rather than a narrowing of whatever page arrived. */
      const found = searchReplays(out.map(r => r.replay), query, me);
      const keep = new Set(found.map(r => r.path));
      out = out.filter(r => keep.has(r.path));
      if (mineOnly && me) {
        out = out.filter(r => outcomeFor(r.replay, me) !== "watched");
      }
    }
    if (mode) out = out.filter(r => rowMode(r) === mode);
    if (source !== "local") return out;
    const sorted = sortReplays(out.map(r => r.replay), sort);
    const order = new Map(sorted.map((r, i) => [r.path, i]));
    return [...out].sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0));
  }, [source, local, archive, query, mode, mineOnly, me, sort, unknownName]);

  return (
    <ReplaysView
      rows={rows} me={me} loading={loading}
      note={source === "archive" ? archiveNote : localNote}
      more={source === "archive" && more} source={source} onSource={setSource}
      onWatch={row => {
        setProblem(undefined);
        /* The replay's own engine, not the newest installed - see watchReplay.
           A refusal comes back as a sentence and is shown beside the button
           rather than thrown away. */
        watchReplay(row.path, row.engine).then(setProblem);
      }}
      installedEngine={installedEngine} problem={problem} downloading={downloading}
      who={source === "archive" ? who : undefined} unknownName={unknownName}
      onDownload={row => {
        setProblem(undefined);
        setDownloading(row.key);
        downloadReplay(row.battleId, installRoot).then(({ replay, error }) => {
          setDownloading(undefined);
          if (error) { setProblem(error); return; }
          /* The row becomes a full one in place. The file is in the demos
             folder now, so it also belongs in the local list - added here
             rather than by reading the whole folder again. */
          setArchive(rows => rows.map(r => (r.key === row.key
            ? { ...r, replay, path: replay.path, engine: replay.engine,
                playedAt: replay.playedAt, players: replay.players.filter(p => !p.spectator).length }
            : r)));
          setLocal(rows => (rows.some(r => r.path === replay.path)
            ? rows : [rowFromReplay(replay), ...rows]));
        });
      }}
      query={query} onQuery={setQuery} mode={mode} onMode={setMode}
      age={age} onAge={setAge} mineOnly={mineOnly} onMine={setMineOnly}
      sort={sort} onSort={setSort} onMore={loadMore} />
  );
}
