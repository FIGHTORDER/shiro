import React from "react";
import { Button, Meter, UserChip, EmptyState, Input, IconButton, Switch, Badge } from "../ds/shiro.js";
import { groupQueues } from "../store/matchmaker";

/* Screen 6 - matchmaker queue. The ready-check itself is a Dialog rendered by
   App as a shell overlay, because it can interrupt any screen.

   With no `queues` prop this renders the demo set from the click-through. The
   names and descriptions below are the server's own, because the shape of the
   real list - a duel, a dozen sizes of team game, and coop - is the thing this
   screen has to survive. */
export const QUEUES = [
  { id: "1v1", label: "1v1", waiting: 6, ingame: 2,
    description: "Play 1v1 with an opponent of similar skill.", maxParty: 1 },
  { id: "1v1 Narrow", label: "1v1 Narrow", waiting: 2, ingame: 0,
    description: "Play 1v1 with a closely matched opponent.", maxParty: 1 },
  { id: "1v1 Wide", label: "1v1 Wide", waiting: 0, ingame: 0,
    description: "Play 1v1 with a potentially not-so-closely matched opponent.", maxParty: 1 },
  { id: "Sortie", label: "Sortie", waiting: 9, ingame: 4,
    description: "Play 2v2 or 3v3 with players of similar skill.", maxParty: 3 },
  { id: "Sortie Wide", label: "Sortie Wide", waiting: 4, ingame: 0,
    description: "Play 2v2 or 3v3 with anyone.", maxParty: 3 },
  { id: "2v2+", label: "2v2+", waiting: 5, ingame: 0,
    description: "Play a casual 2v2 or larger with anyone.", maxParty: 6 },
  { id: "Battle", label: "Battle", waiting: 21, ingame: 14,
    description: "Play 4v4, 5v5 or 6v6 with players of similar skill.", maxParty: 6 },
  { id: "Coop", label: "Coop", waiting: 3, ingame: 1,
    description: "Play together, against AI or chickens.", maxParty: 5 },
];

/** mm:ss since an ISO-8601 instant. */
function elapsed(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

const NUM = { font: "var(--w-medium) var(--size-small)/1 var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const NOTE = { font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)" };

/* Waiting and in game, and a zero of either recedes. Most of the sidebar's
   queues are empty at any given hour, and a column of bold zeros pulls the eye
   to exactly the rows worth skipping. */
function Counts({ waiting, ingame, aligned }) {
  const n = (v, ink, width) => (
    <span style={{ ...NUM, width, textAlign: width ? "right" : undefined,
      color: v > 0 ? ink : "var(--text-faint)" }}>{v}</span>
  );
  return (
    <>
      <span className="lab">WAITING</span>
      {n(waiting, "var(--text-hi)", aligned ? 34 : undefined)}
      <span className="lab">IN GAME</span>
      {n(ingame, "var(--text-mid)", aligned ? 48 : undefined)}
    </>
  );
}

/* One kind of game. The switch is being in it; the count beside it opens the
   sidebar on it without joining anything, which is the only way to see what is
   in a category before committing to it. Two controls, so two buttons - a
   button inside a button is not a thing the DOM will honour. */
function CategoryRow({ label, on, count, total, open, waiting, ingame, onToggle, onOpen }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div style={{ display: "flex", alignItems: "stretch",
      background: open ? "var(--surface-selected)" : "transparent",
      /* Two different things, so two different marks: the ink rule down the
         left is being in the category, the fill is which one the sidebar is
         showing. */
      boxShadow: on ? "inset 3px 0 0 var(--text-hi), var(--rule-inset)" : "var(--rule-inset)" }}>
      <button type="button" role="switch" aria-checked={on} aria-label={label + " queues"}
        onClick={onToggle}
        style={{ flex: 1, minWidth: 0, height: "var(--row-tall)", display: "flex",
          alignItems: "center", gap: "var(--sp-5)", padding: "0 var(--sp-5)", cursor: "pointer",
          textAlign: "left", border: 0, font: "inherit", color: "inherit", background: "transparent" }}>
        <Switch checked={on} />
        <span style={{ font: "var(--text-heading)", flex: 1, minWidth: 0,
          color: on ? "var(--text-hi)" : "var(--text-body)" }}>{label}</span>
        <Counts waiting={waiting} ingame={ingame} aligned />
      </button>
      <button type="button" onClick={onOpen}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        aria-label={"Options for " + label + ": " + count + " of " + total + " on"}
        style={{ width: 96, flex: "0 0 auto", border: 0, borderLeft: "1px solid var(--w-06)",
          padding: "0 var(--sp-5)", textAlign: "right", cursor: "pointer", ...NUM,
          background: hover ? "var(--surface-hover)" : "transparent",
          color: open || hover ? "var(--text-hi)" : "var(--text-low)" }}>
        {count} of {total}
      </button>
    </div>
  );
}

/* A queue is still a switch, because that is still what it is: you are in it or
   you are not, and you may be in several at once. What changed is how many of
   them the screen puts in front of you.

   The server runs seventeen queues, and seventeen switches in one column is a
   wall. Grouping them by team size took that to eleven rows, which is a shorter
   wall: 2v2 through 10v10 are nine rows that differ by one number and read as a
   ladder to be climbed rather than a choice to be made.

   So the centre column is the kinds of game - a duel, a team game, coop - and
   everything else is a modifier in the sidebar: which sizes of team game, how
   closely matched an opponent. That is the shape of the decision. You know
   whether you want a 1v1 before you open the screen; whether you want 5v5+ as
   well as 4v4+, and whether you want "1v1 Wide" rather than "1v1 Narrow", are
   preferences most people never form.

   The category is a toggle rather than a filter or a tab, because a filter
   would have left the wall of switches in place with a lid on it. Turning one
   on joins every queue in it, which is what the matchmaker rewards anyway: more
   queues, more chances to be matched. The sidebar is where you take one back
   off, and the count on the row says when you have. */
export default function QueueScreen({ queued, onQueue, onFake, queues, joined, elo,
  joinedTime, bannedSeconds, party, onInvite, onLeaveParty }) {
  const live = Boolean(queues);
  const list = queues || QUEUES;
  const groups = groupQueues(list);
  /* Live there is one copy of this and the server owns it: the store mirrors
     our request the moment we make it, and a party member can put us in a queue
     without us touching anything. The demo has no server to be the authority. */
  const [demoQueues, setDemoQueues] = React.useState([]);
  const inQueues = live ? (joined || []) : demoQueues;
  const [now, setNow] = React.useState(() => Date.now());
  const [picked, setPicked] = React.useState(undefined);

  /* The demo's ready check drops you out of the queue when you decline it, and
     the switches have to follow that down rather than keep claiming you are in. */
  React.useEffect(() => { if (!live && !queued) setDemoQueues([]); }, [live, queued]);

  const inQueue = inQueues.length > 0;
  React.useEffect(() => {
    if (!inQueue) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [inQueue]);

  /* Worked out from the list as it stands rather than fixed at mount, so there
     is one rule for it: whatever you last opened, else whatever you are already
     queued for, else the smallest. */
  const current = groups.find(g => g.id === picked)
    || groups.find(g => g.queues.some(q => inQueues.includes(q.id)))
    || groups[0];

  const [inviting, setInviting] = React.useState("");
  const request = names => {
    if (!live) setDemoQueues(names);
    onQueue(names);
  };
  /* Every flip is a set, sent in the server's own order, so that the same three
     queues go out as the same line however you arrived at them. */
  const send = want => request(list.filter(q => want.has(q.id)).map(q => q.id));
  const toggleQueue = id => {
    const want = new Set(inQueues);
    if (want.has(id)) want.delete(id);
    else want.add(id);
    send(want);
  };
  /* Off if any of it is on. A part-on category reads as on - the switch is
     "am I in this" - so the click that follows is the one that gets you out,
     not the one that quietly puts you in the two you had turned off. */
  const toggleGroup = g => {
    const want = new Set(inQueues);
    const anyOn = g.queues.some(q => want.has(q.id));
    for (const q of g.queues) {
      if (anyOn) want.delete(q.id);
      else want.add(q.id);
    }
    setPicked(g.id);
    send(want);
  };
  const onCount = g => g.queues.filter(q => inQueues.includes(q.id)).length;
  const sum = (g, key) => g.queues.reduce((n, q) => n + (q[key] || 0), 0);
  /* The set is held as ids because that is what the request wants, but a
     summary should read as the rows do. */
  const labelOf = id => (list.find(q => q.id === id) || {}).label || id;
  const invite = () => {
    const name = inviting.trim();
    if (!name || !onInvite) return;
    onInvite(name);
    setInviting("");
  };
  const waited = elapsed(joinedTime, now);

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "200px minmax(0,1fr) 320px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0,
        borderRight: "1px solid var(--w-12)", background: "var(--surface-sunken)" }}>
        <div style={{ height: 26, flex: "0 0 auto", display: "flex", alignItems: "center",
          gap: "var(--sp-4)", padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab" style={{ flex: 1, minWidth: 0 }}>OPTIONS</span>
          {current && <span className="lab" style={{ color: "var(--text-hi)" }}>{current.label}</span>}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-4)",
          display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          {!current
            ? <span style={{ ...NOTE, color: "var(--text-low)" }}>Nothing to tune yet.</span>
            : current.queues.map(q => {
              const on = inQueues.includes(q.id);
              return (
                /* The server's sentence about this queue used to be printed
                   under the name and is not any more: a column of three-line
                   paragraphs is what made the sidebar hard to read down. It is
                   still the title, so the one person who wants to know what
                   "Sortie" means can hover it. */
                <button key={q.id} type="button" role="switch" aria-checked={on} aria-label={q.label}
                  onClick={() => toggleQueue(q.id)} title={q.description || undefined}
                  style={{ display: "flex", flexDirection: "column", alignItems: "stretch",
                    gap: "var(--sp-3)", padding: "var(--sp-4)", cursor: "pointer", textAlign: "left",
                    border: "1px solid " + (on ? "var(--w-20)" : "var(--w-06)"), font: "inherit",
                    color: "inherit", background: on ? "var(--surface-base)" : "transparent" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                    {/* The whole card is the control, so the switch is only its
                        indicator: with no onChange the click carries on through
                        to the button underneath. */}
                    <Switch checked={on} />
                    <span style={{ flex: 1, minWidth: 0, font: "var(--text-ui-sm)",
                      color: on ? "var(--text-hi)" : "var(--text-body)" }}>{q.label}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                    <Counts waiting={q.waiting || 0} ingame={q.ingame || 0} />
                    {/* The one other thing MatchMakerSetup serialises, and it
                        decides whether your party can queue here at all. The
                        number differs per queue - 3 for Sortie, 6 for Battle -
                        so it is worth showing; the sentence it used to be
                        wrapped in was not, once it had been read down a column
                        of them. On the row rather than under it, because a
                        second line per queue is what made this list long. */}
                    {q.maxParty > 1 && (
                      <>
                        <span className="lab">PARTY</span>
                        <span style={{ ...NUM, color: "var(--text-mid)" }}>{q.maxParty}</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ height: 26, flex: "0 0 auto", display: "flex", alignItems: "center",
          gap: "var(--sp-5)", padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab" style={{ flex: 1 }}>QUEUES</span>
          <span className="lab" style={{ width: 96, textAlign: "right" }}>OPTIONS ON</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {groups.length === 0
            ? <EmptyState icon="target" title="The server has not offered any queues."
                body="MatchMakerSetup arrives shortly after login." />
            : groups.map(g => (
              <CategoryRow key={g.id} label={g.label} on={onCount(g) > 0} count={onCount(g)}
                total={g.queues.length} open={current?.id === g.id}
                waiting={sum(g, "waiting")} ingame={sum(g, "ingame")}
                onToggle={() => toggleGroup(g)} onOpen={() => setPicked(g.id)} />
            ))}
        </div>
      </div>

      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", gap: "var(--sp-6)", padding: "var(--sp-6)",
        minHeight: 0, overflowY: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <span className="lab">YOUR MATCHMAKER RATING</span>
          <span style={{ font: "var(--text-num-lg)", color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>
            {/* 1766 is the fixture's rating and belongs to the demo. Live, the
                honest answer until our own User record arrives is not a number
                at all, so say nothing rather than somebody else's. */}
            {live ? (Number.isFinite(elo) ? elo : "-") : 1766}
          </span>
        </div>
        {bannedSeconds ? (
          <span style={{ ...NOTE, color: "var(--signal-danger)" }}>
            Banned from the matchmaker for another {bannedSeconds}s.
          </span>
        ) : null}
        {inQueue ? (
          <>
            <Meter indeterminate label={waited ? "Searching - " + waited : "Searching"}
              right={inQueues.length + (inQueues.length === 1 ? " queue" : " queues")} />
            {/* Named, not counted. Being in six is the whole point of switches,
                and a bare six says nothing about which six. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
              {inQueues.map(id => <Badge key={id} tone="outline">{labelOf(id)}</Badge>)}
            </div>
            <span style={{ ...NOTE, color: "var(--text-low)" }}>
              You can keep browsing battles while you wait. Shiro will interrupt when a match is found.
            </span>
            <Button variant="secondary" block onClick={() => request([])}>Leave all queues</Button>
            {onFake && <Button variant="ghost" size="sm" block onClick={onFake}>Simulate match found</Button>}
          </>
        ) : null}
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="lab">PARTY</span>
            {onLeaveParty && party && party.length > 0 && (
              <IconButton icon="log-out" size="sm" label="Leave party" onClick={onLeaveParty} />
            )}
          </div>
          {party && party.length > 0
            ? party.map(p => <UserChip key={p.name} {...p} size="sm" />)
            : null}
          {onInvite && (
            <div style={{ display: "flex", gap: "var(--sp-3)" }}>
              <Input placeholder="Invite by name" size="sm" value={inviting} wrapStyle={{ flex: 1 }}
                onChange={e => setInviting(e.target.value)}
                onKeyDown={e => e.key === "Enter" && invite()} />
              <Button variant="quiet" size="sm" onClick={invite}>Invite</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
