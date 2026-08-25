import React from "react";
import { Button, Badge, Tag, PlayerRow, ChatLine, MapImage, Input,
  IconButton, Icon, UserChip, Meter, Tooltip } from "../ds/shiro.js";
import { useStickyScroll } from "../hooks/useStickyScroll.js";
import { useMapResourceId } from "../hooks/useMapResourceId.js";
import ChatText from "./ChatText.jsx";
import { completeAt } from "../store/complete.ts";

/* Screen 4 - the largest and densest screen. Teams, spectators, bots, map,
   options, chat, ready/start. Team columns are a grid so 1v1 and 16-way FFA
   use the same layout - see TEAM_MIN_WIDTH for how the wide case stays
   readable. */

/* The narrowest a team column may be before it stops being one.
   Matched to the spectator panel beside it, which holds the same PlayerRow:
   below this the name, clan mark and rating start colliding. Team columns wrap
   onto further rows rather than shrink past it. */
const TEAM_MIN_WIDTH = 220;

/* At most this many blank rows under a team, however much room is left. They
   are there to show the shape of a team that has space, not to pad the column
   out to its capacity - a 16-a-side game would otherwise draw sixteen. */
const MAX_EMPTY_ROWS = 3;

export function TeamColumn({ ally, players, max = 8, onJoin, onKick, onAddBot, onPlayer }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0,
      borderRight: "1px solid var(--w-06)" }}>
      <div style={{ height: 26, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 var(--sp-4)", borderBottom: "1px solid var(--w-06)", background: "var(--w-04)" }}>
        <span className="lab">TEAM {ally + 1}</span>
        <span style={{ font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)", color: "var(--text-low)",
          fontVariantNumeric: "tabular-nums" }}>{players.length}/{max}</span>
      </div>
      {players.map((p, i) => (
        <PlayerRow key={i} {...p} user={p.user}
          onClick={onPlayer ? () => onPlayer(p.user) : undefined}
          /* Host controls are offered to everyone; the server ignores them from
             anyone else, which is the only authority that counts. The rating
             is not repeated here - UserChip already draws it, and the design
             kit's duplicate was a bug. */
          right={onKick
            ? <IconButton icon="x" size="sm" label={"Remove " + p.user.name}
                onClick={() => onKick(p.user)} />
            : null} />
      ))}
      {Array.from({ length: Math.max(0, Math.min(MAX_EMPTY_ROWS, max - players.length)) }).map((_, i) => (
        <div key={"e" + i} style={{ height: "var(--row-default)", display: "flex", alignItems: "center",
          padding: "0 var(--sp-4)", boxShadow: "var(--rule-inset)" }}>
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1 var(--font-core)", color: "var(--text-faint)" }}>empty</span>
        </div>
      ))}
      <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <Button variant="quiet" size="sm" block onClick={onJoin}>Join team {ally + 1}</Button>
        {onAddBot && <Button variant="ghost" size="sm" block icon="plus"
          onClick={() => onAddBot(ally)}>Add AI</Button>}
      </div>
    </div>
  );
}

/* Who wants to play and is not going to, by name.
   The room used to say only "Full", which is the one thing everybody could
   already see. The names come from `QueueOrder`, which the server broadcasts
   per person - see `waitingToPlay` in store/adapters.ts for why that is the
   people waiting and not just an ordering.

   The two kinds are not equally certain and must not be worded as though they
   were. `queue` is arithmetic we can redo exactly; `refused` is a thing that
   already happened, for a reason the server keeps to itself. */
function WaitingPanel({ waiting, full, onPlayer }) {
  if (!waiting || waiting.players.length === 0) return null;
  const { players, kind } = waiting;
  const note = kind === "queue"
    ? "Last to claim a slot. If the game started now, the server would move "
      + (players.length === 1 ? "this player" : "these players") + " to the spectators."
    : full
      ? "Asked to play after the room filled up, so the server made "
        + (players.length === 1 ? "them a spectator" : "them spectators") + ". "
        + "Nothing holds a place - a slot that frees up goes to whoever takes it first."
      /* Not full, so the cap is not the explanation. ValidateBattleStatus flips
         the same bit for an Elo, level or rank limit and never says which, so
         neither do we. */
      : "Asked to play and the server said no. The room is not full, so this is "
        + "likely a rating, level or rank limit - it does not say which.";
  return (
    <>
      <div style={{ height: 26, flex: "0 0 auto", display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 var(--sp-4)",
        borderBottom: "1px solid var(--w-06)", background: "var(--w-04)" }}>
        <span className="lab">WAITING TO PLAY</span>
        <span style={{ font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)",
          color: "var(--text-low)", fontVariantNumeric: "tabular-nums" }}>{players.length}</span>
      </div>
      {/* Capped rather than scrolled: the spectator list below is the thing
          people scroll, and two scrollers in a 220px column fight each other.
          A long queue is rare and the count above still tells the truth. */}
      <div style={{ flex: "0 0 auto", maxHeight: 132, overflowY: "auto" }}>
        {players.map((p, i) => (
          <PlayerRow key={i} {...p} spectator={undefined}
            onClick={onPlayer ? () => onPlayer(p.user) : undefined} />
        ))}
      </div>
      <div style={{ padding: "var(--sp-3) var(--sp-4)", borderBottom: "1px solid var(--w-06)" }}>
        <span style={{ font: "var(--w-regular) var(--size-micro)/1.4 var(--font-core)",
          color: "var(--text-faint)" }}>{note}</span>
      </div>
    </>
  );
}

/* One option in a vote: name, tally, and a bar against the winning threshold.
   Map votes get the map itself, because that is the thing being chosen. */
function VoteOption({ option, target, isMap, onVote }) {
  const [hover, setHover] = React.useState(false);
  const name = option.DisplayName || option.Name || "";
  const votes = option.Votes || 0;
  return (
    <div onClick={() => onVote && onVote(option.Id)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title={name}
      style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-3)",
        cursor: onVote ? "pointer" : "default",
        border: "1px solid " + (hover ? "var(--w-20)" : "var(--w-06)"),
        background: hover ? "var(--surface-hover)" : "transparent",
        transition: "var(--transition-hover)" }}>
      {isMap && (
        <MapImage map={option.Name} kind="thumbnail" ratio="1"
          style={{ width: 48, flex: "0 0 auto" }} />
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
        justifyContent: "center", gap: "var(--sp-3)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)" }}>
          <span style={{ flex: 1, minWidth: 0, font: "var(--text-ui-sm)", color: "var(--text-hi)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
          <span style={{ font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
            color: "var(--text-mid)", fontVariantNumeric: "tabular-nums" }}>{votes}/{target}</span>
        </div>
        <Meter value={votes} max={target} height={2} />
      </div>
    </div>
  );
}

/* A vote you can read at a glance.
   Previously the tally was crammed into a button label ("Terraform  3/5") and
   yes/no votes showed no counts at all, so there was no way to tell how close
   anything was. Everything needed is already on the wire: PollOption.Votes and
   BattlePoll.VotesToWin. */
export function PollPanel({ poll, onVote }) {
  const target = Math.max(1, poll.VotesToWin || 1);
  const options = poll.Options || [];
  const isMap = Boolean(poll.MapSelection);

  // Yes/no tallies arrive as ordinary options when the server sends them, but
  // the ids are not fixed, so match on the name and degrade quietly if absent.
  const byName = re => options.find(o => re.test(o.DisplayName || o.Name || ""));
  const yes = byName(/^y/i);
  const no = byName(/^n/i);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <span className="lab">{isMap ? "MAP VOTE" : "VOTE"}</span>
      <span style={{ font: "var(--text-ui)", color: "var(--text-hi)" }}>{poll.Topic}</span>

      {poll.YesNoVote ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <div style={{ display: "flex", gap: "var(--sp-4)" }}>
            <Button variant="primary" size="sm" style={{ flex: 1 }}
              onClick={() => onVote && onVote(true)}>Yes</Button>
            <Button variant="secondary" size="sm" style={{ flex: 1 }}
              onClick={() => onVote && onVote(false)}>No</Button>
          </div>
          {yes && <Meter value={yes.Votes || 0} max={target} height={2}
            label="Yes" right={(yes.Votes || 0) + "/" + target} />}
          {no && <Meter value={no.Votes || 0} max={target} height={2}
            label="No" right={(no.Votes || 0) + "/" + target} />}
          {!yes && !no && (
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
              color: "var(--text-faint)" }}>{target} votes to pass.</span>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          {options.map(o => (
            <VoteOption key={o.Id} option={o} target={target} isMap={isMap} onVote={onVote} />
          ))}
        </div>
      )}
    </div>
  );
}

/* `chat`, `onSay`, `onTeam`, `onSpectate`, `sync` and `phase` are supplied when
   the screen is driven by the live store; without them it renders the demo
   room from data.js and the interactive parts stand down. */
/* The divider between the teams and the chat. Dragged, or nudged with the
   arrow keys - it is a real separator to a screen reader either way, which a
   bare div with a mousedown handler is not.

   Height is owned by the caller and persisted, because it is a preference
   about how you use the room rather than a state of this render. */
/* Enough chat to be worth having, and enough room above it that the teams -
   the reason you are on this screen - do not vanish. */
const CHAT_MIN = 120;
const TEAMS_FLOOR = 300;

export function PaneResizer({ height, min, max, onResize }) {
  const clamp = h => Math.max(min, Math.min(max, h));

  const onPointerDown = e => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    // Dragging up makes the pane taller: it is anchored to the bottom.
    const move = ev => onResize(clamp(startHeight + (startY - ev.clientY)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const onKeyDown = e => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowUp") { e.preventDefault(); onResize(clamp(height + step)); }
    else if (e.key === "ArrowDown") { e.preventDefault(); onResize(clamp(height - step)); }
  };

  /* The focus ring is drawn on the grip rather than left to the browser: the
     default outline on a 7px full-width strip reads as a heavy bar across the
     screen, which looks like a broken border rather than a focused control. */
  const [focused, setFocused] = React.useState(false);

  return (
    <div role="separator" aria-orientation="horizontal" tabIndex={0}
      aria-label="Resize chat" aria-valuenow={Math.round(height)}
      aria-valuemin={min} aria-valuemax={max}
      onPointerDown={onPointerDown} onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{
        height: 7, marginBottom: -1, flex: "0 0 auto", cursor: "ns-resize",
        /* The grab area is taller than the line it draws, because a 1px
           target is a target you miss. */
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", outline: "none",
      }}>
      <div aria-hidden="true" style={{
        width: focused ? 72 : 44, height: 3, borderRadius: 2,
        background: focused ? "var(--text-hi)" : "var(--w-12)",
        transition: "var(--transition-hover)",
      }} />
    </div>
  );
}

export default function BattleRoomScreen({ room, onLeave, onStart, chat, onSay,
  onTeam, onSpectate, sync, phase, poll, pollOutcome, onVote, onKick, onAddBot, onPlayer,
  download, onEditOptions, optionsLocked, chatHeight = 200, onChatHeight, onZk }) {
  const [msg, setMsg] = React.useState("");
  const cycle = React.useRef(undefined);

  /* Tab completes a name, the same as in the chat screen. Everybody in the
     room counts, players and spectators alike - a spectator is exactly the
     person somebody is most likely to be telling to take a slot. */
  const onComposerKey = e => {
    if (e.key === "Enter") { send(); return; }
    if (e.key !== "Tab" || e.shiftKey) return;
    const el = e.target;
    const here = [
      ...room.teams.flatMap(t => t.players.map(p => p.user.name)),
      ...room.spectators.map(p => p.user.name),
    ].filter(Boolean);
    const next = completeAt(el.value, el.selectionStart ?? el.value.length, [here], cycle.current);
    if (!next) return;
    e.preventDefault();
    cycle.current = next;
    setMsg(next.text);
    requestAnimationFrame(() => el.setSelectionRange(next.caret, next.caret));
  };
  const mapId = useMapResourceId(room.map);
  /* The pane may not grow so far that the teams it sits under disappear. The
     ceiling is the window rather than the container because the container's
     height is what we are changing - measuring it would chase itself. */
  const [viewport, setViewport] = React.useState(
    () => (typeof window === "undefined" ? 800 : window.innerHeight));
  React.useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const chatMax = Math.max(CHAT_MIN, viewport - TEAMS_FLOOR);
  const waiting = room.waitingOn || [];
  const lines = chat || room.chat || [];
  const scroll = useStickyScroll({ count: lines.length, resetKey: room.id });
  // Anything between "start pressed" and "engine running" counts as busy: the
  // content steps are part of starting, not a separate thing to interrupt.
  const busy = phase
    ? ["preflight", "downloading", "launching", "running"].includes(phase.kind)
    : false;
  const send = () => { if (onSay && msg.trim()) onSay(msg); setMsg(""); };
  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div style={{ height: 44, flex: "0 0 auto", display: "flex", alignItems: "center", gap: "var(--sp-5)",
          padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
          <IconButton icon="arrow-left" label="Back to battles" onClick={onLeave} />
          <span style={{ font: "var(--w-semibold) var(--size-mid)/1 var(--font-core)", color: "var(--text-hi)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{room.title}</span>
          <Badge tone="outline">{room.mode}</Badge>
          {/* The room never said how big it was: the team columns count to a
              hardcoded eight, which is not this room's cap. Bots are left out
              because the server leaves them out - they take no slot. */}
          {room.maxPlayers > 0 && <Badge mono>{room.players}/{room.maxPlayers}</Badge>}
          {room.full && (
            <Badge tone="solid">{room.queued > 0 ? "Full +" + room.queued : "Full"}</Badge>
          )}
          <span style={{ flex: 1 }} />
          <span className="lab">HOST</span>
          <UserChip name={room.founder} size="sm" presence="room" />
        </div>

        {/* One track per team used to mean a sixteen-way game got sixteen
            slivers - 56px each in this pane, narrower than a name. `auto-fit`
            fixes both ends of the range from one rule: it lays down as many
            TEAM_MIN_WIDTH tracks as the row will take and wraps the rest onto
            further rows, then collapses the tracks it did not need so a 1v1
            still gets two half-width columns rather than two narrow ones
            against dead space. Up to four teams nothing moves at all; past
            that the columns wrap instead of shrinking.

            `min(...,100%)` keeps a pane narrower than one column from pushing
            the track wider than the box, which would scroll the teams
            sideways - and a team you have to scroll to find is one you miss.
            Wrapped rows scroll down, which is why this box owns the overflow. */}
        <div style={{ flex: 1, minHeight: 0, display: "grid", overflowY: "auto",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(" + TEAM_MIN_WIDTH + "px, 100%), 1fr))" }}>
          {room.teams.map(t => <TeamColumn key={t.ally} ally={t.ally} players={t.players}
            max={room.teamSize}
            onJoin={onTeam ? () => onTeam(t.ally) : undefined}
            onKick={onKick} onAddBot={onAddBot} onPlayer={onPlayer} />)}
        </div>

        <PaneResizer height={chatHeight} min={CHAT_MIN} max={chatMax}
          onResize={onChatHeight || (() => {})} />
        <div style={{ flex: "0 0 auto", borderTop: "1px solid var(--w-12)", display: "flex", minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
            height: Math.min(chatHeight, chatMax) }}>
            {/* The counts that used to sit on the right are gone: the teams
                are above and the spectators are beside, both listed by name,
                so it was arithmetic the reader could already do. */}
            <div style={{ height: 26, display: "flex", alignItems: "center",
              padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-06)" }}>
              <span className="lab">ROOM CHAT</span>
            </div>
            <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
              <div ref={scroll.ref} onScroll={scroll.onScroll}
                style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingTop: "var(--sp-2)" }}>
                {lines.map((c, i) => (
                  <ChatLine key={c.id != null ? c.id : i} {...c}
                    text={<ChatText text={c.text} onZk={onZk} />} />
                ))}
              </div>
              {!scroll.pinned && lines.length > 0 && (
                <Button variant="secondary" size="sm" icon="arrow-down" onClick={scroll.jump}
                  style={{ position: "absolute", right: "var(--sp-5)", bottom: "var(--sp-4)",
                    boxShadow: "var(--elev-menu)" }}>
                  Newest
                </Button>
              )}
            </div>
            <div style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-4) var(--sp-5)",
              borderTop: "1px solid var(--w-06)" }}>
              <Input placeholder="Message the room" value={msg} onChange={e => setMsg(e.target.value)}
                onKeyDown={onComposerKey}
                wrapStyle={{ flex: 1 }} size="sm" />
              <Button variant="quiet" size="sm" onClick={send}>Send</Button>
            </div>
          </div>
          <div style={{ width: 220, flex: "0 0 auto", borderLeft: "1px solid var(--w-06)",
            display: "flex", flexDirection: "column", minHeight: 0 }}>
            <WaitingPanel waiting={room.waitingToPlay} full={room.full} onPlayer={onPlayer} />
            <div style={{ height: 26, flex: "0 0 auto", display: "flex", alignItems: "center",
              padding: "0 var(--sp-4)", borderBottom: "1px solid var(--w-06)" }}>
              <span className="lab">SPECTATORS</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {room.spectators.map((s, i) => (
                <PlayerRow key={i} spectator {...s}
                  onClick={onPlayer ? () => onPlayer(s.user) : undefined} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", minHeight: 0 }}>
        <MapImage map={room.map} resourceId={mapId} kind="minimap" ratio="1" caption link saturate={1} style={{ flex: "0 0 auto" }} />
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-5)",
          display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
          {poll && <PollPanel poll={poll} onVote={onVote} />}
          {!poll && pollOutcome && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              <span className="lab">LAST VOTE</span>
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
                color: pollOutcome.Success ? "var(--text-low)" : "var(--text-faint)" }}>
                {pollOutcome.Message || pollOutcome.Topic}
              </span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
              <span className="lab">MOD OPTIONS</span>
              <div style={{ flex: 1 }} />
              {/* Only the host may change these - the server refuses everyone
                  else, and in an autohost it refuses even the founder. Shown
                  disabled with the reason rather than hidden: a button that is
                  not there is a mystery, and this is the screen where people go
                  looking for it. */}
              {optionsLocked ? (
                <Tooltip label={optionsLocked} side="top">
                  <Button size="sm" variant="ghost" disabled>Edit</Button>
                </Tooltip>
              ) : (
                <Button size="sm" variant="ghost" onClick={onEditOptions}>Edit</Button>
              )}
            </div>
            {room.options.length === 0 ? (
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-faint)" }}>
                Default settings
              </span>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
                {room.options.map(o => (
                  <Tooltip key={o.key} label={o.desc || o.key} side="top">
                    <Tag value={o.value}>{o.label}</Tag>
                  </Tooltip>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <span className="lab">SYNC</span>

            {/* Content for this battle, fetched on join rather than at the
                whistle. This is where people look when a match will not start,
                so it says what is happening rather than leaving it to the
                Downloads screen. */}
            {download && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                {download.state === "running" || download.state === "queued" ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                      <Icon name="download" size={16} style={{ color: "var(--text-mid)" }} />
                      <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", flex: 1 }}>
                        {download.state === "queued" ? "Waiting to download" : "Downloading content"}
                      </span>
                    </div>
                    <Meter value={download.percent} max={100} right={download.percent + "%"} />
                  </>
                ) : download.state === "failed" ? (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-4)" }}>
                    <Icon name="alert-triangle" size={16}
                      style={{ color: "var(--signal-danger)", marginTop: 2 }} />
                    <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
                      color: "var(--signal-danger)" }}>{download.reason}</span>
                  </div>
                ) : download.state === "done" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                    <Icon name="check" size={16} style={{ color: "var(--text-mid)" }} />
                    <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>
                      Content ready
                    </span>
                  </div>
                ) : null}
              </div>
            )}

            {/* What we can otherwise assert: whether a Zero-K install was found
                and whether it has the engine this battle runs on. */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
              <Icon name={sync && !sync.install ? "alert-triangle" : "check"} size={16}
                style={{ color: sync && !sync.install ? "var(--signal-warn)" : "var(--text-mid)" }} />
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>
                {sync
                  ? (sync.install
                    ? "Zero-K installation found via " + sync.install.source
                    : "No Zero-K installation found")
                  : "You have the map and game"}
              </span>
            </div>
            {/* Which game this room runs. The line above is about your
                installation - every game launches out of the same Zero-K
                folder - and on its own it read as though the room were Zero-K,
                which is wrong in a Supreme-K or Zero Wars room. */}
            {room.game && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                <Icon name="package" size={16} style={{ color: "var(--text-low)" }} />
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
                  {room.game}
                </span>
              </div>
            )}
            {sync && sync.engine && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                <Icon name="cpu" size={16} style={{ color: "var(--text-low)" }} />
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
                  Engine {sync.engine}
                </span>
              </div>
            )}

            {/* Everyone else. `!start` gathers exactly this set, announces them
                as still downloading and holds the game for ten seconds, so it
                is worth reading before pressing Start rather than after - and
                the marks in the team columns say which of them is which. */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-4)" }}>
              <Icon name={waiting.length ? "download" : "check"} size={16}
                style={{ color: waiting.length ? "var(--signal-warn)" : "var(--text-mid)",
                  marginTop: 2, flex: "0 0 auto" }} />
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>
                {waiting.length === 0
                  ? "Everyone has the map"
                  : "Waiting on " + waiting.join(", ")}
              </span>
            </div>
          </div>
        </div>
        <div style={{ padding: "var(--sp-5)", borderTop: "1px solid var(--w-12)",
          display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <Button variant="primary" size="lg" block icon="play" disabled={busy} onClick={onStart}>
            {phase && phase.kind === "preflight" ? "Checking content..."
              : phase && phase.kind === "downloading" ? "Downloading " + phase.percent + "%"
              : phase && phase.kind === "launching" ? "Launching..."
              : phase && phase.kind === "running" ? "Game running"
              : room.running ? "Join game" : "Start game"}
          </Button>
          {phase && phase.kind === "failed" && (
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--signal-danger)" }}>
              {phase.reason}
            </span>
          )}
          {phase && !room.running && (
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
              Asks the host to start. Matchmaker games start on their own.
            </span>
          )}
          <div style={{ display: "flex", gap: "var(--sp-4)" }}>
            <Button variant="ghost" size="sm" style={{ flex: 1 }} onClick={onSpectate}>Spectate</Button>
            <Button variant="danger" size="sm" style={{ flex: 1 }} onClick={onLeave}>Leave</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
