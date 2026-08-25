import React from "react";
import walkSheet from "../assets/art/dirtbag-walk.png";

/* The few seconds after a login is accepted, while the server floods the
   directory down. It is dead time the player cannot act on, so rather than a
   spinner it gets a Dirtbag walking the bottom edge of the box.

   Deliberately not the design system's Dialog: that comes with a header, a
   footer and padding for content, and this has one word in it.

   The sprite is 8 frames rendered from the game's own model, 18 degrees off
   profile so both legs are visible - in true profile the legs overlap and only
   4 of the 8 frames are distinct. It is rendered already walking LEFT, so there
   is no horizontal flip; adding one makes the feet fight the travel and it
   moonwalks. */

const DIALOG_W = 340;
const SPRITE_W = 44;
const SPRITE_H = 46;
const FRAMES = 8;

export default function LoadingDialog({ open, message = "Loading…" }) {
  if (!open) return null;
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 70, display: "flex",
      alignItems: "center", justifyContent: "center", background: "var(--scrim)",
    }}>
      <div style={{
        position: "relative", width: DIALOG_W, background: "var(--surface-panel)",
        border: "1px solid var(--w-20)", boxShadow: "var(--elev-dialog)",
        overflow: "hidden",            // the runner is clipped by the frame
        animation: "shiro-enter var(--dur-base) var(--ease-out)",
      }}>
        <div style={{ padding: "26px var(--sp-6) 40px" }}>
          <span style={{ font: "var(--w-medium) var(--size-mid)/1.3 var(--font-core)",
            color: "var(--text-hi)" }}>{message}</span>
        </div>

        {/* The floor is the dialog's own bottom edge - a hairline like every
            other edge here, so it is --w-12 rather than ink at .14 alpha. The
            two render the same on paper; only the token follows a skin. */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1,
          background: "var(--w-12)" }} />

        <div aria-hidden="true" className="shiro-runner" style={{
          position: "absolute", left: 0, bottom: 1,
          width: SPRITE_W, height: SPRITE_H,
          backgroundImage: `url(${walkSheet})`,
          // Black ink, so a dark skin inverts it. See LoginScreen.
          filter: "var(--art-filter, none)",
          backgroundRepeat: "no-repeat",
          backgroundSize: `${SPRITE_W * FRAMES}px ${SPRITE_H}px`,
          animation: "shiro-walk .55s steps(8) infinite, shiro-cross 4.4s linear infinite",
        }} />
      </div>
    </div>
  );
}
