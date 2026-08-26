import React from "react";

/**
 * The Shiro mark, inline so a skin can colour it.
 *
 * It used to be an `<img>` pointing at logo-mark.svg. An external SVG is its
 * own document and cannot see the page's custom properties, so the mark could
 * only ever be one colour, and a dark skin recoloured it by inverting the whole
 * image (`--logo-filter`). That works for one tone and nothing else.
 *
 * Inline, each part takes its own token. All three default to `--text-hi`,
 * which is already black on the light skins and white on the dark ones - so
 * every existing skin draws exactly what it drew before, without the filter.
 * A skin that wants a tri-tone mark sets the three.
 *
 * The geometry is unchanged from the file, to the digit.
 */
export default function LogoMark({ size = 100, style }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none"
      aria-hidden="true" focusable="false"
      style={{ display: "block", flex: "0 0 auto", ...style }}>
      {/* The ring. Its own tone, because it is the part that can carry a
          lighter colour without the mark losing its shape. */}
      <circle cx="50" cy="50" r="43" strokeWidth="4.5"
        stroke="var(--logo-ring, var(--text-hi))" />
      {/* The spine and the upper edge read as one stroke, so they share a tone. */}
      <path d="M27.5 14h6v72h-6z" fill="var(--logo-ink, var(--text-hi))" />
      <path d="M35.33 51.36 71.23 17.36 66.77 12.64 30.87 46.64z"
        fill="var(--logo-ink, var(--text-hi))" />
      {/* The lower blade is the largest mass and the one an accent belongs on. */}
      <path d="M33.5 46.2 79 71.3 45.6 85.2z" fill="var(--logo-accent, var(--text-hi))" />
    </svg>
  );
}
