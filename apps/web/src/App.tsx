/**
 * The app's entry once the page has loaded: the authentication gate (setup, login, forced password change). Once
 * someone is signed in it hands over to the router (router.tsx), whose root route is the shell (Shell.tsx).
 */
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, setUnauthenticatedHandler } from "./api.ts";
import { t } from "./text.ts";
import { DEFAULT_LANGUAGE } from "@banking/core";
import { fallBackToFinnish, rememberedLanguage, setLanguage, setTimeZone } from "./format.ts";
import { ensureEnglish, ensureLate } from "./language.ts";
import { figuresTicket, forgetFigures, holdFiguresFor } from "./offline.ts";
import { navigate } from "./hooks.ts";
import { Loading } from "./components/Loading.tsx";
import { Notice } from "./components/ui/Notice.tsx";
import { ChangePassword, Login, Setup } from "./pages/Auth.tsx";
import { forgetAnswers } from "./query-client.ts";
import { addOnAwaitsSignIn } from "./extensions.ts";
import { router } from "./router.tsx";
import { SessionContext } from "./shell-context.ts";
import type { User } from "./types.ts";
type AuthState = { needsSetup: boolean; user: User | null; timezone?: string };

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // the texts of the pages arrive beside the sign-in answer; the sign-in itself reads only the entry's
  const [pagesRead, setPagesRead] = useState(false);
  const [pagesFailed, setPagesFailed] = useState(false);
  // the user the cached answers (query-client.ts) were read for: another user, or none, starts with an empty cache
  const answersOf = useRef<string | null>(null);

  // whoever is signed in owns the figures kept for offline use (offline.ts): a different user or none empties them
  const enter = async (next: AuthState, ticket?: number) => {
    // timestamps are read in the instance's zone; a sign-in or a sign-out answer does not repeat it, the page's first answer did
    setTimeZone(next.timezone);
    // a member whose device did not know their language yet gets the catalogue before the language changes, so nothing reads English that is not there
    const loaded = await ensureEnglish(next.user?.language ?? rememberedLanguage() ?? DEFAULT_LANGUAGE).then(() => true, () => false);
    if (loaded) setLanguage(next.user?.language);
    else fallBackToFinnish();
    holdFiguresFor(next.user, ticket);
    const id = next.user?.id ?? null;
    if (id !== answersOf.current) forgetAnswers();
    answersOf.current = id;
    setAuth(next);
  };

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      void forgetFigures();
      forgetAnswers();
      answersOf.current = null;
      setAuth((a) => (a ? { ...a, user: null } : a));
    });
    // the ticket is taken before the ask: an answer that comes after another tab changed who is signed in does not restore the old user's figures
    ensureLate().then(() => setPagesRead(true), () => setPagesFailed(true));
    const ticket = figuresTicket();
    api<AuthState>("/api/auth/state")
      .then((next) => enter(next, ticket))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="app"><Notice tone="error" className="app-error">{t("app.unreachable")}</Notice></div>;
  // the sign-in reads only the entry's texts; whoever is signed in waits for the texts of the pages too
  if (!auth || (!pagesRead && auth.user && !auth.needsSetup && !auth.user.mustChangePassword)) return <div className="app">{pagesFailed ? <Notice tone="error" className="app-error">{t("app.unreachable")}</Notice> : <Loading />}</div>;
  if (auth.needsSetup) return <Setup onDone={(user) => void enter({ needsSetup: false, user })} />;
  if (!auth.user) return <Login onDone={(user) => (addOnAwaitsSignIn() ? location.reload() : void enter({ needsSetup: false, user }))} />;
  if (auth.user.mustChangePassword) {
    // the address still names the page the member was on before signing in: they start at Yhteenveto
    return (
      <ChangePassword
        onDone={() => {
          navigate("overview");
          void enter({ needsSetup: false, user: { ...auth.user!, mustChangePassword: false } });
        }}
      />
    );
  }
  const session = { user: auth.user, onSignedOut: () => void enter({ needsSetup: false, user: null }) };
  // keyed by the user: the shell of another user starts with its own state (scope, set-up wizard), not the last one's
  return (
    <SessionContext value={session}>
      <RouterProvider key={auth.user.id} router={router} context={session} />
    </SessionContext>
  );
}
