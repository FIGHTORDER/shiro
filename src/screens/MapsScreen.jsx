import React from "react";
import { Button, Input, Select, Checkbox, Badge, MapImage, EmptyState } from "../ds/shiro.js";
import {
  KINDS, RATING_MAX, canSearchLibrary, findMaps, minimapRatio,
  normaliseMapName, ratingOf, ratingRanker, sizeOf, suitedTo,
} from "../net/zkcatalogue.ts";
import Map3DDialog from "./Map3DDialog.jsx";
import { useNearViewport } from "../hooks/useNearViewport.js";

/* Zero-K's map library.
 *
 * A grid, not a list. The minimap is the thing a player recognises - nobody
 * reads "Comet Catcher Redux v3.1" and pictures it, everybody recognises the
 * picture - and a 32px row spent that recognition on a thumbnail too small to
 * use. The catalogue's other fifteen fields fit under the picture instead of
 * fighting it for a shared column, which is also what fixes the alignment: the
 * old header row lined labels up against per-row content of unknown width, over
 * a list with its own scrollbar, so nothing ever met its heading.
 *
 * This is deliberately not a content browser in the sense DOWNLOADS.md rules
 * out. Nothing here installs or deletes anything; it is the map list you would
 * otherwise open zero-k.info to read, with the one action a lobby can offer -
 * host a room on it.
 *
 * What this screen shows is Zero-K's *curated* set - 343 Featured and
 * MatchMaker maps, which is what `GetPublicCommunityInfo` publishes and is not
 * every map anybody plays. The screen says so rather than implying otherwise,
 * and a search that finds nothing in the catalogue falls through to the live
 * search over the whole library, whose results are visibly thinner because the
 * service tells us far less about them.
 */

const SORTS = [
  { value: "rating", label: "Best rated" },
  { value: "name", label: "Name" },
  { value: "size", label: "Largest" },
];

/* Cards are wide enough for a legible minimap and narrow enough that the whole
   catalogue is a few scrolls rather than a few hundred. */
const CARD_MIN = 172;

/* The picture well every card shares, so rows of cards line up whatever shape
   the maps are. Landscape, because most maps are wider than they are tall. */
const WELL = 4 / 3;

// ------------------------------------------------------------------ rating ---

/* A five-pointed star in a 16x16 box, so five of them tile a 80x16 viewBox. */
const STAR = "M8 .5 9.88 5.41 15.13 5.68 11.04 8.99 12.41 14.07 8 11.2 "
  + "3.59 14.07 4.96 8.99 .87 5.68 6.12 5.41Z";

function StarRow({ fill, width }) {
  return (
    <svg width={width} height={width / RATING_MAX} viewBox={`0 0 ${16 * RATING_MAX} 16`}
      aria-hidden="true" focusable="false" style={{ display: "block" }}>
      {Array.from({ length: RATING_MAX }, (_, i) => (
        <path key={i} d={STAR} transform={`translate(${i * 16} 0)`} fill={fill} />
      ))}
    </svg>
  );
}

/**
 * The community score, drawn so it does not need a legend.
 *
 * It used to be the bare mean, and "4.7" beside a map name is unreadable
 * without knowing what the top of the scale is - the owner's exact complaint.
 * Five stars filled to the score says "out of five" without saying it, which is
 * how zero-k.info draws the same number on the map's own page.
 *
 * The vote count sits next to it because the two are one claim: 4.7 from 92
 * votes and 4.7 from 4 are not the same recommendation.
 */
function Stars({ map, width = 50, showNumber }) {
  const mean = ratingOf(map);
  if (mean === undefined) {
    /* Said out loud rather than left blank. An unrated map and a map everybody
       disliked look identical if the score is simply missing, and the two are
       opposite advice. */
    return <span className="lab" style={{ color: "var(--text-faint)" }}>UNRATED</span>;
  }
  const filled = Math.max(0, Math.min(1, mean / RATING_MAX)) * 100;
  return (
    <span
      role="img"
      aria-label={`${mean.toFixed(1)} out of ${RATING_MAX}, from ${map.ratingCount} votes`}
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
      <span style={{ position: "relative", display: "block", width, height: width / RATING_MAX,
        flex: "0 0 auto" }}>
        <StarRow fill="var(--w-20)" width={width} />
        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${filled}%`,
          overflow: "hidden" }}>
          <StarRow fill="var(--text-hi)" width={width} />
        </span>
      </span>
      {showNumber && (
        <span style={{ font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
          color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>
          {mean.toFixed(1)}
        </span>
      )}
      <span style={{ font: "var(--w-regular) var(--size-micro)/1 var(--font-mono)",
        color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
        ({map.ratingCount})
      </span>
    </span>
  );
}

// ------------------------------------------------------------------- cards ---

/**
 * Fit a picture of known proportions inside a well without cropping.
 *
 * `MapImage` covers, so the only way to see a whole map is to hand it a box of
 * the picture's own shape and let it sit letterboxed in the well. When the
 * service did not say how big the map is, the picture keeps its intrinsic shape
 * instead - which the browser knows once it has the file.
 */
function fitTo(aspect, well) {
  if (!aspect) return { width: "100%", height: "auto" };
  return aspect >= well ? { width: "100%", height: "auto" } : { height: "100%", width: "auto" };
}

function Well({ ratio = WELL, children }) {
  return (
    <div style={{ aspectRatio: String(ratio), display: "flex", alignItems: "center",
      justifyContent: "center", overflow: "hidden", background: "var(--ink-000)" }}>
      {children}
    </div>
  );
}

/* Hairlines on the cards rather than gaps in the grid. A one-pixel gap over a
   dark ground draws the separators for free, but it also paints the empty half
   of the last row - a grey block where the grid ran out of maps. */
const CARD = {
  display: "flex", flexDirection: "column", cursor: "pointer",
  borderRight: "1px solid var(--w-12)", borderBottom: "1px solid var(--w-12)",
};

/* `alignContent: start` so a grid with four maps in it is four cards tall
   rather than four cards stretched down the screen. */
const GRID = { display: "grid", alignContent: "start" };

/**
 * The map's own page on zero-k.info.
 *
 * `/Maps/Detail?name=` is ignored by the site - a real map, a nonsense one and
 * an empty one all return a byte-identical generic page - so the detail page
 * needs the numeric ResourceID. Without one, `?search=` is relevance-ordered
 * and puts the right map first.
 *
 * Written here rather than handed to `MapImage`'s own `link`, because that
 * draws its chip over the picture: a 12x4 map is a 33px strip of pale ice and
 * the chip is 75% white on top of it. The link lives on the well instead, where
 * the ground is always dark. `net/external.ts` intercepts any anchor, so this
 * reaches the browser the same way the design system's own link does.
 */
function pageFor(map) {
  return map.resourceId
    ? `https://zero-k.info/Maps/Detail/${map.resourceId}`
    : `https://zero-k.info/Maps?search=${encodeURIComponent(String(map.name).replace(/_/g, " "))}`;
}

function CardShell({ selected, onClick, title, children, refEl }) {
  return (
    <div ref={refEl} onClick={onClick} title={title}
      style={{ ...CARD, background: selected ? "var(--surface-selected)" : "var(--surface-base)" }}>
      {children}
    </div>
  );
}

function CardName({ children }) {
  return (
    <span style={{ font: "var(--text-ui-sm)", color: "var(--text-hi)", overflow: "hidden",
      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
  );
}

/* Height reserved even when a map is flagged for nothing, so the line below it
   sits at the same height on every card in the row. Sixty of the 343 are
   flagged for nothing, so this is most rows. */
const BADGES = { display: "flex", gap: "var(--sp-2)", minHeight: 17, overflow: "hidden" };

/**
 * The kind, with the one player count the catalogue publishes folded in.
 *
 * Only the badge text: `suitedTo` still answers in bare kinds, which is what
 * the tickboxes match on. The old code put the count inside the string the
 * filter compared against, so rewording a badge would have silently stopped a
 * filter working.
 */
function badgeFor(kind, map) {
  return kind === "FFA" && map.ffaMaxTeams ? `${map.ffaMaxTeams}-way FFA` : kind;
}

function MapCard({ map, selected, onClick }) {
  const ref = React.useRef(null);
  const near = useNearViewport(ref);
  const aspect = map.width && map.height ? map.width / map.height : undefined;
  return (
    <CardShell refEl={ref} selected={selected} onClick={onClick} title={map.name}>
      <Well>
        {/* Thumbnails, not minimaps. Same picture, and the only one of the two
            drawn in the map's real proportions - `.minimap.jpg` squares them,
            see minimapRatio. About six kilobytes against fifty, too, which over
            a 343-card grid is two megabytes rather than seventeen, and the
            battle list already asks for these so many are in hand. */}
        {near && <MapImage map={map.name} kind="thumbnail" ratio={aspect} saturate={1}
          style={fitTo(aspect, WELL)} />}
      </Well>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)",
        padding: "var(--sp-4)", minWidth: 0 }}>
        <CardName>{map.name}</CardName>
        <div style={BADGES}>
          {map.supportLevel === "MatchMaker" && <Badge tone="solid">MM</Badge>}
          {suitedTo(map).map(k => <Badge key={k} tone="outline">{badgeFor(k, map)}</Badge>)}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: "var(--sp-3)" }}>
          <span style={{ font: "var(--w-regular) var(--size-micro)/1 var(--font-mono)",
            color: "var(--text-mid)", fontVariantNumeric: "tabular-nums",
            minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sizeOf(map) ?? "size unknown"}
          </span>
          <Stars map={map} />
        </div>
      </div>
    </CardShell>
  );
}

/**
 * A map the catalogue does not list, found by searching the whole library.
 *
 * Deliberately thinner than a `MapCard`, because what is known about it really
 * is thinner: `FindResourceData` sends a name, a support level, an id and four
 * flags, and no dimensions and no rating at all. Drawing it in the same shape
 * with blanks would read as a map nobody has rated rather than a map nobody has
 * told us about.
 */
function HitCard({ hit, selected, onClick }) {
  const ref = React.useRef(null);
  const near = useNearViewport(ref);
  const kinds = suitedTo(hit);
  return (
    <CardShell refEl={ref} selected={selected} onClick={onClick} title={hit.name}>
      <Well>
        {/* No dimensions to hand it, so the picture keeps whatever shape the
            file turns out to have. */}
        {near && <MapImage map={hit.name} kind="thumbnail" saturate={1}
          style={fitTo(undefined, WELL)} />}
      </Well>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)",
        padding: "var(--sp-4)", minWidth: 0 }}>
        <CardName>{hit.name}</CardName>
        <div style={BADGES}>
          {hit.support === "MatchMaker" && <Badge tone="solid">MM</Badge>}
          {kinds.map(k => <Badge key={k} tone="outline">{k}</Badge>)}
        </div>
        <span className="lab" style={{ color: "var(--text-faint)" }}>NO SIZE OR RATING</span>
      </div>
    </CardShell>
  );
}

// ------------------------------------------------------------------ screen ---

export default function MapsScreen({ maps = [], loading, onHost }) {
  const [sel, setSel] = React.useState(undefined);
  const [show3d, setShow3d] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState("rating");
  const [only, setOnly] = React.useState(() => Object.fromEntries(KINDS.map(k => [k, false])));
  const [mmOnly, setMmOnly] = React.useState(false);
  const [hits, setHits] = React.useState(undefined);

  const list = React.useMemo(() => {
    const wanted = KINDS.filter(k => only[k]);
    const needle = normaliseMapName(q);
    const out = maps.filter(m => {
      if (needle && !normaliseMapName(m.name).includes(needle)) return false;
      if (mmOnly && m.supportLevel !== "MatchMaker") return false;
      if (!wanted.length) return true;
      /* Any of the ticked kinds, not all - somebody looking for a 1v1 or an FFA
         map wants both lists, not the maps that are somehow both. */
      const suited = suitedTo(m);
      return wanted.some(w => suited.includes(w));
    });
    const area = m => (m.width ?? 0) * (m.height ?? 0);
    const rank = ratingRanker(maps);
    out.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "size") return area(b) - area(a);
      /* Rating, with the unrated last rather than first - a missing score is
         not a bad one, but it is not a recommendation either. */
      const ra = rank(a), rb = rank(b);
      if (ra === undefined && rb === undefined) return a.name.localeCompare(b.name);
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return rb - ra;
    });
    return out;
  }, [maps, q, sort, only, mmOnly]);

  /* The rest of the library, asked for only when the curated set has nothing.
     Searching is a round trip to Zero-K per query, so it is the fallback rather
     than the front door - and it is the honest answer to "is this every map",
     because it is the same search the host dialog's map field already uses.

     Only with the tickboxes clear. A search hit carries four flags and never a
     chickens one, so "Chickens" cannot be honoured over the library at all, and
     quietly ignoring a filter is worse than not offering the fallback. */
  const filtersOff = !KINDS.some(k => only[k]) && !mmOnly;
  const searchable = canSearchLibrary()
    && filtersOff && q.trim().length >= 3 && list.length === 0 && !loading;
  React.useEffect(() => {
    if (!searchable) { setHits(undefined); return undefined; }
    let live = true;
    setHits(null);                                   // null is "asking", [] is "nothing"
    const t = setTimeout(() => {
      findMaps(q.trim()).then(
        r => { if (live) setHits(r); },
        () => { if (live) setHits([]); },
      );
    }, 350);                                         // a keystroke is not a query
    return () => { live = false; clearTimeout(t); };
  }, [q, searchable]);

  const current = list.find(m => m.name === sel)
    || (hits || []).find(h => h.name === sel)
    || list[0]
    || (hits || [])[0];
  const fromSearch = Boolean(current) && !list.includes(current);
  const filtered = list.length !== maps.length;

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "200px minmax(0,1fr) 300px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)", padding: "var(--sp-5)",
        borderRight: "1px solid var(--w-12)", background: "var(--surface-sunken)" }}>
        <Input label="Find a map" placeholder="Name" icon="search"
          value={q} onChange={e => setQ(e.target.value)} />
        <Select label="Sort by" value={sort} onChange={e => setSort(e.target.value)} options={SORTS} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          {KINDS.map(k => (
            <Checkbox key={k} label={k} checked={only[k]}
              onChange={e => setOnly({ ...only, [k]: e.target.checked })} />
          ))}
        </div>
        <Checkbox label="Matchmaker set only" checked={mmOnly}
          onChange={e => setMmOnly(e.target.checked)} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {/* Which set this is. The screen used to imply it was every map; it is
            the 343 Zero-K publishes, and saying so is cheaper than a support
            question about a map that is missing but not actually missing. */}
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: "var(--sp-5)",
          padding: "var(--sp-4) var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab">
            {filtered ? `${list.length} OF ${maps.length} MAPS` : `${maps.length} MAPS`}
          </span>
          <span style={{ font: "var(--w-regular) var(--size-micro)/1.4 var(--font-core)",
            color: "var(--text-low)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap" }}>
            Displaying featured maps. Use the search bar to find unfeatured maps.
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {list.length > 0 && (
            <div style={{ ...GRID,
              gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN}px, 1fr))` }}>
              {list.map(m => (
                <MapCard key={m.name} map={m} selected={current && current.name === m.name}
                  onClick={() => setSel(m.name)} />
              ))}
            </div>
          )}

          {list.length === 0 && !(hits && hits.length) && (
            /* Four different nothings, and saying the wrong one sends somebody
               looking for a bug in their filters when the catalogue never
               arrived - or gives up on a map that search would have found. */
            <EmptyState icon="search"
              title={loading ? "Reading Zero-K's map list."
                : maps.length === 0 ? "Zero-K's map list could not be read."
                : hits === null ? `Nothing featured matches "${q.trim()}".`
                : "No map matches that."}
              body={loading ? undefined
                : maps.length === 0
                  ? "It comes from zero-k.info, so this needs a connection."
                  : hits === null ? "Asking Zero-K about the rest of the library…"
                  : hits ? "Not in the featured set, and searching the whole library found nothing either."
                  : !canSearchLibrary()
                    ? "The list is Zero-K's featured and matchmaker set. Searching the rest of the library needs the desktop app."
                  : filtersOff && q.trim()
                    ? "The list is Zero-K's featured and matchmaker set. Three letters searches the rest."
                    : "The list is Zero-K's featured and matchmaker set."} />
          )}

          {hits && hits.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)",
                padding: "var(--sp-4) var(--sp-5)", borderBottom: "1px solid var(--w-12)",
                borderTop: "1px solid var(--w-12)", background: "var(--surface-sunken)" }}>
                <span className="lab">{hits.length} FOUND BY SEARCH</span>
              </div>
              <div style={{ ...GRID,
                gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN}px, 1fr))` }}>
                {hits.map(h => (
                  <HitCard key={h.name} hit={h} selected={current && current.name === h.name}
                    onClick={() => setSel(h.name)} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", minHeight: 0 }}>
        {current ? (
          <>
            {/* The one place the full minimap earns its 50 kB, and the one
                place the picture is a door: on zero-k.info the map has a real
                detail page with heightmap, size and win statistics.

                In a well of its own, because the pictures are not all one
                shape. Icy Run is a 12x4 map and its minimap is 1024x113 - drawn
                to the panel's width that is a 33px strip with the link chip
                sitting on top of it, and drawn square it is a crop of the
                middle. Letterboxed in a landscape well it is a wide strip with
                room around it, and the name below it says which map it is. */}
            <a href={pageFor(current)} target="_blank" rel="noreferrer"
              title={`Open ${current.name} on zero-k.info`}
              style={{ flex: "0 0 auto", display: "block", position: "relative",
                textDecoration: "none" }}>
              <Well ratio={3 / 2}>
                <MapImage map={current.name} kind="minimap"
                  ratio={fromSearch ? undefined : minimapRatio(current)} saturate={1}
                  style={fitTo(fromSearch ? undefined : minimapRatio(current), 3 / 2)} />
              </Well>
              <span style={{ position: "absolute", right: "var(--sp-4)", top: "var(--sp-3)",
                font: "var(--text-label)", letterSpacing: "var(--track-label)",
                textTransform: "uppercase", color: "var(--fff-72)" }}>
                ZERO-K.INFO ↗
              </span>
            </a>
            {/* The flat picture cannot say whether a pass is a pass. This is
                built from the heightmap zero-k.info already publishes, so it
                works for a map nobody has downloaded. */}
            <div style={{ padding: "var(--sp-5) var(--sp-5) 0" }}>
              <Button variant="secondary" size="sm" block icon="eye"
                onClick={() => setShow3d(true)}>View in 3D</Button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-5)",
              display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
              <span style={{ font: "var(--text-heading)", color: "var(--text-hi)",
                overflowWrap: "anywhere" }}>{current.name}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
                {(fromSearch ? current.support : current.supportLevel) === "MatchMaker"
                  && <Badge tone="solid">MM</Badge>}
                {suitedTo(current).map(k =>
                  <Badge key={k} tone="outline">{badgeFor(k, current)}</Badge>)}
                {current.isSpecial && <Badge tone="outline">Special</Badge>}
                {current.isAssymetrical && <Badge tone="outline">Asymmetrical</Badge>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--sp-3) var(--sp-5)" }}>
                <span className="lab">SIZE</span>
                <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>
                  {fromSearch ? "N/A" : (sizeOf(current) ?? "N/A")}
                </span>
                <span className="lab">RATING</span>
                <span>
                  {fromSearch
                    ? <span className="lab" style={{ color: "var(--text-faint)" }}>NOT PUBLISHED</span>
                    : <Stars map={current} width={64} showNumber />}
                </span>
              </div>
              {/* Hills and water level are parsed and kept - they cost nothing -
                  but not drawn: Zero-K documents neither, the numbers are on no
                  stated scale, and a figure nobody can read is worse than a gap.
                  See CatalogueMap in src/net/zkcatalogue.ts. */}
            </div>
            {/* The one thing a lobby can do with a map. Nothing here installs
                or removes content - that is the browser DOWNLOADS.md rules out,
                and this is a list you would otherwise read on the website. */}
            {onHost && (
              <div style={{ padding: "var(--sp-5)", borderTop: "1px solid var(--w-12)" }}>
                <Button variant="primary" size="lg" block icon="plus"
                  onClick={() => onHost(current.name)}>Host on this map</Button>
              </div>
            )}
          </>
        ) : <EmptyState icon="search" title="Nothing selected." />}
      </div>
      <Map3DDialog map={current} open={show3d && Boolean(current)}
        onClose={() => setShow3d(false)} />
    </div>
  );
}
