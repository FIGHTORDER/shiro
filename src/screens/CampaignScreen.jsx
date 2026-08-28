import React from "react";
import { Button, Badge, EmptyState, Icon } from "../ds/shiro.js";

/* Campaigns: missions somebody built in Splaunch, played here.
 *
 * This screen only exists when a campaign is installed, and the nav item that
 * reaches it is hidden otherwise - so unlike Add-ons next door there is no
 * empty state for "none yet". Installing is Add-ons' job; this is for playing.
 *
 * The interesting state is per mission, and there are four of them: locked
 * behind another mission, playable, missing its map, and finished. Only one of
 * those is a button, and the other three each have a different thing to say,
 * which is the whole design problem here. */

const label = {
  font: "var(--w-regular) var(--size-micro)/1 var(--font-core)",
  letterSpacing: "var(--track-label)",
  textTransform: "uppercase",
  color: "var(--text-faint)",
};

/* One campaign in the rail. Shaped like the Add-ons kind rows, because it is
   the same gesture: pick a thing on the left, see it on the right. */
function CampaignRow({ campaign, active, onPick }) {
  const [hover, setHover] = React.useState(false);
  const done = campaign.missions.filter(m => m.done).length;
  return (
    <button type="button" onClick={onPick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        appearance: "none", border: 0, textAlign: "left", width: "100%",
        display: "flex", alignItems: "center", gap: "var(--sp-4)",
        padding: "var(--sp-4) var(--sp-5)", cursor: "pointer",
        background: active ? "var(--surface-selected)"
          : hover ? "var(--surface-hover)" : "transparent",
        boxShadow: "var(--rule-inset)", transition: "var(--transition-hover)",
      }}>
      <Icon name="book-open" size={16}
        style={{ color: active ? "var(--text-hi)" : "var(--text-low)", flex: "0 0 auto" }} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ font: "var(--w-semibold) var(--size-tiny)/1.2 var(--font-core)",
          color: active ? "var(--text-hi)" : "var(--text-body)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {campaign.name}
        </span>
        <span style={{ font: "var(--w-regular) var(--size-micro)/1.3 var(--font-mono)",
          color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
          {done}/{campaign.missions.length}
        </span>
      </span>
    </button>
  );
}

/* A mission, and the one thing it can say for itself.
 *
 * The order of these branches is the order the player cares about: a mission
 * they cannot reach yet, then one whose map is not here, then one they have
 * finished, then one they can start. Saying "you need this map" about a
 * mission that is still locked would be true and useless. */
function MissionRow({ mission, index, locked, busy, onPlay, onFinish }) {
  const [hover, setHover] = React.useState(false);
  const missingMap = !locked && !mission.mapArchive;
  const dim = locked ? 0.55 : 1;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: "var(--sp-5)",
        padding: "var(--sp-4) var(--sp-6)", minWidth: 0, opacity: dim,
        background: hover && !locked ? "var(--surface-hover)" : "transparent",
        boxShadow: "var(--rule-inset)", transition: "var(--transition-hover)",
      }}>
      <span aria-hidden="true" style={{
        flex: "0 0 auto", width: 26, height: 26, display: "inline-flex",
        alignItems: "center", justifyContent: "center", borderRadius: "50%",
        border: "1px solid var(--w-12)",
        background: mission.done ? "var(--surface-selected)" : "transparent",
        font: "var(--w-semibold) var(--size-micro)/1 var(--font-mono)",
        color: mission.done ? "var(--text-hi)" : "var(--text-faint)",
      }}>
        {mission.done ? <Icon name="check" size={13} /> : index + 1}
      </span>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ font: "var(--w-semibold) var(--size-base)/1.2 var(--font-core)",
          color: "var(--text-hi)" }}>{mission.name}</span>
        <span style={{ font: "var(--w-regular) var(--size-tiny)/1.35 var(--font-core)",
          color: "var(--text-low)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap" }}>
          {locked
            ? "Finish the missions before it to unlock this."
            : mission.summary || mission.map}
        </span>
      </div>

      {/* Finished missions keep a way back: somebody who ticked the wrong row,
          or wants to play one again, should not have to reinstall to do it. */}
      {mission.done && !locked && (
        <Button variant="ghost" size="sm" disabled={busy}
          onClick={() => onFinish(false)}>Not done</Button>
      )}

      {locked
        ? <Badge tone="outline">Locked</Badge>
        : missingMap
          ? <Badge tone="outline">Needs {mission.map}</Badge>
          : (
            <>
              {!mission.done && (
                <Button variant="ghost" size="sm" disabled={busy}
                  onClick={() => onFinish(true)}
                  aria-label={`Mark ${mission.name} finished`}>Mark done</Button>
              )}
              <Button variant="secondary" size="sm" disabled={busy}
                onClick={onPlay}
                aria-label={`Play ${mission.name}`}>
                {busy ? "Starting..." : mission.done ? "Replay" : "Play"}
              </Button>
            </>
          )}
    </div>
  );
}

export default function CampaignScreen({ campaigns = [], gameVersion, busy, error,
  onPlay, onFinish }) {
  const [sel, setSel] = React.useState(undefined);

  /* Keep the selection valid as campaigns are installed and removed. Removing
     the one being looked at should land on another rather than on nothing. */
  const current = campaigns.find(c => c.id === sel) || campaigns[0];
  React.useEffect(() => {
    if (current && current.id !== sel) setSel(current.id);
  }, [current && current.id]);

  if (!current) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <EmptyState icon="book-open" title="No campaigns installed."
          body="Add-ons has the ones Shiro knows about, and takes a campaign file you already have." />
      </div>
    );
  }

  /* A campaign compiled against a different Zero-K usually runs fine: unit
     names are stable, and the campaign gadget ignores what it cannot resolve.
     When it does not, it fails by placing nothing and saying nothing, so the
     mismatch is worth a line even though it is not a refusal. */
  const skew = current.builtAgainst && gameVersion
    && current.builtAgainst !== gameVersion ? current.builtAgainst : undefined;

  const done = current.missions.filter(m => m.done).length;

  return (
    <div style={{ flex: 1, display: "grid", minHeight: 0,
      gridTemplateColumns: campaigns.length > 1 ? "200px minmax(0,1fr)" : "minmax(0,1fr)" }}>

      {/* One campaign needs no rail to choose between. */}
      {campaigns.length > 1 && (
        <div style={{ borderRight: "1px solid var(--w-12)", background: "var(--surface-sunken)",
          display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
          <div style={{ height: 44, flex: "0 0 auto", display: "flex", alignItems: "center",
            padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
            <span className="lab">CAMPAIGNS</span>
          </div>
          {campaigns.map(c => (
            <CampaignRow key={c.id} campaign={c} active={c.id === current.id}
              onPick={() => setSel(c.id)} />
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ height: 44, flex: "0 0 auto", display: "flex", alignItems: "center",
          gap: "var(--sp-4)", padding: "0 var(--sp-6)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab">{current.name.toUpperCase()}</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...label, fontVariantNumeric: "tabular-nums" }}>
            {done} of {current.missions.length} finished
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div style={{ padding: "var(--sp-5) var(--sp-6)",
            display: "flex", flexDirection: "column", gap: "var(--sp-3)",
            boxShadow: "var(--rule-inset)" }}>
            {current.description && (
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
                color: "var(--text-body)", maxWidth: "62ch" }}>{current.description}</span>
            )}
            <span style={{ ...label }}>
              {current.author ? `By ${current.author}` : "Author unknown"}
              {current.version ? ` · ${current.version}` : ""}
            </span>
            {skew && (
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
                color: "var(--text-low)" }}>
                Built against {skew}, and you have {gameVersion}. It will probably
                still run.
              </span>
            )}
          </div>

          {error && (
            <div role="alert" style={{ padding: "var(--sp-4) var(--sp-6)",
              font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
              color: "var(--text-hi)", background: "var(--surface-sunken)",
              boxShadow: "var(--rule-inset)" }}>{error}</div>
          )}

          {current.missions.map((m, i) => (
            <MissionRow key={m.id} mission={m} index={i} locked={!m.unlocked}
              busy={busy === m.id}
              onPlay={() => onPlay?.(current.id, m.id)}
              onFinish={done => onFinish?.(current.id, m.id, done)} />
          ))}

          {/* Said once, at the bottom, rather than on every row: a mission is a
              single-player game against the machine, and nothing about it
              reaches the lobby server or anybody's rating. */}
          <div style={{ padding: "var(--sp-5) var(--sp-6)",
            font: "var(--w-regular) var(--size-micro)/1.5 var(--font-core)",
            color: "var(--text-faint)", maxWidth: "62ch" }}>
            Missions run offline against your own Zero-K. Nothing here is
            reported to the lobby, and finishing one is on the honour system.
          </div>
        </div>
      </div>
    </div>
  );
}
