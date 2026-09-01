/**
 * The maths behind the galaxy map: pan, zoom, and where a planet lands.
 *
 * Here rather than in the screen because a `.jsx` cannot be imported by a test,
 * and this is the part that is wrong in ways nobody notices - a zoom that
 * drifts away from the cursor, a pan that lets the galaxy leave the window, a
 * planet a pixel off from the line drawn to it.
 *
 * The campaign gives normalised coordinates: `mapDisplay.x` and `.y` are 0..1
 * across the galaxy image. Everything below turns those into screen pixels and
 * back, and knows nothing about React.
 */

export interface View {
  /** Scale. 1 means the galaxy exactly fills the viewport. */
  zoom: number;
  /** Pan, in viewport pixels, applied after the zoom. */
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

export const HOME: View = { zoom: 1, x: 0, y: 0 };

/* `+ 0` turns a negative zero back into zero. `Math.max(-0, -50)` is `-0`, and
   a view carrying one compares unequal to a fresh `{x: 0}` under every strict
   equality React and the tests use - so the map re-renders forever on a value
   that is numerically identical. */
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n)) + 0;

/**
 * Keep the galaxy covering the viewport.
 *
 * At zoom 1 there is nothing to pan, so the offset is pinned to zero rather
 * than merely limited - otherwise a flick of the wheel leaves a strip of empty
 * background that the player has to drag back, and which looks like a bug.
 */
export function clampView(view: View, size: Size): View {
  const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
  const slackX = (size.width * zoom - size.width) / 2;
  const slackY = (size.height * zoom - size.height) / 2;
  return {
    zoom,
    x: clamp(view.x, -slackX, slackX),
    y: clamp(view.y, -slackY, slackY),
  };
}

/**
 * Zoom about a point, keeping whatever is under it in place.
 *
 * The obvious implementation - change the zoom and leave the pan alone - zooms
 * about the centre, so the planet the player is pointing at slides away from
 * the cursor exactly when they are trying to look at it.
 */
export function zoomAt(view: View, size: Size, factor: number, at: { x: number; y: number }): View {
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  // Where the cursor is relative to the centre, before and after.
  const fromCentreX = at.x - size.width / 2;
  const fromCentreY = at.y - size.height / 2;
  const scale = zoom / view.zoom;
  return clampView(
    {
      zoom,
      x: fromCentreX - (fromCentreX - view.x) * scale,
      y: fromCentreY - (fromCentreY - view.y) * scale,
    },
    size,
  );
}

/** Where a planet's normalised position lands on screen. */
export function place(
  at: { x?: number; y?: number }, view: View, size: Size,
): { x: number; y: number } {
  // Normalised to centred pixels, then scaled, then panned.
  const cx = ((at.x ?? 0.5) - 0.5) * size.width;
  const cy = ((at.y ?? 0.5) - 0.5) * size.height;
  return {
    x: size.width / 2 + cx * view.zoom + view.x,
    y: size.height / 2 + cy * view.zoom + view.y,
  };
}

/**
 * How big to draw a planet.
 *
 * Scaled by less than the zoom - the square root - so that zooming in spreads
 * the planets out to be clicked without turning them into circles that swallow
 * the map. `size` is the campaign's own figure and varies per planet.
 */
export function radius(size: number | undefined, view: View): number {
  const base = typeof size === "number" && size > 0 ? size : 44;
  return (base / 2) * Math.sqrt(view.zoom);
}

/**
 * The planet under a point, or nothing.
 *
 * Nearest wins, not first: planets overlap at low zoom, and picking the first
 * match means the one drawn earliest always wins even when the player is
 * clearly pointing at its neighbour.
 */
export function planetAt(
  point: { x: number; y: number },
  planets: { id: number; at: { x?: number; y?: number }; size?: number }[],
  view: View,
  size: Size,
): number | undefined {
  let best: number | undefined;
  let bestDistance = Infinity;
  for (const planet of planets) {
    const screen = place(planet.at, view, size);
    const r = radius(planet.size, view);
    const dx = point.x - screen.x;
    const dy = point.y - screen.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= r && distance < bestDistance) {
      best = planet.id;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Centre the view on one planet, at a readable zoom.
 *
 * Used when a planet is chosen from somewhere other than the map - the keyboard,
 * or arriving on the screen with one already selected - so that the selection
 * is somewhere the player can see.
 */
export function focus(at: { x?: number; y?: number }, size: Size, zoom = 2.5): View {
  const cx = ((at.x ?? 0.5) - 0.5) * size.width;
  const cy = ((at.y ?? 0.5) - 0.5) * size.height;
  return clampView({ zoom, x: -cx * zoom, y: -cy * zoom }, size);
}
