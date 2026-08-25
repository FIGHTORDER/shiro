/**
 * Wire encoding for the ZkLobbyServer protocol, plus the merge rule that the
 * rest of the client depends on.
 *
 * Format: `CommandName {json}\n` - UTF-8, newline delimited, split on the FIRST
 * space only. See docs/ARCHITECTURE.md section 2.
 */
import {
  isCommandName,
  type CommandName,
  type Message,
  type MessageMap,
} from "./registry.ts";

/**
 * Decode one line. Returns null for blank lines, unknown commands and malformed
 * JSON rather than throwing: the server is free to add commands we do not know
 * about yet, and one bad line must never take down the connection.
 */
export function parseLine(line: string): Message | null {
  const trimmed = line.trimEnd();
  if (!trimmed) return null;

  const sp = trimmed.indexOf(" ");
  const cmd = sp < 0 ? trimmed : trimmed.slice(0, sp);
  if (!isCommandName(cmd)) return null;

  const json = sp < 0 ? "{}" : trimmed.slice(sp + 1);
  try {
    return { cmd, data: JSON.parse(json) } as Message;
  } catch {
    return null;
  }
}

/** Encode one command. The trailing newline is added by the Rust relay. */
export function serialize<K extends CommandName>(cmd: K, data: MessageMap[K]): string {
  return `${cmd} ${JSON.stringify(data)}`;
}

/**
 * Apply a partial server patch to existing state.
 *
 * THIS IS THE MOST IMPORTANT FUNCTION IN THE CLIENT. The server serializes with
 * NullValueHandling.Ignore, so any field that has not changed is OMITTED from
 * the JSON entirely - it does not arrive as null. A naive `{...base, ...patch}`
 * is *almost* right, but silently reintroduces `undefined` for absent keys when
 * the patch object has them explicitly set, which blanks live state.
 *
 * Rule: a key absent from the patch, or present with value `undefined`, means
 * "unchanged" and preserves the base value. An explicit `null` is a real value
 * and is written through (the server does not currently send one, but if it
 * starts, "cleared" is the only sane reading).
 */
export function mergePatch<T extends object>(base: T | undefined, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const key of Object.keys(patch)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    out[key] = value;
  }
  return out as T;
}
