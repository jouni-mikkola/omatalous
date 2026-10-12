import { coverOf, type MarkKind } from "@banking/core";
import { type ReactNode, useState } from "react";
import { api, query } from "../api.ts";
import { PaceChart } from "../charts/PaceChart.tsx";
import { categoryColor } from "../charts/palette.ts";
import { Alerts } from "../components/Alerts.tsx";
import { DataScope } from "../components/DataScope.tsx";
import { Holdings } from "../components/holdings/Holdings.tsx";
import { Loading } from "../components/Loading.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { EmptyStart } from "../components/EmptyStart.tsx";
import { BarList } from "../components/BarList.tsx";
import { Insights } from "../components/Insights.tsx";
import { NextDays } from "../components/NextDays.tsx";
import { bridgeIncome } from "../components/month-parts.ts";
import { SurplusBridge } from "../components/SurplusBridge.tsx";
import { date, dayMonth, money, monthLong, percent, signedMoney } from "../format.ts";
import { navigate, useApi } from "../hooks.ts";
import type { DashboardData, Meta, ReportsData, Scope } from "../types.ts";
import { reportContext } from "./reports/context.ts";
import { reportsOf, visibleSections } from "./reports/registry.ts";
import { section as incomeSection } from "./reports/sections/Income.tsx";
import { section as monthsSection } from "./reports/sections/Pivot.tsx";
import "../styles/overview.css";
import { SETTINGS_ANCHOR } from "../routes.ts";

/** "+12 %", "−5 %" or "±0 %": the change from the earlier figure; null when there is nothing to compare with. */
function pctChange(current: number, previous: number): string | null {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  // U+2212 for a fall, the same minus as everywhere else in the app
  return pct === 0 ? "±0 %" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`;
}

/** "2026-09-01", "2026-09-09" → "1.–9.9."; across months "28.8.–9.9." */
function dayRange(from: string, to: string): string {
  const a = dayMonth(from);
  const b = dayMonth(to);
  if (from === to) return b;
  return from.slice(0, 7) === to.slice(0, 7) ? `${a.split(".")[0]}.–${b}` : `${a}–${b}`;
}

export function Overview({
  meta,
  range,
  scope,
  onEmptyAction,
  onShowHousehold,
}: {
  meta: Meta;
  range: { from: string; to: string };
  scope: Scope;
  onEmptyAction: () => Promise<void>;
  onShowHousehold: () => void;
}) {
  const hasData = meta.accounts.length > 0 || (scope === "household" && meta.sharedAccounts.length > 0);
  // no request while there are no accounts: the first one after demo data or a sync is a fresh fetch
  const { data, error, loading, reload } = useApi<DashboardData>(hasData ? `/api/dashboard${query({ ...range, scope })}` : null);
  // a month that has ended is told by the sections of this page (Menojen muutos); the running one by its spending card
  const ended = range.to < meta.today;
  const monthReports = reportsOf("month");
  const reports = useApi<ReportsData>(hasData && ended && monthReports.length ? `/api/reports${query({ ...range, scope, reports: monthReports.join(",") })}` : null);

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
        reload();
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
  if (!hasData) return <EmptyStart onDemo={onEmptyAction} />;
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const { totals, previousTotals, colorOrder, comparable } = data;
  // a running period is compared with the same days of the previous one
  // the year only when the comparison falls in another year (Tämä vuosi, or January)
  const prevYear = data.range.previousTo.slice(0, 4) === data.range.to.slice(0, 4) ? "" : data.range.previousTo.slice(0, 4);
  const vs = data.running ? `verrattuna ${dayRange(data.range.previousFrom, data.range.previousTo)}${prevYear}` : "edellisestä jaksosta";
  const goToCategory = (category: string) => navigate("transactions", { category, from: range.from, to: range.to });

  const restCents = data.categories.slice(9).reduce((s, c) => s + c.cents, 0);
  const barItems = [
    ...data.categories.slice(0, 9).map((c) => ({
      key: c.category,
      label: c.label,
      value: c.cents,
      valueText: money(c.cents, false),
      sub: comparable && c.previousCents ? signedMoney(c.cents - c.previousCents) : undefined,
      color: categoryColor(c.category, colorOrder),
    })),
    ...(restCents > 0
      ? [{ key: "rest", label: `Muut (${data.categories.length - 9})`, value: restCents, valueText: money(restCents, false), color: "var(--series-rest)", link: false }]
      : []),
  ];
  const expenseChange = comparable ? pctChange(totals.expenseCents, previousTotals.expenseCents) : null;
  const categoriesSub = [
    `Menot ${money(totals.expenseCents, false)}`,
    expenseChange ? `${expenseChange} ${vs}` : !comparable && data.dataFrom ? `ei vertailua, tiedot alkavat ${date(data.dataFrom)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const reportCtx = reports.data ? reportContext(reports.data, meta, range, scope) : null;
  const monthSections = reportCtx && ended ? visibleSections(reportCtx, "month") : [];

  return (
    <div className={`stack ${loading ? "loading" : ""}`}>
      <DataScope meta={meta} scope={scope} signals={data.dataSignals} />

      {data.dataNotice && (
        <ul className="alerts" aria-label="Tietojen laatu">
          <li className="alert warning">
            <a href={`#/settings#${SETTINGS_ANCHOR.quality}`}>
              <span className="sr-only">Huomio: </span>
              <span className="alert-title">{data.dataNotice.title}</span>
              <span className="alert-detail">{data.dataNotice.detail}</span>
            </a>
          </li>
        </ul>
      )}

      <Holdings holdings={data.holdings} meta={meta} />

      {data.running && <SpendingCard pace={data.pace} />}

      {data.ahead && (
        <div className="card">
          <NextDays ahead={data.ahead} />
        </div>
      )}

      <div className="card">
        {/* The running month tells last month's split in one line: the card itself is the month before's */}
        {data.running && (data.bridge.basis === "last" || data.bridge.basis === "partial") ? (
          <BridgeLine b={data.bridge} />
        ) : (
          <SurplusBridge totals={data.bridge.totals} title="Mihin tulot menivät" heading="h2" sub={bridgeSub(data.bridge, data.range.to.slice(0, 7))} />
        )}
        {data.fixedMonthlyCents > 0 && (
          <p className="bridge-fixed">
            Kiinteät menot <strong>{money(data.fixedMonthlyCents, false)}</strong> kuukaudessa · <a href="#/bills">Laskut</a>
          </p>
        )}
      </div>

      {monthSections.map((sec) => (
        <sec.Component key={sec.id} ctx={reportCtx!} />
      ))}
      {reports.error && !reports.data && <ErrorCard message={reports.error} onRetry={reports.reload} />}

      <Alerts alerts={data.alerts.filter((a) => !answered.has(a.id))} range={range} onMark={answer} busy={marking || loading} />
      {/* Säästövinkit answers the insights as Muut havainnot; while that page is switched off they stay here */}
      {!meta.features.optimise && <Insights insights={data.insights.filter((i) => !answered.has(i.id)).slice(0, 3)} onDismiss={(id, subject) => answer(id, subject, "dismissed")} busy={marking || loading} />}
      {markError && (
        <div className="error" role="alert">
          {markError}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Kategoriat</h2>
            <div className="card-sub">{categoriesSub}</div>
          </div>
        </div>
        <BarList items={barItems} onSelect={goToCategory} />
        <p className="month-links small">
          <a href={`#/transactions${query({ view: "merchants", from: range.from, to: range.to })}`}>Kauppiaat</a>
          <a href={`#/reports${query({ period: "12m" })}#${monthsSection.id}`}>Menot kuukausittain</a>
        </p>
      </div>
    </div>
  );
}

/**
 * The running month's line on last month's income: the month, partial while the history has no complete month, its income and
 * savings rate, the credit drawn when there was some (`coverOf`, as the table of Tulot ja menot names it), and a link
 * to the month before, where the split is.
 */
export function BridgeLine({ b }: { b: DashboardData["bridge"] }) {
  const { incomeCents: income, savingsRate } = b.totals;
  const credit = coverOf(b.totals).creditDrawnCents;
  return (
    <p className="bridge-fixed">
      {capitalize(monthLong(b.month!).split(" ")[0]!)}
      {b.basis === "partial" ? " (vajaa)" : ""}: tulot <strong>{money(income, false)}</strong>
      {savingsRate !== null && `, säästöön ${percent(savingsRate)}`}
      {credit > 0 && `, luotonnostot ${money(credit, false)}`} · <a href={`#/overview${query({ period: "last-month" })}`}>Mihin tulot menivät</a>
    </p>
  );
}

/**
 * What the split of income covers, and for one month whether income and saving are above or below the usual: the usual
 * is the median of the complete months before it, so it shows only when there are three.
 */
function bridgeSub(b: DashboardData["bridge"], runningMonth: string): ReactNode {
  const month = b.month ? capitalize(monthLong(b.month)) : null;
  // "last" shows the latest complete month while another one runs, so the clause names the running one
  const running = monthLong(runningMonth).split(" ")[0];
  const basis =
    b.basis === "last"
      ? `${month} (${running} on kesken)`
      : b.basis === "partial"
        ? `${month}, vajaa kuukausi (${running} on kesken)`
        : b.basis === "settled"
        ? `${month ? `${month}, ilman` : "Ilman"} kesken olevaa kuukautta`
        : b.basis === "running"
          ? "Kuukausi on kesken, palkka voi puuttua"
          : month;
  const { incomeCents: income, savingsRate } = b.totals;
  // the figure the change is told from: earned income, as the usual income is
  const named = bridgeIncome(b);
  const incomeChange = named.usualCents ? pctChange(named.cents, named.usualCents) : null;
  return (
    <>
      {basis && <div>{basis}</div>}
      {b.month && income > 0 && (
        <div>
          <a href={`#/reports#${incomeSection.id}`}>{named.label}</a> {money(named.cents, false)}
          {incomeChange && `, ${incomeChange} tavallisesta`}
          {savingsRate !== null && `, säästöön ${percent(savingsRate)}${b.usualSavingsRate !== null ? ` (tavallisesti ${percent(b.usualSavingsRate)})` : ""}`}
        </div>
      )}
    </>
  );
}

/**
 * What the running month has cost so far, set against the month before on the same day, and how it has gone (Menojen
 * kertymä). Nothing is forecast: both lines are sums of real rows. The month is named, because the period on the page
 * can be longer.
 */
function SpendingCard({ pace }: { pace: DashboardData["pace"] }) {
  const { previous } = pace;
  return (
    <section className="card spending-card" aria-labelledby="spending-h">
      <div className="card-head">
        <div>
          <h2 id="spending-h">Menot</h2>
          <div className="card-sub">{capitalize(monthLong(pace.month))}</div>
        </div>
      </div>
      <div className="spending-body">
        <div>
          <div className="tile-value">{money(pace.currentTotal, false)}</div>
          {previous && (
            <div className="tile-note">
              {monthName(previous.month)}ssa {dayMonth(`${previous.month}-${String(previous.day).padStart(2, "0")}`)} mennessä {money(previous.toToday, false)}
            </div>
          )}
        </div>
        <div className="spending-pace">
          <h3>Menojen kertymä</h3>
          {pace.currentTotal <= 0 ? (
            <p className="muted small">Ei vielä menoja tässä kuussa.</p>
          ) : (
            <PaceChart current={pace.current} previous={previous?.curve ?? null} names={{ current: monthName(pace.month), previous: previous ? monthName(previous.month) : "" }} />
          )}
        </div>
      </div>
    </section>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "2026-10" → "Lokakuu": the month's name alone. */
const monthName = (month: string) => capitalize(monthLong(month).replace(/ \d+$/, ""));
