/**
 * Decision: what to cancel, and how much to keep aside for the bills ahead.
 *
 * Laskut answers what is coming and what the household is tied to. The two rows on top say what the fixed costs are and
 * how much of them is subscriptions. Below them, in the order of the `order` numbers: Erääntyvät maksut (the next 30
 * days, one list) beside Tilaukset with the marks, Sopimukset ja laskut beside the savings plans, the rare bills of the
 * next twelve months beside the table of price changes, and the series that have ended. Every figure comes from one definition
 * in core (`isSubscription`, `isContract`, `isSavingsPlan`), so Tilaukset and Sopimukset ja laskut add up to the rows on top, and
 * a subscription marked as cancelled is out of every total. A mark is on one series (`seriesMarkSubject`); an old one on
 * a merchant still covers every series of it.
 */
import {
  cancelledSubjects,
  countingMark,
  fixedSplit,
  isCancelled,
  isContract,
  isSavingsPlan,
  isSubscription,
  type MarkKind,
  marksBySubject,
  NO_INPUTS,
  seriesMarkSubject,
  subscriptionsMonthlyCents,
  type UserMark,
} from "@banking/core";
import { type ReactNode, useState } from "react";
import { api, query } from "../api.ts";
import { Coming } from "../components/bills/Coming.tsx";
import { monthlyOf, SeriesTable, TitleBlock } from "../components/bills/series.tsx";
import { type MarkControls, Subscriptions } from "../components/bills/Subscriptions.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Figure } from "../components/Figure.tsx";
import { Loading } from "../components/Loading.tsx";
import { money } from "../format.ts";
import { useApi } from "../hooks.ts";
import type { DashboardData, Meta, Recurring as Series, ReportsData, Scope } from "../types.ts";
import { reportContext } from "./reports/context.ts";
import { reportsOf, visibleSections } from "./reports/registry.ts";
import type { ReportRange } from "./reports/types.ts";
import "../styles/bills.css";
import "../styles/statement.css";

/** The width of the report sections that stand beside the cards of this page. */
const SECTION_SPAN: Record<string, 6 | undefined> = { tulevat: 6, hinnat: 6 };

type Part = { order: number; span?: 5 | 6 | 7; node: ReactNode };

/**
 * Runs of half-width panels (`span: 6`) as two columns that stand side by side, so a short panel does not leave
 * an empty half beside a long one: the first of the run is the left column, the rest stack in the right one.
 * The parts keep their order in the page, so a phone and a screen reader still get them one after another.
 */
export function placeParts(parts: Part[]): (Part | { columns: [Part[], Part[]] })[] {
  const out: (Part | { columns: [Part[], Part[]] })[] = [];
  for (let i = 0; i < parts.length; ) {
    let end = i;
    while (end < parts.length && parts[end]!.span === 6) end++;
    if (end - i < 2) {
      out.push(parts[i]!);
      i++;
    } else {
      out.push({ columns: [[parts[i]!], parts.slice(i + 1, end)] });
      i = end;
    }
  }
  return out;
}

/** What has ended and is not pay or a shop habit: those have no place on a page about bills. */
const hasEnded = (s: Series) => !s.active && s.kind !== "habit" && s.kind !== "income";

export function Bills({ meta, range, scope }: { meta: Meta; range: ReportRange; scope: Scope }) {
  const recurring = useApi<{ series: Series[]; marks: UserMark[] }>(`/api/recurring${query({ scope })}`);
  // the rows of Tulossa are the dashboard's next 30 days, the sections read the reports: both for the month of today
  const reports = useApi<ReportsData>(`/api/reports${query({ ...range, scope, reports: reportsOf("bills").join(",") })}`);
  const dashboard = useApi<DashboardData>(`/api/dashboard${query({ ...range, scope })}`);
  // what the last save answered: fresher than the list the page was loaded with
  const [saved, setSaved] = useState<UserMark[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const failed = [recurring, reports, dashboard].find((r) => r.error && !r.data);
  if (failed) {
    return (
      <ErrorCard
        message={failed.error ?? ""}
        onRetry={() => {
          recurring.reload();
          reports.reload();
          dashboard.reload();
        }}
      />
    );
  }
  if (!recurring.data || !reports.data || !dashboard.data) return <Loading />;

  const { series } = recurring.data;
  const label = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;
  const markList = saved ?? recurring.data.marks;
  const marks = marksBySubject(markList);
  const cancelled = cancelledSubjects({ ...NO_INPUTS, marks: markList });
  const save = (subject: string, mark: MarkKind | null) => {
    setBusy(true);
    setMarkError(null);
    api<{ marks: UserMark[] }>("/api/marks", { method: "PUT", body: { subject, mark } })
      .then((res) => {
        setSaved(res.marks);
        // a subscription marked as cancelled leaves the list of what is coming
        dashboard.reload();
      })
      .catch((e: Error) => setMarkError(e.message))
      .finally(() => setBusy(false));
  };
  // a new mark is on the one series; a mark is taken away under its own subject, which for an old one is the merchant
  const controls: MarkControls = {
    markOf: (s) => countingMark(marks, s, meta.today),
    busy,
    set: (s, mark) => save(seriesMarkSubject(s), mark),
    clear: (mark) => save(mark.subject, null),
  };

  // what leaves for good, savings and card bills not included; a series marked as cancelled is out
  const fixed = fixedSplit(series, cancelled);
  const fixedTotal = fixed.consumptionCents + fixed.debtCents;
  // one definition of a subscription and one total: the row on top, the card header and the rows below all come from these
  const allSubs = series.filter(isSubscription);
  const subs = allSubs.filter((s) => !isCancelled(cancelled, s));
  const stopped = allSubs.filter((s) => isCancelled(cancelled, s));
  const subsMonthly = subscriptionsMonthlyCents(series, cancelled);
  const byCost = (a: Series, b: Series) => b.monthlyCents - a.monthlyCents;
  const contracts = series.filter((s) => isContract(s) && !isCancelled(cancelled, s)).sort(byCost);
  const savings = series.filter((s) => isSavingsPlan(s) && !isCancelled(cancelled, s)).sort(byCost);
  const ended = series.filter(hasEnded);

  // a typed-in bill or a mark changes what the reports and the next 30 days hold
  const refresh = () => {
    reports.reload();
    dashboard.reload();
  };
  const ctx = reportContext(reports.data, meta, range, scope, refresh);

  // the numbers share one scale with the `order` of the sections that are shown on this page
  // `span` is the panel's width in the twelve columns above a tablet: 5|7 for the list and Tilaukset, 6|6 below, the rest whole
  const parts: Part[] = [
    { order: 10, span: 5, node: <Coming key="coming" ahead={dashboard.data.ahead} today={meta.today} onAdded={refresh} /> },
    { order: 20, span: 7, node: <Subscriptions key="subs" subs={subs} stopped={stopped} total={subsMonthly} controls={controls} label={label} /> },
    { order: 40, span: 6, node: <Contracts key="contracts" rows={contracts} label={label} /> },
    { order: 45, span: 6, node: <Savings key="savings" rows={savings} label={label} /> },
    { order: 60, node: <Ended key="ended" rows={ended} label={label} /> },
    ...visibleSections(ctx, "bills").map((s) => ({ order: s.order, span: SECTION_SPAN[s.id], node: <s.Component key={s.id} ctx={ctx} /> })),
  ];
  parts.sort((a, b) => a.order - b.order);

  return (
    <div className={`page-grid ${recurring.loading || reports.loading || dashboard.loading ? "loading" : ""}`}>
      {fixedTotal > 0 && (
        <div className="card bills-top">
          <dl className="st-rows">
            <div className="st-row">
              <dt className="st-name">Kiinteät menot kuukaudessa</dt>
              <dd className="st-num">
                <Figure text={money(fixedTotal, false)} size="m" />
              </dd>
            </div>
            {subsMonthly > 0 && (
              <div className="st-row">
                <dt className="st-name">Tilaukset kuukaudessa</dt>
                <dd className="st-num">
                  <Figure text={money(subsMonthly, false)} size="m" />
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {markError && (
        <div className="error" role="alert">
          {markError}
        </div>
      )}
      {placeParts(parts).map((p) =>
        "columns" in p ? (
          p.columns.map((col, i) => (
            <div key={`col-${i}`} className="span-6 stack">
              {col.map((c) => c.node)}
            </div>
          ))
        ) : p.span ? (
          <div key={p.order} className={`span-${p.span}`}>{p.node}</div>
        ) : (
          p.node
        ),
      )}
      {!series.length && <div className="card empty">Ei toistuvia maksuja.</div>}
    </div>
  );
}

/** Phone, insurance, housing and loans next to the bills: what the household is tied to. */
function Contracts({ rows, label }: { rows: Series[]; label: (id: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <TitleBlock title="Sopimukset ja laskut" total={monthlyOf(rows)} />
      <SeriesTable rows={rows} label={label} />
    </div>
  );
}

/** A monthly fund saving leaves the account like a bill, but the money is kept: apart from the fixed costs. */
function Savings({ rows, label }: { rows: Series[]; label: (id: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <TitleBlock title="Säännöllinen säästäminen" total={monthlyOf(rows)} />
      <SeriesTable rows={rows} label={label} />
    </div>
  );
}

/** Folded: what has stopped is looked at when a bill is missing, not every visit. */
function Ended({ rows, label }: { rows: Series[]; label: (id: string) => string }) {
  if (!rows.length) return null;
  return (
    <details className="card">
      <summary className="card-head">
        <h2>Päättyneet maksut</h2>
      </summary>
      <SeriesTable rows={rows} label={label} ended />
    </details>
  );
}
