import React from "react";
import { Dialog, Button, Input, Icon } from "../ds/shiro.js";

/* Creating an account. The server is the only validator that matters, so this
   checks only what it can check locally - that the two passwords match - and
   lets the server speak for everything else. */
export default function RegisterDialog({ open, onClose, onRegister }) {
  const [name, setName] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setName(""); setPw(""); setPw2(""); setEmail(""); setError(""); setBusy(false);
  }, [open]);

  const mismatch = pw2 !== "" && pw !== pw2;
  const ready = name.trim() !== "" && pw !== "" && pw === pw2 && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await onRegister(name.trim(), pw, email.trim() || undefined);
      onClose();
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Create an account" width={420} onClose={busy ? undefined : onClose}
      footer={<>
        <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready} loading={busy} onClick={submit}>
          {busy ? "Creating" : "Create account"}
        </Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <Input label="Account name" value={name} icon="user"
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          hint="Case-sensitive, and this is the name everyone sees." />
        <Input label="Password" type="password" value={pw}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} />
        <Input label="Repeat password" type="password" value={pw2}
          onChange={e => setPw2(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          error={mismatch ? "The two passwords do not match." : (error || undefined)} />
        <Input label="Email (optional)" value={email} onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          hint="Only used for password recovery." />
        <div style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-5)",
          background: "var(--surface-sunken)", border: "1px solid var(--w-06)" }}>
          <Icon name="info" size={14} style={{ color: "var(--text-low)", marginTop: 2 }} />
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
            Creating an account logs you straight in. If you already play through Steam,
            set a lobby password on zero-k.info instead of registering again.
          </span>
        </div>
      </div>
    </Dialog>
  );
}
