import React from "react";

export { thumbAspect } from "../net/zkcatalogue.ts";

/**
 * The picture box a map thumbnail sits in, and how the picture fits it.
 *
 * Maps are not all one shape - Icy Run is 12x4 and Comet Catcher Redux is
 * 12x16 - so a grid that lets each picture set its own height has rows of
 * different heights and a card that is ten times taller than its neighbour.
 * The well fixes the box and the picture is letterboxed inside it.
 *
 * Shared by the map browser and the battle room's map picker, which had its
 * own arrangement and got it wrong.
 */

/* Landscape, because most maps are wider than they are tall. */
export const WELL = 4 / 3;

/**
 * Whether the picture should fill the well's width or its height.
 *
 * Wider than the well means width is the binding side; taller means height is.
 * Without an aspect there is nothing to decide, and full width is the sane
 * default.
 */
export function fitTo(aspect, well = WELL) {
  if (!aspect) return { width: "100%", height: "auto" };
  return aspect >= well ? { width: "100%", height: "auto" } : { height: "100%", width: "auto" };
}

export function Well({ ratio = WELL, children }) {
  return (
    <div style={{ aspectRatio: String(ratio), display: "flex", alignItems: "center",
      justifyContent: "center", overflow: "hidden", background: "var(--ink-000)" }}>
      {children}
    </div>
  );
}
