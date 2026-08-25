import React from "react";
import ReactDOM from "react-dom/client";
import "./src/styles/styles.css";
import "./src/styles/app.css";
import AppShell from "./src/screens/AppShell.jsx";
import ChatScreen from "./src/screens/ChatScreen.jsx";
import FriendsScreen from "./src/screens/FriendsScreen.jsx";
import BattleRoomScreen from "./src/screens/BattleRoomScreen.jsx";
import D from "./src/data.js";
import { applySkin, useSettings } from "./src/store/settings.ts";

applySkin(useSettings.getState().skin);

const noop = () => {};

function Probe() {
  const which = new URLSearchParams(location.search).get("s") || "chat";
  const [chatHeight, setChatHeight] = React.useState(
    Number(new URLSearchParams(location.search).get("h") || 200));
  window.__setChatHeight = setChatHeight;
  window.__chatHeight = chatHeight;

  let body = null;
  if (which === "chat") {
    body = <ChatScreen channels={D.channels} users={D.channelUsers}
      messages={D.channelChat} onTab={noop} onSend={noop} onClose={noop}
      onJoin={noop} onUser={noop} />;
  } else if (which === "friends") {
    body = <FriendsScreen users={D.channelUsers} profile={undefined}
      onSelect={noop} onMessage={noop} onIgnore={noop} onReport={noop}
      onAdd={noop} onRemove={noop} />;
  } else {
    body = <BattleRoomScreen room={D.room} onLeave={noop} onStart={noop}
      chat={D.room.chat} onSay={noop} onTeam={noop} onSpectate={noop}
      chatHeight={chatHeight} onChatHeight={setChatHeight} />;
  }
  return (
    <AppShell view="chat" onView={noop} connection="online" users={36}
      engine="2025.06.21" game="Zero-K v1.14.8.0" version="1.0.0">
      {body}
    </AppShell>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Probe />);
