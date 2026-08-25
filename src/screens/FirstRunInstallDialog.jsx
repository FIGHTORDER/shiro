import React from "react";
import { Dialog, Button, Icon } from "../ds/shiro.js";

/* Shown once, the first time Shiro gets far enough to know whether Zero-K is on
   the machine.
 *
 * It exists because both answers are worth saying out loud. Somebody who
 * already has Zero-K should be told they do not need to download it again -
 * a launcher that stays silent about an existing install invites a second copy.
 * Somebody who does not have it should be offered one here, rather than having
 * to find the option in Settings, which is where it lived and where nobody
 * looked.
 *
 * Deliberately not a wizard. There are two facts and at most two choices, and
 * the destructive-looking one - downloading a gigabyte - is never the default
 * button. */
export default function FirstRunInstallDialog({ open, install, engine, root, onInstall, onSettings, onClose }) {
  const found = Boolean(install);

  return (
    <Dialog
      open={open}
      title={found ? "Zero-K is already here" : "Zero-K is not installed"}
      width={460}
      onClose={onClose}
      footer={found ? (
        <Button variant="primary" onClick={onClose}>Good to go</Button>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>Not now</Button>
          <Button variant="quiet" onClick={() => { onClose(); onSettings?.(); }}>
            I have one elsewhere
          </Button>
          <Button variant="primary" disabled={!engine} onClick={() => { onClose(); onInstall?.(); }}>
            Install Zero-K
          </Button>
        </>
      )}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        {found ? (
          <>
            <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-start" }}>
              <Icon name="check" size={16} style={{ color: "var(--signal-ok, var(--text-hi))", marginTop: 2 }} />
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", lineHeight: 1.5 }}>
                Shiro found your installation, so there is nothing to download.
                Games launch straight into it.
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr",
              gap: "var(--sp-3) var(--sp-5)" }}>
              <span className="lab">FOUND VIA</span>
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>{install.source}</span>
              <span className="lab">PATH</span>
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                color: "var(--text-body)", overflowWrap: "anywhere" }}>{install.root}</span>
            </div>
          </>
        ) : (
          <>
            <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", lineHeight: 1.5 }}>
              Shiro can install it for you - the engine from Zero-K's own server,
              then the game, then maps as battles need them. Nothing is shared
              with a Steam copy, so this is a separate installation of about a
              gigabyte.
            </span>
            {root && (
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr",
                gap: "var(--sp-3) var(--sp-5)" }}>
                <span className="lab">WOULD GO IN</span>
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                  color: "var(--text-body)", overflowWrap: "anywhere" }}>{root}</span>
              </div>
            )}
            {/* Said here rather than discovered later: if they already own it,
                pointing Shiro at it is cheaper than downloading it twice. */}
            <span style={{ font: "var(--text-ui-sm)", color: "var(--text-low)", lineHeight: 1.5 }}>
              Already have Zero-K somewhere Shiro did not look? Point it at the
              folder instead - it is the same game either way.
            </span>
          </>
        )}
      </div>
    </Dialog>
  );
}
