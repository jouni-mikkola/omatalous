import type { MarkKind } from "@banking/core";
import { useRef, useState } from "react";
import { api, query } from "../api.ts";
import { Holdings } from "../components/holdings/Holdings.tsx";
import { Housing } from "../components/housing/Housing.tsx";
import { Loading } from "../components/Loading.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { EmptyStart } from "../components/EmptyStart.tsx";
import { NextDays } from "../components/NextDays.tsx";
import { Notices } from "../components/Notices.tsx";
import { Differs } from "../components/overview/Differs.tsx";
import { IncomeSpending } from "../components/overview/IncomeSpending.tsx";
import { KeyFigures } from "../components/overview/KeyFigures.tsx";
import { Pace } from "../components/overview/Pace.tsx";
import { useApi } from "../hooks.ts";
import { periodRange, periodsOf } from "../period.ts";
import type { DashboardData, Meta, ReportsData, Scope } from "../types.ts";
import { reportContext } from "./reports/context.ts";
import { reportsOf, visibleSections } from "./reports/registry.ts";
import { section as settlementSection } from "./reports/sections/Settlement.tsx";
import { section as loansSection } from "./reports/sections/Loans.tsx";
import "../styles/overview.css";
import "../styles/statement.css";

/**
 * Yhteenveto, blocks in one order: the key figures, the month's spending against the usual month (Menot tässä kuussa),
 * what the household has and owes (Varallisuus), what is due before the next pay (Erääntyvät maksut), what the home
 * costs (Asuminen), what came in and went out in the chosen month (Tulot ja menot) with, while the month runs, why it
 * differs from the usual one beside it, and the alerts (Ilmoitukset). No block asks a question: those are on
 * Tarkistettavat. A block is drawn by its own answer alone, never inside another's condition.
 * The blocks before "Tulot ja menot" always tell today, so a month that has ended makes a second request for the month
 * and the first stays the running month's.
 */
export function Overview({
  meta,
  period,
  scope,
  onEmptyAction,
  onShowHousehold,
}: {
  meta: Meta;
  period: string;
  scope: Scope;
  onEmptyAction: () => Promise<void>;
  onShowHousehold: () => void;
}) {
  const hasData = meta.accounts.length > 0 || (scope === "household" && meta.sharedAccounts.length > 0);
  const range = periodRange(period, meta.today);
  // a month that has ended is not today: the blocks above the month still tell today, from the request for the running month
  const ended = range.to < meta.today;
  // no request while there are no accounts: the first one after demo data or a sync is a fresh fetch
  const now = useApi<DashboardData>(hasData ? `/api/dashboard${query({ ...periodRange("month", meta.today), scope })}` : null);
  const past = useApi<DashboardData>(hasData && ended ? `/api/dashboard${query({ ...range, scope })}` : null);
  // a month that has ended is told by the sections of this page (Menojen muutos); the running one by the usual view of the same report beside its waterfall
  const monthReports = reportsOf("month");
  const reports = useApi<ReportsData>(hasData && monthReports.length ? `/api/reports${query({ ...range, scope, reports: monthReports.join(",") })}` : null);
  // the first paint waits for both answers; after it a switch of the month keeps the page and waits inside the block
  const shown = useRef(false);

  // alerts and insights the household has answered: gone at once, the reload below only confirms it
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const answer = (id: string, subject: string, mark: MarkKind) => {
    setMarking(true);
    setMarkError(null);
    api("/api/marks", { method: "PUT", body: { subject, mark } })
      .then(() => {
        setAnswered((prev) => new Set(prev).add(id));
        now.reload();
        past.reload();
      })
      .catch((e: Error) => setMarkError(e.message))
      .finally(() => setMarking(false));
  };

  // a member who only sees accounts shared with them has nothing under "Oma"
  if (!hasData && meta.sharedAccounts.length > 0) {
    return (
      <div className="card" style={{ maxWidth: 640 }}>
        <h2>Ei omia tilejä</h2>
        <p className="muted">Sinulle jaetut tilit näkyvät kohdassa Koko talous.</p>
        <button className="btn btn-primary" type="button" onClick={onShowHousehold}>
          Näytä koko talous
        </button>
      </div>
    );
  }
  if (!hasData) return <EmptyStart onDemo={onEmptyAction} meta={meta} />;
  const failed = (now.error && !now.data ? now.error : null) ?? (ended && past.error && !past.data ? past.error : null);
  if (failed) {
    return (
      <ErrorCard
        message={failed}
        onRetry={() => {
          now.reload();
          past.reload();
        }}
      />
    );
  }
  if (!now.data || (ended && !past.data && !shown.current)) return <Loading shape="overview" />;
  shown.current = true;

  // the chosen month's answer: the running month's own, or the one asked for; null while it is on its way
  const data = ended ? past.data : now.data;
  const loading = now.loading || past.loading;
  const today = now.data;

  const reportCtx = reports.data ? reportContext(reports.data, meta, range, scope) : null;
  const monthSections = reportCtx && ended ? visibleSections(reportCtx, "month") : [];
  const differs = !ended ? (reports.data?.spendingChange?.views.find((v) => v.view === "usual") ?? null) : null;
  const busy = marking || loading;

  return (
    <div className={`page-grid front${loading ? " loading" : ""}`}>
      <KeyFigures data={today} scope={scope} />

      <Pace data={today} scope={scope} />

      <Holdings holdings={today.holdings} meta={meta} scope={scope} />

      {today.ahead && <NextDays ahead={today.ahead} scope={scope} />}

      {today.housing && <Housing housing={today.housing} reportAnchor={loansSection.id} />}

      <div className={differs ? "span-7 front-cell" : "front-cell"}>
        <IncomeSpending data={data} scope={scope} period={period} presets={periodsOf("overview", meta.today)} anchors={{ settlement: settlementSection.id }} categories={new Map(meta.categories.map((c) => [c.id, c.label]))} />
      </div>
      {differs && (
        <div className="span-5 front-cell">
          <Differs view={differs} />
        </div>
      )}

      {monthSections.map((sec) => (
        <sec.Component key={sec.id} ctx={reportCtx!} />
      ))}
      {reports.error && !reports.data && <ErrorCard message={reports.error} onRetry={reports.reload} />}

      {/* Säästövinkit answers the insights as Muut havainnot; while that page is switched off they stay here */}
      {data && <Notices data={data} range={range} answered={answered} insights={!meta.features.optimise} onAnswer={answer} busy={busy} error={markError} />}
    </div>
  );
}
