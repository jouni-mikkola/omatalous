/**
 * App shell: authentication gate (setup, login, forced password change),
 * header with navigation, scope switch (own / household) and user menu,
 * and the page router.
 */
import { useEffect, useRef, useState } from "react";
import { api, setUnauthenticatedHandler } from "./api.ts";
import { CONTROL_PANEL, consentNoticeText, consentNotices } from "./consent-notices.ts";
import { date, dateTime, setTimeZone } from "./format.ts";
import { MetaContext, navigate, useApi, useHashRoute } from "./hooks.ts";
import { figuresTicket, forgetFigures, holdFiguresFor, markAllCurrent, useFiguresFrom } from "./offline.ts";
import { lineText } from "./open-sync.ts";
import { extensionPages, REVIEW, SETTINGS, visibleNav } from "./nav.ts";
import { EmptyStart } from "./components/EmptyStart.tsx";
import { ErrorCard } from "./components/ErrorCard.tsx";
import { Loading } from "./components/Loading.tsx";
import { SecurityNotices } from "./components/SecurityNotices.tsx";
import { Bills } from "./pages/Bills.tsx";
import { ChangePassword, Login, Setup } from "./pages/Auth.tsx";
import { Optimise } from "./pages/Optimise.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Reports } from "./pages/Reports.tsx";
import { Review } from "./pages/Review.tsx";
import type { ReviewAnswer } from "./pages/review-items.ts";
import { Settings } from "./pages/Settings.tsx";
import { Transactions } from "./pages/Transactions.tsx";
import { firstRunWizard } from "./pages/Wizard.tsx";
import { viewsParts } from "./part.ts";
import { useOpenSync } from "./use-open-sync.ts";
import { periodFor, periodRange, shellPeriodsOf, windowNote } from "./period.ts";
import { SETTINGS_ANCHOR } from "./routes.ts";
import type { Meta, Scope, User } from "./types.ts";

type AuthState = { needsSetup: boolean; user: User | null; timezone?: string };

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // whoever is signed in owns the figures kept for offline use (offline.ts): a different user or none empties them
  const enter = (next: AuthState, ticket?: number) => {
    // timestamps are read in the instance's zone; a sign-in or a sign-out answer does not repeat it, the page's first answer did
    setTimeZone(next.timezone);
    holdFiguresFor(next.user, ticket);
    setAuth(next);
  };

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      void forgetFigures();
      setAuth((a) => (a ? { ...a, user: null } : a));
    });
    // the ticket is taken before the ask: an answer that comes after another tab changed who is signed in does not restore the old user's figures
    const ticket = figuresTicket();
    api<AuthState>("/api/auth/state")
      .then((next) => enter(next, ticket))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="app"><div className="card error" style={{ marginTop: 24 }}>Palvelimeen ei saada yhteyttä: {error}</div></div>;
  if (!auth) return <div className="app"><Loading /></div>;
  if (auth.needsSetup) return <Setup onDone={(user) => enter({ needsSetup: false, user })} />;
  if (!auth.user) return <Login onDone={(user) => enter({ needsSetup: false, user })} />;
  if (auth.user.mustChangePassword) {
    return <ChangePassword onDone={() => enter({ needsSetup: false, user: { ...auth.user!, mustChangePassword: false } })} />;
  }
  return <Main user={auth.user} onSignedOut={() => enter({ needsSetup: false, user: null })} />;
}

/** Per user: household members often share one browser. null = never chosen. */
function readScope(userId: string): Scope | null {
  try {
    const v = localStorage.getItem(`scope:${userId}`);
    return v === "household" || v === "own" ? v : null;
  } catch {
    return null;
  }
}

function Main({ user, onSignedOut }: { user: User; onSignedOut: () => void }) {
  const route = useHashRoute(user.role);
  const params = route.params;
  // an unknown or old link opens the overview instead of an empty page
  const meta = useApi<Meta>("/api/meta", true);
  // a module that is switched off has no nav entry, and its address opens the overview
  const extensions = extensionPages(meta.data?.features);
  const nav = [...visibleNav(meta.data?.features), ...extensions.map((e) => ({ id: e.id, label: e.page!.label }))];
  const pages = [...nav, REVIEW, SETTINGS];
  const page = pages.some((e) => e.id === route.page) ? route.page : "overview";
  // the open questions: their count in the header, read again on every page, since any page can answer one (a rule, a mark, a loan)
  const review = useApi<ReviewAnswer>("/api/review", true);
  const reloadReview = review.reload;
  const shownPage = useRef(page);
  useEffect(() => {
    if (shownPage.current !== page) reloadReview();
    shownPage.current = page;
  }, [page, reloadReview]);
  const open = review.data?.items.length ?? 0;
  const pageLabel = pages.find((e) => e.id === page)?.label;
  const [scope, setScopeState] = useState<Scope | null>(() => readScope(user.id));
  const [wizardClosed, setWizardClosed] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  // the server build this page was loaded against; a different one later means an upgrade happened
  const [loadedBuild, setLoadedBuild] = useState<string | null>(null);
  const reloadMeta = meta.reload;
  const userMenu = useRef<HTMLDetailsElement>(null);
  // rows that arrived while the page was open: the open page is drawn again from new requests (a new key)
  const [pageKey, setPageKey] = useState(0);
  const [arrived, setArrived] = useState(0);
  const showArrived = () => {
    setArrived(0);
    setPageKey((k) => k + 1);
    reloadMeta();
  };
  const openSync = useOpenSync((inserted) => {
    // not under the user's hands: a field or an open dialog keeps what is typed until the user asks
    const at = document.activeElement;
    if (at?.closest("input, textarea, select, dialog[open]") || document.querySelector("dialog[open]")) setArrived((n) => n + inserted);
    else showArrived();
  });
  const syncLine = lineText(openSync, new Date());
  // the time of the figures when the server cannot be reached and the page shows what the device kept (offline.ts)
  const figuresFrom = useFiguresFrom();
  const fetchAgain = () => {
    markAllCurrent();
    showArrived();
    reloadReview();
  };

  // the tab title tells which page is open (history, screen readers, many tabs)
  useEffect(() => {
    document.title = pageLabel ? `${pageLabel} · Omatalous` : "Omatalous";
  }, [pageLabel]);

  // a native <details> only closes from its summary; a menu should also close on Escape or a click elsewhere
  useEffect(() => {
    const close = (e: KeyboardEvent | PointerEvent) => {
      const menu = userMenu.current;
      if (!menu?.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        // keep keyboard focus on the menu button instead of losing it to the page
        if (menu.contains(document.activeElement)) menu.querySelector("summary")?.focus();
      } else if (menu.contains(e.target as Node)) {
        return;
      }
      menu.open = false;
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, []);

  useEffect(() => {
    if (meta.data && loadedBuild === null) setLoadedBuild(meta.data.version.build);
  }, [meta.data, loadedBuild]);

  // coming back to the tab: fresh sync status, consents and version
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && reloadMeta();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reloadMeta]);

  // the network is back, or the tab is: ask for the figures again, and the notice goes when the server answers
  useEffect(() => {
    if (!figuresFrom) return;
    const again = () => document.visibilityState === "visible" && fetchAgain();
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [figuresFrom !== null]);

  const setScope = (next: Scope) => {
    setScopeState(next);
    try {
      localStorage.setItem(`scope:${user.id}`, next);
    } catch {
      // private mode: the choice is not remembered
    }
  };

  if (!meta.data) {
    return (
      <div className="app">
        {meta.error ? (
          <ErrorCard message={meta.error} onRetry={reloadMeta} />
        ) : (
          <Loading />
        )}
      </div>
    );
  }

  const m = meta.data;
  // first-run setup for the admin: address, schedule and the shared bank app
  const wizard = firstRunWizard({ role: user.role, meta: m, closed: wizardClosed, close: () => setWizardClosed(true), reloadMeta: meta.reload, goToSettings: () => navigate("settings", { add: "1" }) });
  if (wizard) return wizard;
  // Koko talous exists for whoever shares accounts with others, and for whoever has a part of a joint account
  const hasHousehold = m.sharedAccounts.length > 0 || viewsParts(m);
  const noData = m.accounts.length === 0 && !hasHousehold;
  const loadDemo = async () => {
    await api("/api/demo", { method: "POST" });
    meta.reload();
  };
  // someone with only shared accounts would start on an empty page
  const effectiveScope: Scope = hasHousehold ? (scope ?? (m.accounts.length ? "own" : "household")) : "own";
  const period = periodFor(page, params.get("period"), m.opening);
  const range = periodRange(period, m.today);
  const presets = shellPeriodsOf(page, m.today);
  const note = windowNote(period, m.today);
  const consents = consentNotices(m.connections, m.accounts);
  // whoever can open the Enable Banking application: an admin for the shared one, the user for their own
  const canLinkAccounts = user.role === "admin" || m.bank.source === "user";
  const initials = user.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // only a confirmed logout ends the session: the cookie is HttpOnly, so a failed request would leave it alive
  const signOut = async () => {
    // the figures kept on the device go first, whether or not the server can be asked: this is the person's way to take them off
    await forgetFigures();
    try {
      await api("/api/auth/logout", { method: "POST" });
      onSignedOut();
    } catch (err) {
      // still signed in, so the figures go on being kept from the next answer
      holdFiguresFor(user);
      setSignOutError(`Uloskirjautuminen epäonnistui. ${(err as Error).message}`);
    }
  };

  return (
    <MetaContext.Provider value={m}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
        Siirry sisältöön
      </a>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <i style={{ height: 6 }} />
              <i style={{ height: 10 }} />
              <i style={{ height: 13 }} />
            </span>
            Omatalous
          </div>
          <nav className="nav" aria-label="Päävalikko">
            {nav.map((e) => (
              <a key={e.id} href={`#/${e.id}`} aria-current={page === e.id ? "page" : undefined}>
                {e.label}
              </a>
            ))}
          </nav>
          <span className="spacer" />
          {hasHousehold && (
            <div className="segmented scope-toggle" role="group" aria-label="Näkymä">
              <button type="button" aria-pressed={effectiveScope === "own"} onClick={() => setScope("own")}>
                Oma
              </button>
              <button type="button" aria-pressed={effectiveScope === "household"} onClick={() => setScope("household")}>
                Koko talous
              </button>
            </div>
          )}
          <a className="settings-link review-link" href={`#/${REVIEW.id}`} aria-current={page === REVIEW.id ? "page" : undefined}>
            <svg className="review-glyph" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 9.5h3.5l1 2h3l1-2H14M2 9.5 4 3h8l2 6.5V13H2Z" />
            </svg>
            <span className="review-link-text">{REVIEW.label}</span>
            {open > 0 && (
              <span className="nav-count">
                {open}
                <span className="sr-only"> avoinna</span>
              </span>
            )}
          </a>
          <a className="settings-link" href={`#/${SETTINGS.id}`} aria-current={page === SETTINGS.id ? "page" : undefined}>
            {SETTINGS.label}
          </a>
          <details className="user-menu" ref={userMenu}>
            <summary>
              <span className="sr-only">Käyttäjävalikko </span>
              <span className="avatar" aria-hidden="true">
                {initials}
              </span>
              <span className="small">{user.displayName}</span>
            </summary>
            {/* choosing an item closes the menu */}
            <div className="menu" onClick={(e) => ((e.currentTarget.parentElement as HTMLDetailsElement).open = false)}>
              <div className="muted">
                {user.username} · {user.role === "admin" ? "ylläpitäjä" : "jäsen"}
                <br />
                Omatalous {m.version.app}
              </div>
              <a href={`#/settings#${SETTINGS_ANCHOR.password}`}>Vaihda salasana</a>
              <button type="button" onClick={signOut}>
                Kirjaudu ulos
              </button>
            </div>
          </details>
        </div>
      </header>

      <div className="app">
        <div className="sync-line muted" aria-live="polite">
          {syncLine}
        </div>
        {figuresFrom && (
          <div className="notice warning" role="status">
            Ei yhteyttä palvelimeen. Näkyvät luvut on haettu {dateTime(figuresFrom)}.{" "}
            <button className="btn btn-small" type="button" onClick={fetchAgain}>
              Hae uudelleen
            </button>
          </div>
        )}
        {meta.error && <div className="notice warning">Ei yhteyttä palvelimeen. Tiedot voivat olla vanhoja.</div>}
        {signOutError && <div className="notice warning">{signOutError}</div>}
        <SecurityNotices />
        {loadedBuild && m.version.build !== loadedBuild && (
          <div className="notice good">
            Uusi versio {m.version.app}.{" "}
            <button className="btn btn-small" type="button" onClick={() => window.location.reload()}>
              Päivitä sivu
            </button>
          </div>
        )}
        {arrived > 0 && (
          <div className="notice good">
            Uusia tapahtumia: {arrived}.{" "}
            <button className="btn btn-small" type="button" onClick={showArrived}>
              Näytä
            </button>
          </div>
        )}
        {consents.map((n) => (
          <div key={n.id} className="notice warning">
            {consentNoticeText(n)}{" "}
            {n.kind === "left_out" && canLinkAccounts && (
              <>
                <a href={CONTROL_PANEL} target="_blank" rel="noopener noreferrer">
                  Avaa Control Panel
                </a>{" "}
              </>
            )}
            <a href="#/settings?add=1">Yhdistä uudelleen</a>
          </div>
        ))}

        <main id="main" tabIndex={-1}>
        <h1 className="sr-only">{pageLabel}</h1>
        {presets.length > 0 && (m.accounts.length > 0 || hasHousehold) && (
          <div className="filters" role="toolbar" aria-label="Aikaväli">
            <div className="segmented">
              {presets.map((p) => (
                <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => navigate(page, { period: p.id }, true)}>
                  {p.label}
                </button>
              ))}
            </div>
            <span className="range-label">
              {date(range.from)} – {date(range.to)}
            </span>
            {note && <span className="range-label">{note}</span>}
          </div>
        )}

        <div className="sheet" key={pageKey}>
        {page === "overview" && (
          <Overview
            meta={m}
            period={period}
            scope={effectiveScope}
            onEmptyAction={loadDemo}
            onShowHousehold={() => setScope("household")}
          />
        )}
        {page === "reports" && (noData ? <EmptyStart onDemo={loadDemo} meta={m} /> : <Reports meta={m} range={range} scope={effectiveScope} params={params} anchor={route.anchor} />)}
        {page === "optimise" && (noData ? <EmptyStart onDemo={loadDemo} meta={m} /> : <Optimise scope={effectiveScope} />)}
        {page === "transactions" && (noData ? <EmptyStart onDemo={loadDemo} meta={m} /> : <Transactions meta={m} params={params} scope={effectiveScope} anchor={route.anchor} />)}
        {page === "bills" && (noData ? <EmptyStart onDemo={loadDemo} meta={m} /> : <Bills meta={m} range={range} scope={effectiveScope} />)}
        {page === REVIEW.id && <Review meta={m} queue={review} />}
        {page === "settings" && <Settings meta={m} params={params} anchor={route.anchor} onChange={meta.reload} />}
        {extensions.map(({ id, page: own }) => own && page === id && <own.component key={id} params={params} />)}
        </div>
        </main>
        <footer className="sheet-foot">
          <span>Omatalous {m.version.app}</span>
          {hasHousehold && <span>{effectiveScope === "own" ? "Oma" : "Koko talous"}</span>}
          <span>{date(m.today)}</span>
        </footer>
      </div>
    </MetaContext.Provider>
  );
}
