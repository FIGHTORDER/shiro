import React from "react";
import { Dialog, Button, Input } from "../ds/shiro.js";

/* A locked room asks for its password. The server does not validate ahead of
   time - a wrong one comes back as a refusal, which is why this closes on
   submit rather than waiting for an acknowledgement that never arrives. */
export default function JoinPasswordDialog({ battle, onClose, onJoin }) {
  const [password, setPassword] = React.useState("");
  React.useEffect(() => { setPassword(""); }, [battle && battle.id]);

  const submit = () => {
    if (!password.trim()) return;
    onJoin(password.trim());
    onClose();
  };

  return (
    <Dialog open={Boolean(battle)} title="This battle is locked" width={380} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!password.trim()} onClick={submit}>Join</Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
          {battle ? battle.title : ""}
        </span>
        <Input label="Password" value={password} autoFocus
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} />
      </div>
    </Dialog>
  );
}
