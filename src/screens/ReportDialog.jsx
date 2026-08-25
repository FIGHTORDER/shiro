import React from "react";
import { Dialog, Button, Input } from "../ds/shiro.js";

/**
 * Report somebody to the moderators.
 *
 * The wording is careful on one point: the server acknowledges nothing.
 * `ZkLobbyServer/ConnectedUser.cs` writes the report and rings the admin
 * channel, and sends no reply at all - a name that does not resolve is dropped
 * in silence. So this says the report was sent, and never that it was received,
 * acted on, or even that the person existed. Promising a reply the protocol
 * cannot deliver would be worse than saying nothing.
 */
export default function ReportDialog({ open, name, onClose, onSend }) {
  const [text, setText] = React.useState("");

  // A fresh dialog every time it opens; last time's complaint is not this one's.
  React.useEffect(() => { if (open) setText(""); }, [open, name]);

  const send = () => {
    if (!text.trim()) return;
    onSend && onSend(name, text.trim());
    onClose && onClose();
  };

  return (
    <Dialog open={open} title={`Report ${name}`} onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={send} disabled={!text.trim()}>Send report</Button>
        </>
      }>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>
          This goes to the Zero-K moderators. Say what happened and where -
          they see the report, not the conversation around it.
        </span>
        <Input label="What happened" placeholder="They have been..."
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") send(); }} />
        {/* Stated rather than implied: nothing comes back on this connection,
            so somebody waiting for a confirmation would wait for ever. */}
        <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
          color: "var(--text-low)" }}>
          Shiro cannot tell you what happens next - the server sends no reply to
          a report. To stop seeing someone as well, ignore them.
        </span>
      </div>
    </Dialog>
  );
}
