import React from "react";
import { Button, UserChip, IconButton, Badge, Input, EmptyState } from "../ds/shiro.js";
import magpie from "../assets/art/magpie-banking.png";
import { rankColour, rankName } from "../net/ranks.ts";

/* What the server's badge ids mean, from Chobby's own table
   (LuaMenu/configs/gameConfig/zk/badges.lua). The official client pairs each
   with an icon bundled in its archive; we show the label, which carries the
   meaning without vendoring 369 kB of PNG. An id we do not know is shown as
   itself rather than dropped - the list grows server-side, not here. */
const BADGE_LABELS = {
  player_level: "Level 200",
  player_elo: "Top 3 player",
  donator_0: "Bronze donator",
  donator_1: "Silver donator",
  donator_2: "Gold donator",
  donator_3: "Diamond donator",
  dev_content: "External developer",
  dev_game: "Game developer",
  dev_adv: "Lead developer",
};

const badgeLabel = id => BADGE_LABELS[id] || id;

/* Where the Magpie stops being drawn. Soft, so whatever the bottom of the
   panel turns out to be - the add-a-friend bar, a short window - it is a
   fade rather than a cut across the fuselage. */
const FADE = "linear-gradient(to bottom, #000 62%, transparent 96%)";

/* Screen 8 - friends list and the profile detail: badges, level, three ratings.

   Live, the list is whatever the server sent in `FriendList`, and the detail is
   whatever the selected friend's `User` record carries - which is two of the
   three ratings, and nothing at all once they log off. `UserProfile` is not
   requested and cannot be: it is server-to-client only and only ever about you.
   See src/store/friends.ts. With no handlers this renders the demo roster from
   data.js instead. */
export default function FriendsScreen({ users, profile, profileFor, onSelect, onMessage, onIgnore,
  onReport, onAdd, onRemove }) {
  const [sel, setSel] = React.useState(null);
  const [adding, setAdding] = React.useState("");

  /* Keep the selection valid as people come and go: a friend who logs off is
     still in the list, but one you removed is not. */
  const current = users.find(x => x.name === sel) || users[0];
  React.useEffect(() => {
    if (current && current.name !== sel) setSel(current.name);
    if (current && onSelect) onSelect(current.name);
  }, [current && current.name]);

  const pick = name => { setSel(name); if (onSelect) onSelect(name); };
  const submitAdd = () => {
    const name = adding.trim();
    if (!name || !onAdd) return;
    onAdd(name);
    setAdding("");
  };

  const u = current;

  /* The panel belongs to the row it is drawn under, and to no other.
     `profile` is fetched by name a commit behind the selection, so on the first
     paint of this screen - and for one frame after coming back to it - it is
     either absent or somebody else's. Drawing it anyway put one player's
     ratings under another player's name. */
  const own = profile && (!profileFor || profileFor === (u && u.name)) ? profile : null;

  /* Three ratings, and never one more than we were told.
     The other two used to be derived from the general elo whenever `profile`
     had not caught up - `elo - 76` and `elo + 34`, under the real labels, on
     the live path, indistinguishable from figures the server sent. The general
     elo on the row is real and stands on its own; the rest are dashes until the
     record carrying them is here. docs/PROFILE-AND-SEARCH.md section 5: another
     player's missing fields are not blanks, zeroes, or guesses. */
  const ratings = [
    ["GENERAL ELO", own ? own.elo : u && u.elo],
    ["MATCHMAKER", own ? own.mmElo : u && u.mmElo],
    ["PLANETWARS", own ? own.pwElo : u && u.pwElo],
  ];

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", minHeight: 0 }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* A Magpie banking away behind the roster, filling the dead space a
            friends list leaves: the band between a name and its presence
            label, and the block under the last row.

            Four things about the placement are deliberate. It lives in the
            column rather than inside the scroller, so it stays put while the
            list scrolls over it. It is clipped to the column, so the bleed off
            the bottom edge stays inside the panel instead of running under the
            status bar. It stops short of the right-hand column the presence
            labels sit in - the wing crosses the rows, never the text.

            And it fades out at the bottom rather than simply ending. The
            add-a-friend bar is opaque and only exists when you are logged in,
            so on the live path the plane met a hard horizontal edge across the
            fuselage that looked like a rendering fault. The mask makes the
            crop soft wherever it lands, which also covers window heights
            nobody has tried yet.

            It is dropped entirely when there is nobody to list: art behind an
            empty state reads as a mistake rather than a flourish.

            Rendered from the game's own bomberstrike.s3o. The ink is black, so
            a dark skin has to invert it; --art-filter is that hook. */}
        {users.length > 0 && (
          <div aria-hidden="true" style={{
            position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
          }}>
            <div style={{
              position: "absolute", right: 70, bottom: -30, width: 820, height: 431,
              backgroundImage: `url(${magpie})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: "contain",
              backgroundPosition: "right bottom",
              filter: "var(--art-filter, none)",
              maskImage: FADE,
              WebkitMaskImage: FADE,
              opacity: 0.16,
            }} />
          </div>
        )}
        <div style={{ position: "relative", height: 26, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab">FRIENDS</span>
          <span className="lab">{users.length} TOTAL</span>
        </div>
        <div style={{ position: "relative", flex: 1, minHeight: 0, overflowY: "auto" }}>
          {users.length === 0
            ? <EmptyState icon="users" title="No friends yet."
                body="Add someone by name and they show up here whenever they are online." />
            : users.map(x => (
              <div key={x.name} onClick={() => pick(x.name)}
                style={{ position: "relative", height: "var(--row-tall)", display: "flex", alignItems: "center",
                  gap: "var(--sp-5)", padding: "0 var(--sp-5)", cursor: "pointer",
                  background: u && x.name === u.name ? "var(--surface-selected)" : "transparent",
                  boxShadow: "var(--rule-inset)" }}>
                {/* Same ink as the selected row's text, so it follows a skin. */}
                {u && x.name === u.name && <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: "var(--text-hi)" }} />}
                <UserChip {...x} style={{ flex: 1, minWidth: 0 }} />
                <span className="lab">{x.presence === "ingame" ? "IN GAME" : x.presence === "room" ? "IN ROOM"
                  : x.presence === "away" ? "AWAY" : x.presence === "offline" ? "OFFLINE" : "ONLINE"}</span>
                <IconButton icon="message-square" label="Message" size="sm"
                  onClick={onMessage ? e => { e.stopPropagation(); onMessage(x.name); } : undefined} />
              </div>
            ))}
        </div>
        {onAdd && (
          <div style={{ position: "relative", display: "flex", gap: "var(--sp-3)",
            padding: "var(--sp-4) var(--sp-5)", background: "var(--surface-base)",
            borderTop: "1px solid var(--w-12)" }}>
            <Input placeholder="Add a friend by name" size="sm" value={adding} wrapStyle={{ flex: 1 }}
              onChange={e => setAdding(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitAdd()} />
            <Button variant="quiet" size="sm" onClick={submitAdd}>Add</Button>
          </div>
        )}
      </div>
      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        padding: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
        {!u ? <EmptyState icon="user" title="Nobody selected." /> : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <span className="lab">PROFILE</span>
              <UserChip {...u} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
                <Badge tone="outline">Level {(own && own.level) || u.level || "-"}</Badge>
                {u.admin && <Badge tone="solid">Admin</Badge>}
                {u.bot && <Badge tone="outline">Bot</Badge>}
                {/* The rank by its Zero-K name, in the colour Zero-K draws it. */}
                {own && rankName(own.rank) && (
                  <Badge tone="outline" style={{ color: rankColour(own.rank) }}>
                    {rankName(own.rank)}
                  </Badge>
                )}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--sp-4) var(--sp-6)" }}>
              {ratings.map(([label, value]) => (
                <React.Fragment key={label}>
                  <span className="lab">{label}</span>
                  <span style={{ font: "var(--text-num)", color: "var(--text-hi)", textAlign: "right",
                    fontVariantNumeric: "tabular-nums" }}>{value || "-"}</span>
                </React.Fragment>
              ))}
            </div>
            {own && own.badges && own.badges.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
                <span className="lab">BADGES</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
                  {own.badges.map(b => (
                    <Badge key={b} tone="outline">{badgeLabel(b)}</Badge>
                  ))}
                </div>
              </div>
            )}
            <span style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: "var(--sp-4)" }}>
              <Button variant="secondary" style={{ flex: 1 }}
                onClick={onMessage ? () => onMessage(u.name) : undefined}>Message</Button>
              <Button variant="ghost" style={{ flex: 1 }}
                onClick={onIgnore ? () => onIgnore(u.name) : undefined}>Ignore</Button>
              {onReport && (
                <Button variant="ghost" style={{ flex: 1 }}
                  onClick={() => onReport(u.name)}>Report</Button>
              )}
              {onRemove && (
                <Button variant="ghost" style={{ flex: 1 }} onClick={() => onRemove(u.name)}>Remove</Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
