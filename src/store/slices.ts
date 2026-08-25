/**
 * Fan-out registry for feature store slices.
 *
 * The core lobby store (store/lobby.ts) owns connection state, users and
 * battles. Feature areas - chat, matchmaker, battle history - each own a
 * separate store file and subscribe here, so several people can work on them
 * without colliding in one giant reducer.
 *
 * A slice registers itself at module load:
 *
 *   registerSlice(messages => useChat.getState().applyBatch(messages));
 *
 * session.ts calls fanout() once per animation frame with the same batch the
 * core store receives. A throwing slice is logged and isolated - one broken
 * feature must not take the connection down with it.
 */
import type { Message } from "../protocol/registry";

export type SliceApply = (messages: Message[]) => void;

const slices = new Set<SliceApply>();

export function registerSlice(fn: SliceApply): () => void {
  slices.add(fn);
  return () => {
    slices.delete(fn);
  };
}

export function fanout(messages: Message[]): void {
  for (const fn of slices) {
    try {
      fn(messages);
    } catch (err) {
      console.error("store slice threw while applying a batch:", err);
    }
  }
}

/** Test helper - drop every registration. */
export function resetSlices(): void {
  slices.clear();
}
