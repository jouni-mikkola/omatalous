/**
 * The frame of every page once someone is signed in: the header with navigation, the scope switch and the user menu, the
 * notices, the period switch, and the outlet where the router puts the open page (router.tsx). It reads what every
 * page needs once (meta, the count of open questions), works out the scope and the period, and hands them to the views
 * through `ShellContext`.
 */
import { AboutFoot } from "./components/AboutFoot.tsx";
import { Link, Navigate, Outlet, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { type ComponentProps, lazy, Suspense, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { CONTROL_PANEL, consentNoticeText, consentNotices } from "./consent-notices.ts";
import { dateRange, dateTime, count } from "./format.ts";
import { MetaContext, navigate, useApi } from "./hooks.ts";
import { markAllCurrent, holdFiguresFor, forgetFigures, useFiguresFrom } from "./offline.ts";
import { failureText, footText } from "./open-sync.ts";
import { MORE, NAV, REVIEW, ROWS, SETTINGS } from "./nav.ts";
import { extensionPages } from "./extensions.ts";
import { ErrorCard } from "./components/ErrorCard.tsx";
import { Loading } from "./components/Loading.tsx";
import { SecurityNotices } from "./components/SecurityNotices.tsx";
import { readWizardClosed, wizardDue, writeWizardClosed } from "./wizard-due.ts";
import { type PageAddress, PageAddressContext } from "./page-address.ts";
import { viewsParts } from "./part.ts";
import { useOpenSync } from "./use-open-sync.ts";
import { askedQuestion, periodFor, periodRange, shellPeriodsOf } from "./period.ts";
import { dropAnswers, forgetAnswers, META_PATH } from "./query-client.ts";
import { t } from "./text.ts";
import { openWord, reviewTitle, useReviewCount } from "./review-count.ts";
import { paramsOf } from "./search.ts";
import { CONNECT_BANK_HASH } from "./routes.ts";
import { LANGUAGE_NAME } from "./components/ui/DeviceLanguage.tsx";
import { LANGUAGES, type Language } from "@banking/core";
import { type ShellState, ShellContext, useSession } from "./shell-context.ts";
import type { Meta, Scope } from "./types.ts";
import { Button } from "./components/ui/Button.tsx";
import { Segmented } from "./components/ui/Segmented.tsx";
import { Notice } from "./components/ui/Notice.tsx";

// the wizard (and the bank app set-up it carries) is for one admin on one day, so it is not part of the entry
const FirstRunWizard = lazy(async () => {
  const { firstRunWizard } = await import("./pages/Wizard.tsx");
  return { default: (o: Parameters<typeof firstRunWizard>[0]) => firstRunWizard(o) };
});

// the router marks a link active by its path; where the address says another tab is current (Lisää on the reports path), it is not
const NOT_CURRENT = { exact: true, includeSearch: true } as const;

/** A link to a page by its id: the router loads the page's chunk when the pointer or focus comes near. */
function PageLink({ id, current, className, children, ...rest }: { id: string; current: boolean } & Omit<ComponentProps<"a">, "href" | "id">) {
  return (
    <Link to={`/${id}` as "/"} preload="intent" className={className} aria-current={current ? "page" : undefined} activeOptions={current ? undefined : NOT_CURRENT} {...rest}>
      {children}
    </Link>
  );
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

export function Shell() {
  const { user, onSignedOut } = useSession();
  // the address the page on show was loaded for: `location` moves at the start of a load, before an old address has been
  // rewritten, and reading it would send an old address to the overview before its redirect is done
  const location = useRouterState({ select: (s) => s.resolvedLocation ?? s.location });
  const search = useSearch({ strict: false }) as Record<string, string | undefined>;
  const params = paramsOf(search);
  const anchor = location.hash || undefined;
  const requested = location.pathname.split("/")[1] ?? "";
  const meta = useApi<Meta>("/api/meta", true);
  // the pages of an add-on module live in the user menu beside Tapahtumat; the four tabs stay the household's questions
  const extensions = extensionPages();
  const pages: { id: string; label: string }[] = [...NAV, ROWS, ...extensions.map((e) => ({ id: e.id, label: e.page!.label })), SETTINGS];
  // an unknown or old link opens the overview instead of an empty page
  const known = pages.some((e) => e.id === requested);
  const page = known ? requested : "overview";
  // the open questions: only their count, in the header of every page and read again when a page opens, since any page can answer one (a rule, a mark, a loan); the queue is Tarkistettavat's own
  const { count: asked, reload: reloadReview } = useReviewCount();
  // a failed fetch is an item of the queue the server does not count: the mark adds it, as the page does
  const open = asked + (meta.data?.lastSync?.status === "failed" ? 1 : 0);
  const shownPage = useRef(page);
  useEffect(() => {
    if (shownPage.current !== page) reloadReview();
    shownPage.current = page;
  }, [page, reloadReview]);
  const shown = pages.find((e) => e.id === page);
  // a question page of the reports (`?q=`) is Lisää, not the Kuukausi tab
  const more = page === "reports" && params.has("q");
  const pageName = more ? MORE.label : shown?.label;
  // Tarkistettavat carries its count in the title and the heading, the same one the header's mark shows
  const pageLabel = pageName && page === REVIEW.id ? reviewTitle(pageName, open) : pageName;
  const [scope, setScopeState] = useState<Scope | null>(() => readScope(user.id));
  const [wizardClosed, setWizardClosed] = useState(() => readWizardClosed(user.id));
  // what a choice of the user menu (the language, signing out) could not do
  const [reportQuestion, setReportQuestion] = useState<string | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [changingLanguage, setChangingLanguage] = useState(false);
  // the server build this page was loaded against; a different one later means an upgrade happened
  const [loadedBuild, setLoadedBuild] = useState<string | null>(null);
  const reloadMeta = meta.reload;
  const userMenu = useRef<HTMLDetailsElement>(null);
  // rows that arrived while the page was open: the open page is drawn again from new requests (a new key)
  const navigateTo = useNavigate();
  const [pageKey, setPageKey] = useState(0);
  const [arrived, setArrived] = useState(0);
  const showArrived = () => {
    setArrived(0);
    setPageKey((k) => k + 1);
    // new rows can change any answer: the open ones are read again, and meta with them
    void dropAnswers();
  };
  const openSync = useOpenSync((inserted) => {
    // not under the user's hands: a field or an open dialog keeps what is typed until the user asks
    const at = document.activeElement;
    if (at?.closest("input, textarea, select, dialog[open]") || document.querySelector("dialog[open]")) setArrived((n) => n + inserted);
    else showArrived();
  });
  const now = new Date();
  const failure = failureText(openSync, now);
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

  // the data changed under the cached answers (a sync, another tab, another member's share): they are read again
  const seenVersion = useRef<string | null>(null);
  const dataVersion = meta.data?.dataVersion;
  useEffect(() => {
    if (dataVersion === undefined) return;
    if (seenVersion.current !== null && seenVersion.current !== dataVersion) void dropAnswers(META_PATH);
    seenVersion.current = dataVersion;
  }, [dataVersion]);

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
  const foot = footText(openSync, now);
  // first-run setup for the admin: address, schedule and the shared bank app
  if (wizardDue({ role: user.role, meta: m, closed: wizardClosed })) {
    return (
      <Suspense fallback={null}>
        <FirstRunWizard role={user.role} meta={m} closed={wizardClosed} close={() => {
          writeWizardClosed(user.id);
          setWizardClosed(true);
        }} reloadMeta={meta.reload} goToSettings={() => navigate("settings", { add: "1" })} />
      </Suspense>
    );
  }
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
  const range = periodRange(period, m.today, m.opening);
  const presets = shellPeriodsOf(page, m.today, reportQuestion ?? askedQuestion(params.get("q"), anchor));
  const consents = consentNotices(m.connections, m.accounts);
  // whoever can open the Enable Banking application: an admin for the shared one, the user for their own
  const canLinkAccounts = user.role === "admin" || m.bank.source === "user";
  const initials = user.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const shell: ShellState = {
    meta: m,
    scope: effectiveScope,
    period,
    range,
    params,
    anchor,
    noData,
    loadDemo,
    showHousehold: () => setScope("household"),
    reloadMeta: meta.reload,
    setReportQuestion,
    open,
  };
  // the state a component keeps in the address (the order of a table): a change replaces the entry, it adds no step to Back
  const address: PageAddress = {
    search,
    change: (patch) => void navigateTo({ to: ".", search: (prev: Record<string, string | undefined>) => ({ ...prev, ...patch }), hash: true, replace: true }),
  };

  // only a confirmed logout ends the session: the cookie is HttpOnly, so a failed request would leave it alive
  const signOut = async () => {
    // the figures kept on the device go first, whether or not the server can be asked: this is the person's way to take them off
    await forgetFigures();
    try {
      await api("/api/auth/logout", { method: "POST" });
      forgetAnswers();
      onSignedOut();
    } catch {
      // still signed in, so the figures go on being kept from the next answer
      holdFiguresFor(user);
      setMenuError(t("shell.sign_out_failed"));
    }
  };

  // a choice reloads the page, so every text and figure is made again in the new language
  const otherLanguage: Language = LANGUAGES.find((l) => l !== user.language) ?? user.language;
  const chooseLanguage = async (language: Language) => {
    if (changingLanguage) return;
    setChangingLanguage(true);
    try {
      await api("/api/language", { method: "PUT", body: { language } });
      window.location.reload();
    } catch (e) {
      setMenuError((e as Error).message);
      setChangingLanguage(false);
    }
  };

  return (
    <MetaContext.Provider value={m}>
      <ShellContext.Provider value={shell}>
      <PageAddressContext.Provider value={address}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
        {t("shell.skip")}
      </a>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            Omatalous
          </div>
          <nav className="nav" aria-label={t("shell.main_menu")}>
            {NAV.map((e) => (
              <PageLink key={e.id} id={e.id} className={e.id === REVIEW.id ? "review-link" : undefined} current={page === e.id && !(e.id === "reports" && more)}>
                {e.label}
                {/* Tarkistettavat carries the count of its open items, the same count the page shows */}
                {e.id === REVIEW.id && open > 0 && (
                  <span className="nav-count">
                    {open}
                    <span className="sr-only"> {openWord()}</span>
                  </span>
                )}
              </PageLink>
            ))}
          </nav>
          <span className="spacer" />
          {hasHousehold && (
            <Segmented
              className="scope-toggle"
              label={t("shell.scope")}
              value={effectiveScope}
              options={[{ value: "own", label: t("shell.scope_own") }, { value: "household", label: t("shell.scope_household") }]}
              onChange={setScope}
            />
          )}
          <details className="user-menu" ref={userMenu}>
            <summary>
              <span className="sr-only">{t("shell.user_menu")} </span>
              <span className="avatar" aria-hidden="true">
                {initials}
              </span>
              <span className="small" title={user.displayName}>{user.displayName}</span>
            </summary>
            {/* choosing an item closes the menu */}
            <div className="menu" onClick={(e) => ((e.currentTarget.parentElement as HTMLDetailsElement).open = false)}>
              <div className="muted">
                {user.username} · {user.role === "admin" ? t("shell.role_admin") : t("shell.role_member")}
                <br />
                Omatalous {m.version.app}
              </div>
              <button type="button" disabled={changingLanguage} onClick={() => void chooseLanguage(otherLanguage)} lang={otherLanguage}>
                {LANGUAGE_NAME[otherLanguage]}
              </button>
              <a href={MORE.hash} aria-current={more ? "page" : undefined}>{MORE.label}</a>
              <PageLink id={ROWS.id} current={page === ROWS.id}>
                {ROWS.label}
              </PageLink>
              {extensions.map((e) => (
                <PageLink key={e.id} id={e.id} current={page === e.id}>
                  {e.page!.label}
                </PageLink>
              ))}
              <PageLink id={SETTINGS.id} current={page === SETTINGS.id}>
                {SETTINGS.label}
              </PageLink>
              <button type="button" onClick={signOut}>
                {t("shell.sign_out")}
              </button>
            </div>
          </details>
        </div>
      </header>

      <div className="app">
        {figuresFrom && (
          <Notice tone="warning" role="status">
            {t("shell.offline_kept", { time: dateTime(figuresFrom) })}{" "}
            <Button variant="link" onClick={fetchAgain}>
              {t("shell.fetch_again")}
            </Button>
          </Notice>
        )}
        {meta.error && <Notice tone="warning">{t("shell.offline_old")}</Notice>}
        {failure && <Notice tone="warning">{failure}</Notice>}
        {menuError && <Notice tone="warning">{menuError}</Notice>}
        <SecurityNotices />
        {loadedBuild && m.version.build !== loadedBuild && (
          <Notice tone="good">
            {t("shell.new_version", { version: m.version.app })}{" "}
            <Button variant="link" onClick={() => window.location.reload()}>
              {t("shell.reload")}
            </Button>
          </Notice>
        )}
        {arrived > 0 && (
          <Notice tone="good">
            {arrived === 1 ? t("shell.rows_arrived_one", { count: count(arrived) }) : t("shell.rows_arrived_many", { count: count(arrived) })}.{" "}
            <Button variant="link" onClick={showArrived}>
              {t("shell.show")}
            </Button>
          </Notice>
        )}
        {consents.map((n) => (
          <Notice key={n.id} tone="warning">
            {consentNoticeText(n)}{" "}
            {n.kind === "left_out" && canLinkAccounts && (
              <>
                <a href={CONTROL_PANEL} target="_blank" rel="noopener noreferrer">
                  {t("shell.open_control_panel")}
                </a>{" "}
              </>
            )}
            <a href={CONNECT_BANK_HASH}>{t("shell.reconnect")}</a>
          </Notice>
        ))}

        <main id="main" tabIndex={-1}>
        <h1 className="sr-only">{pageLabel}</h1>
        {presets.length > 0 && (m.accounts.length > 0 || hasHousehold) && (
          <div className="filters" role="toolbar" aria-label={t("shell.period")}>
            <Segmented
              label={t("shell.period")}
              value={period}
              options={presets.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(id) => navigate(page, { period: id }, true)}
            />
            <span className="range-label">
              {dateRange(range.from, range.to)}
            </span>
          </div>
        )}

        <div className="sheet" key={pageKey}>
          {known ? <Outlet /> : <Navigate to="/overview" replace />}
        </div>
        </main>
        <footer className="sheet-foot">
          <AboutFoot version={m.version.app} />
          {foot && <span aria-live="polite">{foot}</span>}
        </footer>
      </div>
      </PageAddressContext.Provider>
      </ShellContext.Provider>
    </MetaContext.Provider>
  );
}
