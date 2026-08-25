import React from "react";
import { splitLinks, externalHref } from "../store/site.ts";

/**
 * A chat line with its links made clickable.
 *
 * Zero-K writes `zk://` links into chat and expects a client to honour them -
 * the server's own `PlanetWarsMatchMaker` says "starts on zk://@join_player:X"
 * and `FriendJoinedBattleLine` writes "zk://@join_battle:N". ZeroKLobby makes
 * both those and ordinary web links clickable; Shiro rendered every one of them
 * as dead text.
 *
 * This is a call-site fix on purpose. `ChatLine` in the generated design system
 * puts its `text` straight through as React children, so handing it an array of
 * nodes needs no VENDOR PATCH - the component already supports this and nobody
 * had used it.
 *
 * `onZk` is what to do with one of ours; it gets the raw `zk://...` string and
 * the app feeds it to the same handler `SiteToLobbyCommand` uses, so a link
 * clicked in chat and a button pressed on the website do exactly the same thing.
 */
export default function ChatText({ text, onZk }) {
  const chunks = React.useMemo(() => splitLinks(String(text ?? "")), [text]);
  // The overwhelmingly common case, and not worth an array of one span.
  if (chunks.length === 1 && chunks[0].kind === "text") return text ?? "";

  return chunks.map((c, i) => {
    if (c.kind === "text") return <React.Fragment key={i}>{c.text}</React.Fragment>;
    const zk = c.kind === "zk";
    return (
      <a key={i}
        href={zk ? undefined : externalHref(c.text)}
        target={zk ? undefined : "_blank"}
        rel={zk ? undefined : "noreferrer"}
        title={zk ? "Open this in Shiro" : c.text}
        onClick={zk && onZk ? e => { e.preventDefault(); onZk(c.text); } : undefined}
        style={{
          color: "var(--text-hi)",
          textDecoration: "underline",
          /* Chat lines wrap; a long address must break rather than push the
             whole conversation sideways. */
          overflowWrap: "anywhere",
          cursor: "pointer",
        }}>{c.text}</a>
    );
  });
}
