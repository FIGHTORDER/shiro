import React from "react";
import { Button, Input, Checkbox, Icon } from "../ds/shiro.js";
import logoMark from "../assets/logo-mark.svg";
import glaive from "../assets/art/glaive-sidelit.png";

/* Screen 1. First impression, and the only place the "Steam users must set a
   password" caveat is explained.

   onLogin(name, password, remember) may be async and may reject; the rejection
   message is shown against the password field. It is never retried automatically - the
   server logs failed attempts by IP and bans repeat offenders. */
export default function LoginScreen({ onLogin, onRegister, live, defaultName, defaultPassword, defaultRemember }) {
  const [name, setName] = React.useState(defaultName || "");
  const [pw, setPw] = React.useState(defaultPassword || "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [remember, setRemember] = React.useState(defaultRemember !== false);

  const submit = async () => {
    if (!name || !pw) { setError("Enter a name and password."); return; }
    setBusy(true);
    setError("");
    try {
      await onLogin(name, pw, remember);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 400px", minHeight: 0,
      background: "var(--surface-void)" }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column",
        justifyContent: "center", gap: "var(--sp-9)", padding: "var(--sp-12)",
        borderRight: "1px solid var(--w-12)", overflow: "hidden" }}>

        {/* A Glaive, rendered from the game's own model as hard two-tone ink.
            Anchored to the bottom-right and bled off both edges so it reads as
            a printed plate rather than a sticker, and sits behind the type
            without competing with it.

            Black ink on transparent, so a dark skin has to invert it;
            --art-filter is that hook and resolves to `none` in the light
            system. Same on the friends screen and the loading dialog. */}
        <img src={glaive} alt="" aria-hidden="true"
          style={{ position: "absolute", right: "3%", bottom: "0%", height: "82%", width: "auto",
            filter: "var(--art-filter, none)", pointerEvents: "none", userSelect: "none" }} />

        {/* The type sits above the art, on its own so long copy stays readable
            wherever the figure happens to fall. */}
        <div style={{ position: "relative", display: "flex", alignItems: "center",
          gap: "var(--sp-6)" }}>
          <img src={logoMark} width="72" height="72" alt=""
            style={{ filter: "var(--logo-filter, none)" }} />
          <span style={{ font: "var(--w-bold) var(--size-4xl)/1 var(--font-core)", fontStretch: "100%",
            letterSpacing: "var(--track-wordmark)", color: "var(--text-hi)" }}>SHIRO</span>
        </div>
        <div style={{ position: "relative", display: "flex", flexDirection: "column",
          gap: "var(--sp-4)", maxWidth: "44ch" }}>
          <span style={{ font: "var(--w-regular) var(--size-mid)/1.5 var(--font-core)", color: "var(--text-mid)" }}>
            A lobby client for Zero-K.
          </span>
          {!live && (
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-faint)" }}>
              Running in the browser, so this is the demo click-through. Launch the
              desktop app to connect to zero-k.info.
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center",
        gap: "var(--sp-6)", padding: "var(--sp-9)" }}>
        <span style={{ font: "var(--text-label)", letterSpacing: "var(--track-label)",
          textTransform: "uppercase", color: "var(--text-low)" }}>LOG IN</span>
        <Input label="Account name" value={name} onChange={e => setName(e.target.value)} icon="user"
          onKeyDown={e => e.key === "Enter" && submit()} />
        <Input label="Password" type="password" value={pw} onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()} error={error || undefined} />
        <Checkbox label="Stay logged in" checked={remember}
          onChange={e => setRemember(e.target.checked)} />
        <Button variant="primary" size="lg" block loading={busy} onClick={submit}>
          {busy ? "Connecting" : "Log in"}
        </Button>
        {/* Not a ghost button. Registration is one of the two things this
            screen is for, and at ghost weight it read as decoration - it was
            reported missing by somebody looking straight at it. */}
        <Button variant="secondary" size="sm" block onClick={onRegister}>Create an account</Button>
        <div style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-5)",
          background: "var(--surface-sunken)", border: "1px solid var(--w-06)" }}>
          <Icon name="info" size={14} style={{ color: "var(--text-low)", marginTop: 2 }} />
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
            Steam accounts need a lobby password. Set one on zero-k.info, then log in here.
            Account names are case-sensitive.
          </span>
        </div>
      </div>
    </div>
  );
}
