import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// self-hosted: the CSP allows only the app's own files
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
// tokens, base and the shell come before every page, whose files may override base
import "./styles/tokens.css";
import "./styles/scale.css";
import "./styles/base.css";
import "./styles/table.css";
import "./styles/shell.css";
import { App } from "./App.tsx";
// after the pages: a mark rule has to win over the page rule it sits beside
import "./styles/marks.css";
import "./styles/motion.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// the service worker (sw.js, written by the build) keeps the app's files so it installs and opens with no network; not in `pnpm dev`
// (the private entry loads this file by a dynamic import, after `load` may have fired, so a finished page registers at once)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
}
