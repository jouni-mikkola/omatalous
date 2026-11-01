import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// base.css declares the layers (reset, tokens, base, components, pages, utilities); every stylesheet sits in one, so the
// order of these imports no longer decides which rule wins. Tokens are generated (pnpm tokens), the face is self-hosted.
import "./styles/base.css";
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles/table.css";
import "./styles/shell.css";
import { App } from "./App.tsx";
import { fallBackToFinnish, language } from "./format.ts";
import { ensureEnglish } from "./language.ts";
import { queryClient } from "./query-client.ts";
// last layer (utilities): a mark rule has to win over the page rule it sits beside
import "./styles/marks.css";
import "./styles/motion.css";

// the device's language is known before the first paint; English is awaited so that no text shows in Finnish first
void ensureEnglish(language())
  .catch(fallBackToFinnish)
  .then(() =>
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </StrictMode>,
    ),
  );

// the service worker (sw.js, written by the build) keeps the app's files so it installs and opens with no network; not in `pnpm dev`
// (the private entry loads this file by a dynamic import, after `load` may have fired, so a finished page registers at once)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
}
