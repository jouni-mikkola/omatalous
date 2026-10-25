/**
 * Decision: which bill of the month to chase, what to cancel, and how much to keep aside for the bills ahead.
 *
 * Laskut answers whether every bill of the month has gone and what is still to leave. The month board comes first (a
 * missed bill first of all, the month's due and the fixed costs of a month in its head and strip). Below it, in the
 * order of the `order` numbers: Erääntyvät maksut (the next 30 days, one list) beside Tilaukset, the subscriptions whose
 * price moved, Sopimukset ja laskut beside the savings plans, the rare bills of the next twelve months, and the series
 * that have ended. Every figure comes from one definition in core (`billMonth`, `isSubscription`, `isContract`,
 * `isSavingsPlan`) and opens its rows where the app works it out; a subscription marked as cancelled is out of every
 * total. A mark is on one series (`seriesMarkSubject`); an old one on a merchant still covers every series of it.
 * Instalment plans and loans are asked in Tarkistettavat, never here.
 */
import {
  addMonthsToDate,
  type AheadGroup,
  cancelledSubjects,
  contractsMonthlyCents,
  countingMark,
  isCancelled,
  isContract,
  isEndedContract,
  isFixedCost,
  isSavingsPlan,
  isSubscription,
  type MarkKind,
  marksBySubject,
  NO_INPUTS,
  savingsPlansMonthlyCents,
  seriesMarkSubject,
  subscriptionsMonthlyCents,
  type UserMark,
} from "@banking/core";
import { type ReactNode, useState } from "react";
import { api, query } from "../api.ts";
import { Coming } from "../components/bills/Coming.tsx";
import { EndedContracts } from "../components/bills/EndedContracts.tsx";
import { type BillMonthAnswer, MonthBoard, MonthBoardSkeleton } from "../components/bills/MonthBoard.tsx";
import { PriceSteps } from "../components/bills/PriceSteps.tsx";
import { SeriesTable, TitleBlock } from "../components/bills/series.tsx";
import { type MarkControls, Subscriptions } from "../components/bills/Subscriptions.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { useApi } from "../hooks.ts";
import type { DashboardData, Meta, Recurring as Series, ReportsData, Scope } from "../types.ts";
import { reportContext } from "./reports/context.ts";
import { reportsOf, visibleSections } from "./reports/registry.ts";
import type { ReportRange } from "./reports/types.ts";
import "../styles/table.css";
import "../styles/bills.css";
import "../styles/statement.css";

/** The width of the report sections that stand beside the cards of this page. */
const SECTION_SPAN: Record<string, 6 | undefined> = { tulevat: 6 };
/** The table of price changes: the tiles of the subscriptions whose price moved say each move and its year (PD-laskut 5). */
const REPLACED = new Set(["hinnat"]);

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
  // the rows of Tulossa are the next 30 days, the sections read the reports: both for the month of today
  const reports = useApi<ReportsData>(`/api/reports${query({ ...range, scope, reports: reportsOf("bills").join(",") })}`);
  const ahead = useApi<{ ahead: (NonNullable<DashboardData["ahead"]> & { groups: AheadGroup[] }) | null }>(`/api/ahead${query({ scope })}`);
  // the month the board shows: this one until an arrow is pressed
  const [month, setMonth] = useState<string | null>(null);
  const board = useApi<BillMonthAnswer>(`/api/bill-month${query({ scope, ...(month ? { month } : {}) })}`);
  // what the last save answered: fresher than the list the page was loaded with
  const [saved, setSaved] = useState<UserMark[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const failed = [recurring, reports, ahead, board].find((r) => r.error && !r.data);
  if (failed) {
    return (
      <ErrorCard
        message={failed.error ?? ""}
        onRetry={() => {
          recurring.reload();
          reports.reload();
          ahead.reload();
          board.reload();
        }}
      />
    );
  }
  if (!recurring.data || !reports.data || !ahead.data || !board.data) return <BillsLoading />;

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
        // a subscription marked as cancelled leaves the list of what is coming and the month board
        ahead.reload();
        board.reload();
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

  // the fixed costs of a month are the server's (`board.fixedMonthlyCents`); a bill among them makes the figure an estimate
  const fixedEstimate = series.some((x) => isFixedCost(x) && x.kind === "bill" && !isCancelled(cancelled, x));
  // one definition of a subscription and one total: the row on top, the card header and the rows below all come from these
  const allSubs = series.filter(isSubscription);
  const subs = allSubs.filter((s) => !isCancelled(cancelled, s));
  const stopped = allSubs.filter((s) => isCancelled(cancelled, s));
  const subsMonthly = subscriptionsMonthlyCents(series, cancelled);
  const cards = new Set(meta.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  // the fixed costs and the subscriptions are a month as the series run today: their rows (each series' latest charge) open up to today
  const nowRange = { from: `${meta.today.slice(0, 7)}-01`, to: meta.today };
  const byCost = (a: Series, b: Series) => b.monthlyCents - a.monthlyCents;
  const contracts = series.filter((s) => isContract(s) && !isCancelled(cancelled, s)).sort(byCost);
  const savings = series.filter((s) => isSavingsPlan(s) && !isCancelled(cancelled, s)).sort(byCost);
  // a contract that ended in the last two years has its own block; the folded list keeps the rest
  const since = addMonthsToDate(meta.today, -24);
  const endedContracts = series
    .filter((s) => s.contract && s.contract.lastDate >= since && isEndedContract(s, marks, meta.today) && !stopped.includes(s))
    .sort((a, b) => b.contract!.lastDate.localeCompare(a.contract!.lastDate));
  const ended = series.filter((s) => hasEnded(s) && !endedContracts.includes(s));

  // a typed-in bill or a mark changes what the reports and the next 30 days hold
  const refresh = () => {
    reports.reload();
    ahead.reload();
    board.reload();
  };
  const ctx = reportContext(reports.data, meta, range, scope, refresh);

  // the numbers share one scale with the `order` of the sections that are shown on this page
  // `span` is the panel's width in the twelve columns above a tablet: 5|7 for the list and Tilaukset, 6|6 below, the rest whole
  const parts: Part[] = [
    { order: 10, span: 5, node: <Coming key="coming" ahead={ahead.data.ahead} today={meta.today} onAdded={refresh} /> },
    { order: 20, span: 7, node: <Subscriptions key="subs" subs={subs} stopped={stopped} total={subsMonthly} controls={controls} label={label} cards={cards} today={meta.today} range={nowRange} scope={scope} /> },
    { order: 30, node: <PriceSteps key="steps" subs={subs} today={meta.today} /> },
    { order: 40, span: 6, node: (
      <>
        <Contracts key="contracts" rows={contracts} total={contractsMonthlyCents(series, cancelled)} label={label} />
        <EndedContracts key="ended-contracts" rows={endedContracts} />
      </>
    ) },
    { order: 45, span: 6, node: <Savings key="savings" rows={savings} total={savingsPlansMonthlyCents(series, cancelled)} label={label} /> },
    { order: 60, node: <Ended key="ended" rows={ended} label={label} /> },
    ...visibleSections(ctx, "bills").filter((s) => !REPLACED.has(s.id)).map((s) => ({ order: s.order, span: SECTION_SPAN[s.id], node: <s.Component key={s.id} ctx={ctx} /> })),
  ];
  parts.sort((a, b) => a.order - b.order);

  return (
    <div className={`page-grid ${recurring.loading || reports.loading || ahead.loading ? "loading" : ""}`}>
      {!series.length && (
        <div className="card span-12 bills-first">
          <h2>Kuukauden laskut</h2>
          <p>Laskut ja tilaukset näkyvät täällä, kun sama maksu on lähtenyt tililtä kolmena kuukautena.</p>
        </div>
      )}
      {series.length > 0 && <MonthBoard board={board.data.board} loading={board.loading} onMonth={setMonth} today={meta.today} scope={scope} fixedEstimate={fixedEstimate} fixedRange={nowRange} />}
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
    </div>
  );
}

/** The page while its answers are on the way: the board's frame first, then the panels below it at their size. */
function BillsLoading() {
  return (
    <div className="page-grid" role="status" aria-live="polite">
      <MonthBoardSkeleton />
      <div className="card skeleton span-5" aria-hidden="true">
        <span className="sk-bar sk-head" />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="sk-row">
            <span className="sk-bar sk-name" />
            <span className="sk-bar sk-num" />
          </span>
        ))}
      </div>
      <div className="card skeleton span-7" aria-hidden="true">
        <span className="sk-bar sk-head" />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="sk-row">
            <span className="sk-bar sk-name" />
            <span className="sk-bar sk-num" />
          </span>
        ))}
      </div>
      <span className="sr-only">Ladataan…</span>
    </div>
  );
}

/** Phone, insurance, housing and loans next to the bills: what the household is tied to. */
function Contracts({ rows, total, label }: { rows: Series[]; total: number; label: (id: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <TitleBlock title="Sopimukset ja laskut" total={total} />
      <SeriesTable rows={rows} label={label} contract />
    </div>
  );
}

/** A monthly fund saving leaves the account like a bill, but the money is kept: apart from the fixed costs. */
function Savings({ rows, total, label }: { rows: Series[]; total: number; label: (id: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <TitleBlock title="Säännöllinen säästäminen" total={total} />
      <SeriesTable rows={rows} label={label} />
    </div>
  );
}

/** What has stopped, looked at when a bill is missing. */
function Ended({ rows, label }: { rows: Series[]; label: (id: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Päättyneet maksut</h2>
      </div>
      <SeriesTable rows={rows} label={label} ended />
    </div>
  );
}
