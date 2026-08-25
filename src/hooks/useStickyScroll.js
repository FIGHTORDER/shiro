import React from "react";

/**
 * Keeps a scroll container pinned to the newest content — but only while the
 * reader is already at the bottom.
 *
 * The naive version of this ("scroll to bottom whenever messages change") is
 * worse than doing nothing: it yanks you out of the history you scrolled up to
 * read, every time anyone says anything. So we track whether the reader is
 * near the bottom and only follow when they are.
 *
 * `resetKey` (channel or room id) jumps to the bottom instantly and re-pins,
 * because switching conversations should always land on the newest message.
 *
 * Layout effects, not effects: scrolling after paint shows a visible jump.
 */

/** How close to the bottom still counts as "at the bottom", in px. */
const THRESHOLD = 48;

export function useStickyScroll({ count, resetKey }) {
  const ref = React.useRef(null);
  /** Ref, not state: reading it must never lag behind a scroll event. */
  const stuck = React.useRef(true);
  const [pinned, setPinned] = React.useState(true);

  const atBottom = el => el.scrollHeight - el.scrollTop - el.clientHeight <= THRESHOLD;

  const onScroll = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const now = atBottom(el);
    if (now !== stuck.current) {
      stuck.current = now;
      setPinned(now);
    }
  }, []);

  const jump = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stuck.current = true;
    setPinned(true);
  }, []);

  // Switching conversation: land on the newest message with no animation. This
  // also covers first paint, where the post-login flood replays ~20 backlog
  // messages in one batch and animating through them would look broken.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stuck.current = true;
    setPinned(true);
  }, [resetKey]);

  // New content: follow it only if the reader had not scrolled away.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !stuck.current) return;
    el.scrollTop = el.scrollHeight;
  }, [count]);

  return { ref, onScroll, pinned, jump };
}
