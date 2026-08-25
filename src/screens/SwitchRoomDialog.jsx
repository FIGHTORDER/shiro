import React from "react";
import { Dialog, Button } from "../ds/shiro.js";

/* Joining a second room means leaving the first, and the server has no notion
   of being in two - so this asks before it costs somebody their slot in a room
   that may be full when they come back.
 *
 * Only for a *different* room. Joining the one you are already in just shows
 * it, and creating a room leaves without asking, because the room you are
 * making is unambiguously the one you want. */
export default function SwitchRoomDialog({ battle, from, onClose, onConfirm }) {
  return (
    <Dialog open={Boolean(battle)} title="Leave this room?" width={400} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>No</Button>
        <Button variant="primary" onClick={onConfirm}>Yes, join</Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
        <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
          You are in {from ? `"${from}"` : "a room"}. Joining
          {battle ? ` "${battle.title}"` : " another room"} leaves it.
        </span>
      </div>
    </Dialog>
  );
}
