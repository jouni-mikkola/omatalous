import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// self-hosted: the CSP allows only the app's own files
import "@fontsource/ibm-plex-sans/latin-300.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
// tokens, base and the shell come before every page, whose files may override base
import "./styles/tokens.css";
import "./styles/scale.css";
import "./styles/base.css";
import "./styles/shell.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
