/**
 * The Codex's data, and the rules for sorting and filtering it.
 *
 * Here rather than in the screen because a `.jsx` cannot be imported by a test,
 * and everything below is the part that can be wrong in a way nobody notices:
 * which units count as structures, what a unit's role is, how a search matches.
 *
 * ## Where it comes from
 *
 * Two generated files, kept apart because their licences differ:
 *
 * - `src/data/codex.json` - read out of the game archive by
 *   `tools/gen-codex.mjs`, stamped with the build it came from.
 * - `src/data/codex-prose.json` - the Zero-K wiki, **CC BY-SA**, fetched by
 *   `tools/gen-codex-prose.mjs`. It has to carry attribution wherever it shows.
 *
 * Both are loaded on demand rather than imported at the top, so a player who
 * never opens the Codex never pays for 170 KB of it.
 */

export interface Weapon {
  damage?: number;
  range?: number;
  reload?: number;
}

export interface Unit {
  id: string;
  name: string;
  /** The game's own one-line description, e.g. "Light Raider Bot". */
  description?: string;
  cost?: number;
  health?: number;
  speed?: number;
  sight?: number;
  icon?: string;
  model?: string;
  weapon?: Weapon;
  factory?: string;
  factoryId?: string;
}

export interface Prose {
  title: string;
  summary?: string;
  description?: string;
  /** One point per paragraph the wiki's tactics section carries. */
  tactics?: string[];
}

export interface StatChange {
  name: string;
  fields: Record<string, [number | null, number | null]>;
}

export interface ChangeEntry {
  game: string;
  previous: string;
  recorded: string;
  changed: Record<string, StatChange>;
  added: { id: string; name: string }[];
  removed: { id: string; name: string }[];
}

export interface Codex {
  /** The game build the numbers were read from. */
  game: string;
  units: Unit[];
  prose: Record<string, Prose>;
  proseLicence: { licence: string; licenceUrl: string; source: string };
  changes: ChangeEntry[];
}

/**
 * The roles the game names, longest first.
 *
 * Zero-K does not store a role field; it writes one into the unit's own
 * description ("Light Raider Bot", "Anti-Air Missile Truck"). Matching longest
 * first matters: "Anti-Air" contains no other role, but a shorter pattern
 * checked earlier would claim a unit that a longer one describes better.
 */
const ROLES = [
  "Skirmisher", "Constructor", "Transport", "Anti-Air", "Artillery",
  "Gunship", "Assault", "Bomber", "Fighter", "Jammer", "Raider",
  "Scout", "Shield", "Riot", "Cloak", "Support",
];

/** A unit's role, from the description the game gives it. */
export function roleOf(unit: Unit): string | undefined {
  const d = unit.description;
  if (!d) return undefined;
  const lower = d.toLowerCase();
  for (const role of ROLES) {
    if (lower.includes(role.toLowerCase())) return role;
  }
  return undefined;
}

/**
 * Whether this is a structure rather than a unit.
 *
 * Speed, not the factory: a unit with no factory might merely be one nothing
 * builds, while a thing that cannot move is a building whatever made it. That
 * also puts factories themselves on the Structures side, which is where
 * somebody looking for one would go.
 */
export function isStructure(unit: Unit): boolean {
  return !unit.speed;
}

/** Every factory that owns at least one unit, in alphabetical order. */
export function factories(units: Unit[]): string[] {
  return [...new Set(units.map(u => u.factory).filter(Boolean) as string[])].sort();
}

/** Every role present, ordered by how many units have it. */
export function roles(units: Unit[]): string[] {
  const count = new Map<string, number>();
  for (const u of units) {
    const r = roleOf(u);
    if (r) count.set(r, (count.get(r) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(e => e[0]);
}

export interface Filter {
  search?: string;
  factory?: string;
  role?: string;
}

/**
 * Search matches the name, the internal name and the description.
 *
 * The internal name is in there because it is what the wiki, the start scripts
 * and half the community actually use: somebody typing "cloakraid" means the
 * Glaive and should not be told there is no such unit.
 */
export function matches(unit: Unit, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return unit.name.toLowerCase().includes(q)
    || unit.id.includes(q)
    || (unit.description ?? "").toLowerCase().includes(q);
}

export function filterUnits(units: Unit[], f: Filter): Unit[] {
  return units.filter(u =>
    (!f.factory || u.factory === f.factory)
    && (!f.role || roleOf(u) === f.role)
    && matches(u, f.search ?? ""));
}

export type SortKey = "name" | "cost" | "health" | "speed";

/**
 * Sorted, with anything the key does not apply to last.
 *
 * A structure has no speed and a wreck has no cost, so sorting those to the top
 * as zero would put the least interesting rows exactly where the eye lands.
 *
 * **A cost of zero counts as "does not apply", not as "free".** Nothing a
 * player can build costs nothing; a zero is the game's way of saying this is
 * not bought. Chicken units are the whole PvE roster and every one of them is
 * zero, so without this the default cost-ascending list opens on twenty-five
 * chickens before the first thing anybody can build. They are still there, and
 * still searchable - they are just not the answer to "what is cheapest".
 */
function rank(unit: Unit, key: SortKey): number | undefined {
  const v = unit[key] as number | undefined;
  if (v === undefined) return undefined;
  if (key === "cost" && v === 0) return undefined;
  return v;
}

export function sortUnits(units: Unit[], key: SortKey): Unit[] {
  const out = [...units];
  if (key === "name") return out.sort((a, b) => a.name.localeCompare(b.name));
  return out.sort((a, b) => {
    const x = rank(a, key), y = rank(b, key);
    if (x === undefined && y === undefined) return a.name.localeCompare(b.name);
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return x - y || a.name.localeCompare(b.name);
  });
}

/** Every recorded change to one unit, newest first. */
export function changesFor(codex: Codex, id: string): { entry: ChangeEntry; change: StatChange }[] {
  const out = [];
  for (const entry of codex.changes) {
    const change = entry.changed[id];
    if (change) out.push({ entry, change });
  }
  return out;
}

/** Load the generated data. Dynamic so it is not in the main bundle. */
export async function loadCodex(): Promise<Codex> {
  const [units, prose, changes] = await Promise.all([
    import("../data/codex.json"),
    import("../data/codex-prose.json"),
    /* Ships empty and stays that way until a game update is recorded, so it is
       always present and never a special case at load. */
    import("../data/codex-changes.json"),
  ]);
  const u = (units as { default: { game: string; units: Unit[] } }).default;
  const p = (prose as { default: { prose: Record<string, Prose>; licence: string; licenceUrl: string; source: string } }).default;
  const c = (changes as { default: { entries?: ChangeEntry[] } }).default;
  return {
    game: u.game,
    units: u.units,
    prose: p.prose,
    proseLicence: { licence: p.licence, licenceUrl: p.licenceUrl, source: p.source },
    changes: c.entries ?? [],
  };
}
