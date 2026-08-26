import React from "react";

/* Falling sakura, behind everything, for the skin of the same name.
 *
 * Mounted only when that skin is on, rather than hidden with CSS: an unmounted
 * component costs nothing, and a lobby is a window somebody leaves open all
 * evening. Everything moves in CSS so the work happens off the main thread and
 * no timer runs.
 *
 * Fixed to the viewport rather than drawn per screen. "Every background of
 * every screen" is one layer under all of them, not a layer each - the app
 * shell is the only place that is true in.
 */

/* Enough to read as weather, few enough to stay quiet. Each one is a single
   div, so this is the entire cost of the effect. */
const COUNT = 18;

/* A stable arrangement, computed once. Random per mount would reshuffle the
   drift every time the skin is switched, which reads as a glitch rather than
   as wind. */
const PETALS = Array.from({ length: COUNT }, (_, i) => {
  /* Spread by index rather than by Math.random: the golden ratio scatters the
     starting columns without clumping, and the same list every time means the
     effect looks identical across reloads. */
  const phi = (i * 0.6180339887) % 1;
  return {
    left: +(phi * 100).toFixed(2),
    size: 5 + ((i * 7) % 5),
    duration: 15 + ((i * 11) % 12),
    delay: -((i * 13) % 24),
    drift: (i % 2 ? 1 : -1) * (18 + ((i * 5) % 26)),
    spin: (i % 3 ? 1 : -1) * (180 + ((i * 17) % 220)),
    tone: i % 2 === 0 ? "var(--petal-a)" : "var(--petal-b)",
  };
});

export default function Petals() {
  return (
    <div aria-hidden="true" className="sakura-field">
      {PETALS.map((p, i) => (
        <span key={i} className="sakura-petal" style={{
          left: `${p.left}%`,
          width: p.size,
          height: p.size + 2,
          background: p.tone,
          animationDuration: `${p.duration}s`,
          animationDelay: `${p.delay}s`,
          "--drift": `${p.drift}px`,
          "--spin": `${p.spin}deg`,
        }} />
      ))}
    </div>
  );
}
