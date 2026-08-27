/**
 * Completing a name in the composer with Tab.
 *
 * Zero-K names are long, cased and often clan-prefixed, and typing one by hand
 * is a small tax paid many times an evening. ZeroKLobby has had this since
 * forever; Shiro let Tab do what Tab does in a browser and move the focus, so
 * pressing it mid-sentence took you out of the box you were typing in.
 *
 * The rules are `ZeroKLobby/MicroLobby/{ChatControl,SendBox}.cs`, reproduced
 * rather than improved on - a completion that behaves differently in the two
 * Zero-K clients is worse than either behaviour:
 *
 * - Nothing happens at the very start of the box, or straight after a space.
 *   There is no word there to complete, and Tab keeps its ordinary meaning.
 * - Matches are name-starts-with first, then name-contains, and the current
 *   room's people come before the wider fallback - all of the room, including
 *   its substring matches, before any of `#zk`. Hence groups rather than one
 *   flat list.
 * - The name replaces the word and nothing is added after it. Upstream appends
 *   no colon, no space; adding one would be a different client's behaviour.
 * - Pressing Tab again cycles to the next match and wraps at the end.
 */

/** Where a cycle got to, so the next Tab can carry on rather than restart. */
export interface Completion {
  text: string;
  caret: number;
  /** The word that was replaced, lowercased. */
  word: string;
  /** The name that was put in, so the next Tab knows what to take back out. */
  name: string;
  /** Which match is showing. */
  index: number;
}

/** Everyone who could be meant, best group first. Duplicates are dropped. */
export function matchesFor(word: string, groups: string[][]): string[] {
  const w = word.toLowerCase();
  if (!w) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const take = (name: string): void => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  for (const group of groups) {
    for (const n of group) if (n.toLowerCase().startsWith(w)) take(n);
    for (const n of group) if (n.toLowerCase().includes(w)) take(n);
  }
  return out;
}

/**
 * The next completion, or `null` to let Tab do its ordinary job.
 *
 * `prev` is what this returned last time. When the box still holds exactly that,
 * Tab is a request for the *next* match rather than a fresh completion - which
 * is what makes cycling work without this function holding any state itself.
 */
export function completeAt(
  text: string,
  caret: number,
  groups: string[][],
  prev?: Completion,
): Completion | null {
  // Nothing to complete at the start of the box, or after a space.
  if (caret <= 0 || /\s/.test(text[caret - 1] ?? "")) return null;

  const cycling = Boolean(prev && prev.text === text && prev.caret === caret);
  const before = text.slice(0, caret);
  const after = text.slice(caret);

  /* When cycling, the word to look up is the one that was replaced - the box
     now holds a name, and completing *that* would find a different person. */
  const typed = cycling ? (prev as Completion).word : before.slice(before.lastIndexOf(" ") + 1);
  if (!typed) return null;

  const matches = matchesFor(typed, groups);
  if (!matches.length) return null;

  /* The candidates are the live room roster, so people leave between one Tab
     and the next and the list is a different list each time. Where we got to
     may name nobody in the new one; that is a cycle starting over, not an
     error. Reading the old index out of the new list threw. */
  const at = cycling ? (prev as Completion).index : -1;
  const index = at >= 0 && at < matches.length ? (at + 1) % matches.length : 0;
  const name = matches[index];
  /* On a cycle the head is whatever sat before the name we put in last time -
     measured from that name's length, not from a space that may now be inside
     a name. The name comes from `prev` rather than from the list, which is why
     a departure cannot move it. */
  const head = cycling
    ? before.slice(0, before.length - (prev as Completion).name.length)
    : before.slice(0, before.length - typed.length);

  return {
    text: head + name + after,
    caret: head.length + name.length,
    word: typed.toLowerCase(),
    name,
    index,
  };
}
