import React from "react";
import { Badge, Button, Input, UserChip, EmptyState, Icon } from "../ds/shiro.js";
import { playerRank, rankColour, rankName } from "../net/ranks.ts";
import { latestRating } from "../net/zkweb.ts";

/* Design 2A: one column, and searching turns the whole screen into whoever you
   picked. There is no separate "someone else" layout - the same panels render
   with less in them.
 *
 * Which panels those are is decided by the protocol, not by taste:
 *
 *   - Your own profile arrives unprompted (`UserProfile`) and carries the three
 *     ratings, level, rank, badges, kudos and awards.
 *   - Everyone else's comes from their `User` record, which the server
 *     broadcasts for anyone online: name, clan, country, faction, level, rank
 *     and two of the three ratings.
 *   - You cannot ask for someone else's profile. `UserProfile` is
 *     server-to-client only and sending it throws on the real server, which is
 *     why store/friends.ts requestProfile is a no-op.
 *
 * So a panel with no data for the person on screen is left out rather than
 * drawn empty - a player with no Planetwars rating and a player whose rating we
 * cannot see look identical otherwise, and only one of those is true. */

const COUNTRIES = {
  DE: "Germany", US: "United States", GB: "United Kingdom", FR: "France",
  PL: "Poland", SE: "Sweden", NL: "Netherlands", CA: "Canada", JP: "Japan",
  BR: "Brazil", AU: "Australia", RU: "Russia", ES: "Spain", IT: "Italy",
  FI: "Finland", NO: "Norway", DK: "Denmark", CZ: "Czechia", AT: "Austria",
};

const FACTIONS = {
  machines: "Free Machines", hegemony: "Dynasty Hegemony", rising: "Empire Rising",
};

/* The nine ids the server sends, from Chobby's own table. An id we do not know
   shows as itself - the list grows server-side, not here. */
const BADGE_LABELS = {
  player_level: "Level 200", player_elo: "Top 3 player",
  donator_0: "Bronze donator", donator_1: "Silver donator",
  donator_2: "Gold donator", donator_3: "Diamond donator",
  dev_content: "External developer", dev_game: "Game developer",
  dev_adv: "Lead developer",
};

const label = { font: "var(--text-label)", letterSpacing: "var(--track-label)",
  textTransform: "uppercase", color: "var(--text-low)", whiteSpace: "nowrap" };

/** A search hit's presence, in the same words the friends list uses. */
function presenceOf(u) {
  if (!u) return "OFFLINE";
  if (u.InGameSince) return "IN GAME";
  if (u.BattleID != null) return "IN ROOM";
  if (u.AwaySince) return "AWAY";
  return "ONLINE";
}

/* Rank by how well the query matches, then alphabetically. A bare substring
   match over every connected player returns half the directory for two
   letters, so a prefix has to beat a mid-word hit. */
function rankHits(users, query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored = [];
  for (const u of Object.values(users)) {
    const name = (u.Name || "").toLowerCase();
    const clan = (u.Clan || "").toLowerCase();
    const country = (u.Country || "").toLowerCase();
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (clan === q || country === q) score = 2;
    else if (name.includes(q)) score = 3;
    else if (clan.includes(q)) score = 4;
    if (score >= 0) scored.push([score, u]);
  }
  scored.sort((a, b) => a[0] - b[0] || (a[1].Name || "").localeCompare(b[1].Name || ""));
  return scored.slice(0, 8).map(s => s[1]);
}

/**
 * One rating tile.
 *
 * `note` is what makes a dash readable. A player with no rating, a player whose
 * rating only exists while they are connected, and a page we could not read all
 * render as "-", and those are three different facts - so the tile says which
 * one it is instead of leaving the reader to guess. It is also where a figure
 * that came from zero-k.info rather than from the lobby says so.
 */
function Rating({ name, value, note }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: "var(--sp-6) var(--sp-7)",
      borderRight: "1px solid var(--w-06)" }}>
      <span style={label}>{name}</span>
      <div style={{ marginTop: "var(--sp-3)" }}>
        <span style={{ font: "var(--text-num-lg)", color: "var(--text-hi)",
          fontVariantNumeric: "tabular-nums" }}>
          {value != null ? Math.round(value) : "-"}
        </span>
      </div>
      {note && (
        <div style={{ marginTop: "var(--sp-2)" }}>
          <span style={{ font: "var(--w-regular) var(--size-micro)/1.4 var(--font-core)",
            color: "var(--text-faint)" }}>{note}</span>
        </div>
      )}
    </div>
  );
}

/** The elo line. `source` names where the points came from - see below. */
function EloTrend({ points, source }) {
  if (points.length < 2) return null;
  const W = 640, H = 96;
  const lo = Math.min(...points), hi = Math.max(...points);
  const span = hi - lo || 1;
  const x = i => (i / (points.length - 1)) * W;
  const y = v => H - ((v - lo) / span) * (H - 12) - 6;
  const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <div style={{ padding: "var(--sp-6) var(--sp-7)", borderTop: "1px solid var(--w-06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        {/* Not "last 30 days", and not one wording for both sources: your own
            line is the matches this client has seen, which is all the protocol
            gives us, while somebody else's is their whole career off
            zero-k.info. Labelling the second as the first was a lie the axis
            could not back up - it spans years, not a session. */}
        <span style={label}>General elo &middot; {source}</span>
        <span style={{ font: "var(--text-ui-sm)", color: "var(--text-mid)",
          fontVariantNumeric: "tabular-nums" }}>
          {Math.round(points[0])} &minus; {Math.round(points[points.length - 1])}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true"
        style={{ marginTop: "var(--sp-4)", display: "block" }}>
        <path d={`${line}L${W},${H}L0,${H}Z`} fill="var(--w-04)" />
        <path d={line} fill="none" stroke="var(--text-hi)" strokeWidth="1.5"
          vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/**
 * What zero-k.info says about a player, which is everything the lobby will not.
 *
 * Only for other people: your own awards and progression already arrive over
 * the socket in `UserProfile`, and asking the website for what the server has
 * already told us would be a request for nothing.
 *
 * The four states are kept apart on purpose. A player with no awards and a page
 * we could not read are different facts, and rendering both as blanks would say
 * they were the same.
 */
/** Rank and level as the lobby broadcast them, for when the site cannot be read. */
function lobbyFacts(lobby) {
  return [
    lobby?.rank && ["Rank", lobby.rank],
    lobby?.level != null && ["Level", String(lobby.level)],
  ].filter(Boolean);
}

function Facts({ rows }) {
  if (!rows.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-7)" }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <span style={label}>{k}</span>
          <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export function FromTheSite({ state, lobby }) {
  // No reader outside the desktop app - the browser demo has no Tauri to ask.
  if (!state) return null;
  if (state.kind === "loading") {
    return (
      <div style={{ padding: "var(--sp-6) var(--sp-7)" }}>
        <span style={label}>Reading zero-k.info…</span>
      </div>
    );
  }
  if (state.kind === "missing") {
    return (
      <div style={{ padding: "var(--sp-6) var(--sp-7)", display: "flex",
        flexDirection: "column", gap: "var(--sp-2)" }}>
        <span style={label}>No zero-k.info account under that name</span>
        {/* Their route is case-sensitive, and this is the failure it causes. */}
        <span style={{ font: "var(--text-ui-sm)", color: "var(--text-faint)" }}>
          Names are case-sensitive there.
        </span>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div style={{ padding: "var(--sp-6) var(--sp-7)", display: "flex",
        flexDirection: "column", gap: "var(--sp-4)" }}>
        <span style={label}>Could not read their zero-k.info page</span>
        {/* What the lobby broadcast still stands. This block is the only place
            rank and level are drawn for somebody else now, so a failed read
            here must not take them with it. */}
        <Facts rows={lobbyFacts(lobby)} />
      </div>
    );
  }

  const p = state.profile;
  const facts = [
    (p.rank || lobby?.rank) && ["Rank", p.rank || lobby.rank],
    (p.level ?? lobby?.level) != null && ["Level", String(p.level ?? lobby.level)],
    p.battlesPlayed != null && ["Battles", p.battlesPlayed.toLocaleString()],
    p.battlesWatched != null && ["Watched", p.battlesWatched.toLocaleString()],
    p.lastLogin && ["Last seen", p.lastLogin],
    p.firstLogin && ["Playing for", p.firstLogin],
  ].filter(Boolean);

  /* The top handful. Twenty-nine award types with a count each is a wall, and
     the ones with the big numbers are the ones that say who somebody is. */
  const awards = (p.awards || []).slice(0, 8);

  return (
    <div style={{ borderTop: "1px solid var(--w-06)" }}>
      {facts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-7)",
          padding: "var(--sp-5) var(--sp-7)" }}>
          {facts.map(([k, v]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              <span style={label}>{k}</span>
              <span style={{ font: "var(--text-num-lg)", color: "var(--text-hi)",
                fontVariantNumeric: "tabular-nums" }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {p.badges?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)",
          padding: "0 var(--sp-7) var(--sp-5)" }}>
          {p.badges.map(b => <Badge key={b} tone="outline">{b}</Badge>)}
        </div>
      )}

      {awards.length > 0 && (
        <div style={{ padding: "0 var(--sp-7) var(--sp-6)" }}>
          <span style={label}>Awards</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-5)",
            marginTop: "var(--sp-4)" }}>
            {awards.map(a => (
              <div key={a.key} style={{ display: "flex", alignItems: "baseline",
                gap: "var(--sp-3)" }}>
                <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>{a.name}</span>
                <span style={{ font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
                  color: "var(--text-mid)", fontVariantNumeric: "tabular-nums" }}>{a.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProfileScreen({ me, users = {}, profile, records = [], viewing,
  onView, onMessage, onAddFriend, onIgnore, onReport, onExternal, matchRows = [], web }) {
  const [query, setQuery] = React.useState("");
  const hits = React.useMemo(() => rankHits(users, query), [users, query]);
  /* What to look up on the site if the directory has nobody. Names there are
     case-sensitive, so this is what was typed, not a normalised version. */
  const typed = query.trim().length >= 2 ? query.trim() : "";

  const isMe = !viewing || viewing === me;
  const name = isMe ? me : viewing;
  const u = users[name];

  /* Yours comes from UserProfile, theirs from the directory. Both may be
     missing pieces; nothing here invents one. */
  /* The web page is the only source for somebody who is offline: there is no
     `User` record for them at all, so without it their card would be a name. */
  const w = web?.kind === "ok" ? web.profile : undefined;
  const level = isMe ? (profile?.Level ?? u?.Level) : (u?.Level ?? w?.level);
  /* `w` is only ever somebody else's page, and only somebody offline has
     nothing but a page - so the icon it carries is the rank we would otherwise
     not have at all. */
  const rank = playerRank({
    icon: u?.Icon ?? w?.rankIcon, rank: isMe ? (profile?.Rank ?? u?.Rank) : u?.Rank,
  });
  /* Zero-K names its ranks; the number is an index into a table nobody outside
     its source has. The page's own wording stands in if the icon did not parse. */
  const rankLabel = rankName(rank) ?? w?.rank;
  const badges = (isMe ? profile?.Badges : u?.Badges) || [];

  /* Somebody else's ratings, and where they can come from.
   *
   * The `User` record is the good source and it exists only while they are
   * connected - so for anybody offline it is not late, it is absent, and no
   * amount of waiting produces one. A zero in it means "no rating" rather than
   * a rating of zero, which is why this reads it the same way userToChip does.
   *
   * zero-k.info is the other source, and it only answers for the general elo:
   * the player page carries no figure at all, but the chart it links to ends at
   * where they are now. We already fetch that series for the trend line, so
   * using it costs no extra request. There is no matchmaker rating on the
   * site at all.
   *
   * Nothing here invents a number, and nothing renders an unknown as a zero. */
  const lobbyElo = u?.EffectiveElo || undefined;
  const lobbyMmElo = u?.EffectiveMmElo || undefined;
  const siteElo = latestRating(web?.kind === "ok" ? web.ratings : undefined);
  /* Why the general elo is a dash, when it is - one branch per way of not
     knowing, because "no rating" and "we could not find out" are different
     facts and a bare dash says both. Nothing when there is nobody to ask: an
     online player with no rating is simply unrated, and the dash is the whole
     answer. */
  const noEloBecause = web?.kind === "loading" ? "reading zero-k.info…"
    : web?.kind === "error" ? "their zero-k.info page could not be read"
      : web?.kind === "missing" ? "no zero-k.info account under that name"
        : web?.kind === "ok" ? "no rating recorded on zero-k.info"
          : undefined;

  const ratings = isMe
    ? [["General elo", profile?.EffectiveElo ?? u?.EffectiveElo],
      ["Matchmaker", profile?.EffectiveMmElo ?? u?.EffectiveMmElo],
      ["Planetwars", profile?.EffectivePwElo]]
    // No Planetwars rating in a User record, so it is not offered at all.
    : [
      ["General elo", lobbyElo ?? siteElo,
        lobbyElo == null && siteElo != null ? "from zero-k.info"
          : lobbyElo == null ? noEloBecause : undefined],
      /* Only ever in the `User` record, so for somebody not connected this is
         not late, it is unobtainable - and saying so beats a dash that reads
         as "unrated". */
      ["Matchmaker", lobbyMmElo,
        lobbyMmElo == null && !u ? "only sent for players who are online" : undefined],
    ];

  const trend = React.useMemo(
    () => (isMe
      ? records.map(r => r.elo).filter(n => typeof n === "number").reverse()
      : (web?.kind === "ok" ? web.ratings || [] : []).map(p => p.elo)),
    [isMe, records, web],
  );

  const open = who => { setQuery(""); if (onView) onView(who === me ? undefined : who); };

  const meta = [
    u?.Country && `${u.Country}${COUNTRIES[u.Country] ? " · " + COUNTRIES[u.Country] : ""}`,
    u?.Faction && (FACTIONS[u.Faction.toLowerCase()] || u.Faction),
    rankLabel,
  ].filter(Boolean);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      {/* Header: where you are, and the way to go somewhere else. */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)",
        padding: "var(--sp-5) var(--sp-7)", borderBottom: "1px solid var(--w-06)" }}>
        {isMe ? <span style={label}>My profile</span> : (
          <>
            <Button variant="ghost" size="sm" icon="arrow-left"
              onClick={() => open(me)}>My profile</Button>
            <span style={label}>Viewing</span>
            <span style={{ font: "var(--text-ui)", color: "var(--text-hi)" }}>{name}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <div style={{ position: "relative", width: 260 }}>
          <Input size="sm" placeholder="Find a player" value={query} icon="search"
            onChange={e => setQuery(e.target.value)}
            /* Enter takes the top online hit, or looks up exactly what was
               typed - which is the only way to reach somebody who is offline. */
            onKeyDown={e => {
              if (e.key !== "Enter") return;
              if (hits[0]) open(hits[0].Name);
              else if (typed) open(typed);
            }} />
          {(hits.length > 0 || typed) && (
            <div style={{ position: "absolute", top: "100%", right: 0, left: 0, zIndex: 40,
              marginTop: 4, background: "var(--surface-panel)",
              border: "1px solid var(--w-12)", boxShadow: "var(--elev-menu)" }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                padding: "var(--sp-3) var(--sp-4)", borderBottom: "1px solid var(--w-06)" }}>
                <span style={label}>{hits.length} online</span>
                <span style={label}>{hits.length ? "Enter opens top hit" : "Enter looks up"}</span>
              </div>
              {hits.map(h => (
                <div key={h.Name} onClick={() => open(h.Name)}
                  style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)",
                    padding: "var(--sp-3) var(--sp-4)", cursor: "pointer",
                    boxShadow: "var(--rule-inset)" }}>
                  <UserChip name={h.Name} clan={h.Clan} country={h.Country}
                    level={h.Level} style={{ flex: 1, minWidth: 0 }} />
                  <span style={label}>{presenceOf(h)}</span>
                </div>
              ))}
              {/* The directory is only who is connected right now. Anyone else
                  has to be looked up by name on zero-k.info, which is the whole
                  reason that reader exists - without this row the profile of an
                  offline player is unreachable. */}
              {typed && (
                /* A real button, not a clickable div: this is the only route to
                   an offline player, and a div is unreachable by keyboard. */
                <button type="button" onClick={() => open(typed)}
                  style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)",
                    width: "100%", padding: "var(--sp-3) var(--sp-4)", cursor: "pointer",
                    boxShadow: "var(--rule-inset)", background: "transparent",
                    border: 0, textAlign: "left", font: "inherit", color: "inherit" }}>
                  <Icon name="search" size={14} style={{ color: "var(--text-faint)" }} />
                  <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)",
                    flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                    Look up {typed}
                  </span>
                  <span style={label}>zero-k.info</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {!name ? <EmptyState icon="user" title="Not logged in." /> : (
        <>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-5)",
            padding: "var(--sp-7)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)" }}>
                <span style={{ font: "var(--w-bold) var(--size-2xl)/1 var(--font-core)",
                  color: "var(--text-hi)" }}>{name}</span>
                {u?.Clan && <span style={{ font: "var(--text-heading)",
                  color: "var(--text-low)" }}>[{u.Clan}]</span>}
                {u?.InGameSince && <Badge tone="outline">In game</Badge>}
                {u?.IsBot && <Badge tone="outline">Bot</Badge>}
                {u?.IsAdmin && <Badge tone="solid">Admin</Badge>}
              </div>
              {meta.length > 0 && (
                <div style={{ display: "flex", gap: "var(--sp-6)", marginTop: "var(--sp-4)" }}>
                  {meta.map(m => <span key={m} style={label}>{m}</span>)}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              {!isMe && onAddFriend && (
                <Button variant="secondary" size="sm" icon="user-plus"
                  onClick={() => onAddFriend(name)}>Add friend</Button>
              )}
              {!isMe && onMessage && (
                <Button variant="ghost" size="sm" icon="message-square"
                  onClick={() => onMessage(name)}>Message</Button>
              )}
              {onExternal && (
                <Button variant="ghost" size="sm" icon="external-link"
                  onClick={() => onExternal(name)}>zero-k.info</Button>
              )}
              {!isMe && onReport && (
                /* Beside Ignore, because they are the two answers to the same
                   problem and only one of them tells anybody. */
                <Button variant="ghost" size="sm" onClick={() => onReport(name)}>Report</Button>
              )}
              {!isMe && onIgnore && (
                <Button variant="ghost" size="sm" onClick={() => onIgnore(name)}>Ignore</Button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", borderTop: "1px solid var(--w-06)",
            borderBottom: "1px solid var(--w-06)" }}>
            {ratings.map(([n, v, note]) => <Rating key={n} name={n} value={v} note={note} />)}
            <div style={{ width: 220, padding: "var(--sp-6) var(--sp-7)",
              display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              {/* Only on your own profile. For anybody else the panel below
                  carries rank and level in a larger listing, and drawing them
                  twice on one screen was the complaint. */}
              {isMe && (
                <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                  {level != null && <Badge tone="outline">Level {level}</Badge>}
                  {/* In the rank's own colour, which is how the game
                      distinguishes ranks at a glance. */}
                  {rankLabel && (
                    <Badge tone="outline" style={{ color: rankColour(rank) }}>{rankLabel}</Badge>
                  )}
                </div>
              )}
              {badges.length > 0 && (
                <>
                  <span style={label}>Badges</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
                    {badges.map(b => (
                      <Badge key={b} tone="outline">{BADGE_LABELS[b] || b}</Badge>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <EloTrend points={trend}
            source={isMe ? "matches seen this session" : "zero-k.info"} />

          {!isMe && <FromTheSite state={web} lobby={{ rank: rankLabel, level }} />}

          {isMe && matchRows.length > 0 && (
            <div>
              <div style={{ display: "grid",
                gridTemplateColumns: "1fr 90px 90px 80px 90px", gap: "var(--sp-5)",
                padding: "var(--sp-4) var(--sp-7)", borderBottom: "1px solid var(--w-06)" }}>
                {["Map", "Result", "Mode", "Length", "Elo"].map(h =>
                  <span key={h} style={label}>{h}</span>)}
              </div>
              {matchRows.map(m => (
                <div key={m.id} style={{ display: "grid",
                  gridTemplateColumns: "1fr 90px 90px 80px 90px", gap: "var(--sp-5)",
                  alignItems: "center", padding: "var(--sp-4) var(--sp-7)",
                  boxShadow: "var(--rule-inset)" }}>
                  <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                    color: "var(--text-body)", overflowWrap: "anywhere" }}>{m.map || "-"}</span>
                  <span style={{ font: "var(--text-ui-sm)", color: "var(--text-hi)" }}>{m.result}</span>
                  <span style={label}>{m.mode || "-"}</span>
                  <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                    color: "var(--text-low)" }}>{m.elapsed || "-"}</span>
                  <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                    color: m.change > 0 ? "var(--signal-ok)" : "var(--text-low)",
                    fontVariantNumeric: "tabular-nums" }}>
                    {m.change == null ? "-" : (m.change > 0 ? "+" : "") + Math.round(m.change)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* The protocol has no match history, so this fills as you play
              rather than arriving populated. Saying that beats a blank half a
              screen tall. */}
          {isMe && matchRows.length === 0 && (
            <div style={{ padding: "var(--sp-8)" }}>
              <EmptyState icon="trophy" title="No matches yet."
                body="Games you play while Shiro is open are listed here." />
            </div>
          )}

          {/* Deliberately absent rather than empty: games played, win rate,
              hours and best elo are in the design but in no message the server
              sends. */}
          {!isMe && (
            <div style={{ padding: "var(--sp-6) var(--sp-7)" }}>
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
                color: "var(--text-faint)" }}>
                Match history and progression are only available for your own account.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
