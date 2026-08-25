import React from "react";
import ReactDOM from "react-dom/client";

import "./styles/styles.css";
import "./styles/app.css";
import App from "./App.jsx";
import { interceptExternalLinks } from "./net/external.ts";
import { suppressPageContextMenu } from "./net/contextmenu.ts";
import { listenForDeepLinks } from "./net/deeplink.js";
import { useSettings, applySkin } from "./store/settings.ts";

// NOTE: there is deliberately no global lucide interval here. The Icon
// component draws itself on mount, and src/ds/shiro.js replaces lucide's
// destructive createIcons with an in-place renderer. Re-adding a document-wide
// createIcons() call will reintroduce the blank-window crash.
// Before first paint: a link clicked early must not navigate the app away.
interceptExternalLinks();
suppressPageContextMenu();
/* A link may have started this process, so listen before first paint - the
   pending slot holds it until the session is live. */
void listenForDeepLinks();

// Also before first paint. The skins are in the bundled stylesheet already, so
// all a skin needs is its attribute on <html>; doing this after createRoot
// would paint one frame of Paper first, which on a dark skin is a white flash.
applySkin(useSettings.getState().skin);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
