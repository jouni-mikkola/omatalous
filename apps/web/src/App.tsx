/**
 * App shell: authentication gate (setup, login, forced password change),
 * header with navigation, scope switch (own / household) and user menu,
 * and the page router.
 */
import { useEffect, useRef, useState } from "react";
import { api, setUnauthenticatedHandler } from "./api.ts";
import { CONTROL_PANEL, consentNoticeText, consentNotices } from "./consent-notices.ts";
import { date, dateTime } from "./format.ts";
import { navigate, useApi, useHashRoute } from "./hooks.ts";
import { SETTINGS, visibleNav } from "./nav.ts";
import { EmptyStart } from "./components/EmptyStart.tsx";
import { SecurityNotices } from "./components/SecurityNotices.tsx";
import { Bills } from "./pages/Bills.tsx";
import { ChangePassword, Login, Setup } from "./pages/Auth.tsx";
import { Optimise } from "./pages/Optimise.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Reports } from "./pages/Reports.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Transactions } from "./pages/Transactions.tsx";
import { Wizard } from "./pages/Wizard.tsx";
import { periodFor, periodRange, periodsOf } from "./period.ts";
import { SETTINGS_ANCHOR } from "./routes.ts";
import type { Meta, Scope, User } from "./types.ts";

type AuthState = { needsSetup: boolean; user: User | null };

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUnauthenticatedHandler(() => setAuth((a) => (a ? { ...a, user: null } : a)));
    api<AuthState>("/api/auth/state")
      .then(setAuth)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="app"><div className="card error" style={{ marginTop: 24 }}>Palvelimeen ei saada yhteyttä: {error}</div></div>;
  if (!auth) return <div className="app"><div className="empty" role="status">Ladataan…</div></div>;
  if (auth.needsSetup) return <Setup onDone={(user) => setAuth({ needsSetup: false, user })} />;
  if (!auth.user) return <Login onDone={(user) => setAuth({ needsSetup: false, user })} />;
  if (auth.user.mustChangePassword) {
    return <ChangePassword onDone={() => setAuth({ needsSetup: false, user: { ...auth.user!, mustChangePassword: false } })} />;
  }
  return <Main user={auth.user} onSignedOut={() => setAuth({ needsSetup: false, user: null })} />;
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
  const meta = useApi<Meta>("/api/meta");
  // a module that is switched off has no nav entry, and its address opens the overview
  const nav = visibleNav(meta.data?.features);
  const pages = [...nav, SETTINGS];
  const page = pages.some((e) => e.id === route.page) ? route.page : "overview";
  const pageLabel = pages.find((e) => e.id === page)?.label;
  const [scope, setScopeState] = useState<Scope | null>(() => readScope(user.id));
  const [wizardClosed, setWizardClosed] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  // the server build this page was loaded against; a different one later means an upgrade happened
  const [loadedBuild, setLoadedBuild] = useState<string | null>(null);
  const reloadMeta = meta.reload;
  const userMenu = useRef<HTMLDetailsElement>(null);

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
          <div className="card error" style={{ marginTop: 24 }}>
            {meta.error}{" "}
            <button className="btn btn-small" type="button" onClick={reloadMeta}>
              Yritä uudelleen
            </button>
          </div>
        ) : (
          <div className="empty" role="status">Ladataan…</div>
        )}
      </div>
    );
  }

  const m = meta.data;
  // first-run setup for the admin: address, schedule and the shared bank app
  if (user.role === "admin" && !m.setupDone && !wizardClosed) {
    return (
      <Wizard
        onDone={(next) => {
          setWizardClosed(true);
          meta.reload();
          if (next === "connect") navigate("settings", { add: "1" });
        }}
      />
    );
  }
  const hasHousehold = m.sharedAccounts.length > 0;
  const noData = m.accounts.length === 0 && !hasHousehold;
  const loadDemo = async () => {
    await api("/api/demo", { method: "POST" });
    meta.reload();
  };
  // someone with only shared accounts would start on an empty page
  const effectiveScope: Scope = hasHousehold ? (scope ?? (m.accounts.length ? "own" : "household")) : "own";
  const period = periodFor(page, params.get("period"));
  const range = periodRange(period, m.today);
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
    try {
      await api("/api/auth/logout", { method: "POST" });
      onSignedOut();
    } catch (err) {
      setSignOutError(`Uloskirjautuminen epäonnistui. ${(err as Error).message}`);
    }
  };

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
        Siirry sisältöön
      </a>
      <header className="topbar">
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
        <span className="sync-status">{m.lastSync ? `Haettu ${dateTime(m.lastSync.finishedAt ?? m.lastSync.startedAt)}` : ""}</span>
        <a className="settings-link" href={`#/${SETTINGS.id}`} aria-current={page === SETTINGS.id ? "page" : undefined}>
          {SETTINGS.label}
        </a>
        <details className="user-menu" ref={userMenu}>
          <summary aria-label="Käyttäjävalikko">
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
      </header>

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
      {effectiveScope === "household" && (
        <div className="notice">Mukana jaetut tilit: {[...new Set(m.sharedAccounts.map((a) => a.ownerName))].join(", ")}</div>
      )}

      <main id="main" tabIndex={-1}>
      <h1 className="sr-only">{pageLabel}</h1>
      {periodsOf(page).length > 0 && (m.accounts.length > 0 || hasHousehold) && (
        <div className="filters" role="toolbar" aria-label="Aikaväli">
          <div className="segmented">
            {periodsOf(page).map((p) => (
              <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => navigate(page, { period: p.id })}>
                {p.label}
              </button>
            ))}
          </div>
          <span className="range-label">
            {date(range.from)} – {date(range.to)}
          </span>
        </div>
      )}

      {page === "overview" && (
        <Overview
          meta={m}
          range={range}
          scope={effectiveScope}
          onEmptyAction={loadDemo}
          onShowHousehold={() => setScope("household")}
        />
      )}
      {page === "reports" && (noData ? <EmptyStart onDemo={loadDemo} /> : <Reports meta={m} range={range} scope={effectiveScope} anchor={route.anchor} />)}
      {page === "optimise" && (noData ? <EmptyStart onDemo={loadDemo} /> : <Optimise scope={effectiveScope} />)}
      {page === "transactions" && (noData ? <EmptyStart onDemo={loadDemo} /> : <Transactions meta={m} params={params} scope={effectiveScope} anchor={route.anchor} />)}
      {page === "bills" && (noData ? <EmptyStart onDemo={loadDemo} /> : <Bills meta={m} range={range} scope={effectiveScope} />)}
      {page === "settings" && <Settings meta={m} params={params} anchor={route.anchor} onChange={meta.reload} />}
      </main>
    </div>
  );
}
