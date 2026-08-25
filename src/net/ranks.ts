/**
 * Ranks, as Zero-K names and colours them.
 *
 * A rank is an integer 0-7 on the account, and the server sends it: `User.Rank`
 * for anyone online, `UserProfile.Rank` for you, `NewRank` in a debriefing. It
 * is a percentile standing, not a rating band - upstream's `Ranks.Percentiles`
 * cuts at 80/60/40/20/10/5/1% of active players - which is why the number the
 * server sends is the only honest source and Elo is a fallback, not a rule.
 *
 * Both tables below are transcribed from upstream, not sampled or eyeballed:
 *
 *   names   ZeroK-RTS/Zero-K-Infrastructure `ZkData/Ef/WHR/Ranks.cs`,
 *           `Ranks.RankNames` - the same array the website prints in the rank
 *           tooltip and the lobby server prints in `Your Rank (...) is too high`.
 *   colours ZeroK-RTS/Zero-K `LuaUI/Widgets/gui_chili_share.lua`, `rankColors`,
 *           commented there as "RGBA. Used as font color of players' WHR" -
 *           the same thing we do with it. Keyed by `icon:sub(3,3)`, the rank
 *           digit of the `<levelBracket>_<rank>` icon id.
 *
 * The names and the colours are two independent upstream tables and they do not
 * describe each other: rank 1 is called Brown Dwarf and is drawn pure red, rank
 * 2 is called Red Dwarf and is drawn brown. That mismatch is upstream's, and
 * copying it is the point - a "corrected" pairing would stop matching the game.
 */

/**
 * Upstream's `RankNames`, verbatim - nine entries for eight ranks.
 *
 * `Ranks.ValidateRank` accepts 0-7, so Singularity is the top an account can
 * reach; Space Lobster exists only as the *next* rank the website's progress
 * bar names for someone already at the top, and is kept so index 8 is upstream's
 * joke rather than an out-of-range read.
 */
export const RANK_NAMES = [
  "Nebulous",
  "Brown Dwarf",
  "Red Dwarf",
  "Subgiant",
  "Giant",
  "Supergiant",
  "Neutron Star",
  "Singularity",
  "Space Lobster",
] as const;

/** The highest rank an account can hold. Upstream's `ValidateRank` bound. */
export const MAX_RANK = 7;

/**
 * Upstream's `rankColors`, verbatim: 0-1 floats, index = rank.
 *
 * Kept as floats rather than as the hex below them so that this table can be
 * read against the Lua character for character. The hex is derived.
 */
export const RANK_RGB = [
  [0.5, 0.5, 0.5],   // 0
  [1, 0, 0],         // 1
  [0.8, 0.4, 0.1],   // 2
  [1, 0.65, 0],      // 3
  [1, 1, 0],         // 4
  [0.7, 0.8, 1],     // 5
  [0, 0.6, 1],       // 6
  [1, 0, 1],         // 7
] as const;

/** A float channel as a byte, rounded the way a GL colour reaches a pixel. */
function channel(v: number): string {
  return Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
}

/**
 * The eight rank colours as CSS.
 *
 *   0 Nebulous     #808080   4 Giant        #FFFF00
 *   1 Brown Dwarf  #FF0000   5 Supergiant   #B3CCFF
 *   2 Red Dwarf    #CC661A   6 Neutron Star #0099FF
 *   3 Subgiant     #FFA600   7 Singularity  #FF00FF
 */
export const RANK_COLOURS: readonly string[] =
  RANK_RGB.map(([r, g, b]) => `#${channel(r)}${channel(g)}${channel(b)}`);

/**
 * The rank a `<levelBracket>_<rank>` icon id stands for.
 *
 * `User.Icon` is the id the server picked for the account, and it outranks
 * `User.Rank` for the same reason Chobby's `rankFunction.lua` prefers it: when
 * the server has already chosen an icon, that icon is what the official client
 * draws, whatever else the record says.
 */
export function rankFromIcon(icon: string | undefined): number | undefined {
  if (!icon) return undefined;
  const digit = /^\d+_(\d)$/.exec(icon)?.[1];
  if (digit == null) return undefined;
  const rank = Number(digit);
  return rank <= MAX_RANK ? rank : undefined;
}

/**
 * Chobby's Elo fallback: `clamp(floor((elo - 1000) / 200), 0, 7)`.
 *
 * This is what `rankFunction.lua` does when it has no icon to go on, and it is
 * an approximation of a percentile standing by a rating band - close enough to
 * pick an icon, not the rank itself. Only reach for it when the server told us
 * neither an icon nor a rank.
 */
export function skillBracket(elo: number): number {
  return Math.max(0, Math.min(MAX_RANK, Math.floor((elo - 1000) / 200)));
}

/**
 * A player's rank from whatever the server actually sent, best source first.
 *
 * Undefined rather than 0: a player we know nothing about and a player at
 * Nebulous are not the same thing, and one grey for both would say they were.
 */
export function playerRank(
  p: { icon?: string; rank?: number; elo?: number },
): number | undefined {
  const fromIcon = rankFromIcon(p.icon);
  if (fromIcon != null) return fromIcon;
  if (p.rank != null && Number.isInteger(p.rank) && p.rank >= 0 && p.rank <= MAX_RANK) {
    return p.rank;
  }
  if (p.elo != null && Number.isFinite(p.elo)) return skillBracket(p.elo);
  return undefined;
}

/** Zero-K's name for a rank, or undefined when there is no rank to name. */
export function rankName(rank: number | undefined): string | undefined {
  if (rank == null || !Number.isInteger(rank)) return undefined;
  return RANK_NAMES[rank];
}

/** Zero-K's colour for a rank, or undefined when there is no rank to colour. */
export function rankColour(rank: number | undefined): string | undefined {
  if (rank == null || !Number.isInteger(rank)) return undefined;
  return RANK_COLOURS[rank];
}
