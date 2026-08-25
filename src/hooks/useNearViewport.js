import React from "react";

/**
 * Whether this card has come near enough to the viewport to be worth a picture.
 *
 * 343 cards is 343 image requests, and asking for all of them on the frame the
 * screen opens is two megabytes of thumbnails for the dozen anybody can see.
 * The observer is armed once and disarmed for good: scrolling back up must not
 * ask the network for a picture the browser already has decoded.
 */
export function useNearViewport(ref) {
  const [near, setNear] = React.useState(false);
  React.useEffect(() => {
    if (near) return undefined;
    const el = ref.current;
    // No observer - an old webview, or a test harness - means draw everything.
    if (!el || typeof IntersectionObserver !== "function") { setNear(true); return undefined; }
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) setNear(true); },
      { rootMargin: "400px" },        // a screenful of warning, so it is loaded on arrival
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, ref]);
  return near;
}
