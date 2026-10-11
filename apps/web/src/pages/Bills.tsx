/**
 * Decision: what to cancel, and how much to keep aside for the bills ahead.
 *
 * Laskut answers what is coming and what the household is tied to. The line on top says what the fixed costs are and
 * how much of them is subscriptions. Below it, in the order of the `order` numbers: Tulossa (the next 30 days, one
 * list), Tilaukset with the marks, the table of price changes under it, Sopimukset ja laskut, the savings plans, the rare
 * bills of the next twelve months, and the series that have ended. Every figure comes from one definition in core
 * (`isSubscription`, `isContract`, `isSavingsPlan`), so Tilaukset and Sopimukset ja laskut add up to the line on top, and
 * a merchant marked as cancelled is out of every total.
 */
import {
  cancelledMerchants,
  fixedSplit,
  inUseQuietsQuestion,
  isContract,
  isSavingsPlan,
  isSubscription,
  NO_INPUTS,
  subscriptionsMonthlyCents,
  type UserMark,
} from "@banking/core";
import { type ReactNode, useState } from "react";
import { api, query } from "../api.ts";
import { Coming } from "../components/bills/Coming.tsx";
import { monthlyOf, SeriesTable } from "../components/bills/series.tsx";
import { type MarkControls, Subscriptions } from "../components/bills/Subscriptions.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Loading } from "../components/Loading.tsx";
import { money, plural } from "../format.ts";
import { useApi } from "../hooks.ts";
import type { DashboardData, Meta, Recurring as Series, ReportsData, Scope } from "../types.ts";
import { reportContext } from "./reports/context.ts";
import { reportsOf, visibleSections } from "./reports/registry.ts";
import type { ReportRange } from "./reports/types.ts";
import "../styles/bills.css";

/** What has ended and is not pay or a shop habit: those have no place on a page about bills. */
const hasEnded = (s: Series) => !s.active && s.kind !== "habit" && s.kind !== "income";

export function Bills({ meta, range, scope }: { meta: Meta; range: ReportRange; scope: Scope }) {
  const recurring = useApi<{ series: Series[]; marks: UserMark[] }>(`/api/recurring${query({ scope })}`);
  // the rows of Tulossa are the dashboard's next 30 days, the sections read the reports: both for the month of today
  const reports = useApi<ReportsData>(`/api/reports${query({ ...range, scope, reports: reportsOf("bills").join(",") })}`);
  const dashboard = useApi<DashboardData>(`/api/dashboard${query({ ...range, scope })}`);
  // what the last save answered: fresher than the list the page was loaded with
  const [saved, setSaved] = useState<UserMark[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
  const marks = new Map(markList.map((m) => [m.subject, m]));
  const cancelled = cancelledMerchants({ ...NO_INPUTS, marks: markList });
  const controls: MarkControls = {
    markOf: (merchant) => {
      const m = marks.get(`merchant:${merchant}`);
      return m && (m.mark === "cancelled" || inUseQuietsQuestion(m, meta.today)) ? m : null;
    },
    busy,
    set: (merchant, mark) => {
      const subject = `merchant:${merchant}`;
      setBusy(merchant);
      setMarkError(null);
      api<{ marks: UserMark[] }>("/api/marks", { method: "PUT", body: { subject, mark } })
        .then((res) => {
          setSaved(res.marks);
          // a merchant marked as cancelled leaves the list of what is coming
          dashboard.reload();
        })
        .catch((e: Error) => setMarkError(e.message))
        .finally(() => setBusy(null));
    },
  };

  // what leaves for good, savings and card bills not included; a merchant marked as cancelled is out
  const fixed = fixedSplit(series, cancelled);
  const fixedTotal = fixed.consumptionCents + fixed.debtCents;
  // one definition of a subscription and one total: the line on top, the card header and the rows below all come from these
  const allSubs = series.filter(isSubscription);
  const subs = allSubs.filter((s) => !cancelled.has(s.merchant));
  const stopped = allSubs.filter((s) => cancelled.has(s.merchant));
  const subsMonthly = subscriptionsMonthlyCents(series, cancelled);
  const byCost = (a: Series, b: Series) => b.monthlyCents - a.monthlyCents;
  const contracts = series.filter((s) => isContract(s) && !cancelled.has(s.merchant)).sort(byCost);
  const savings = series.filter((s) => isSavingsPlan(s) && !cancelled.has(s.merchant)).sort(byCost);
  const ended = series.filter(hasEnded);

  // a typed-in bill or a mark changes what the reports and the next 30 days hold
  const refresh = () => {
    reports.reload();
    dashboard.reload();
  };
  const ctx = reportContext(reports.data, meta, range, scope, refresh);

  // the numbers share one scale with the `order` of the sections that are shown on this page
  const parts: { order: number; node: ReactNode }[] = [
    { order: 10, node: <Coming key="coming" ahead={dashboard.data.ahead} today={meta.today} label={label} onAdded={refresh} /> },
    { order: 20, node: <Subscriptions key="subs" subs={subs} stopped={stopped} total={subsMonthly} controls={controls} label={label} /> },
    { order: 40, node: <Contracts key="contracts" rows={contracts} label={label} /> },
    { order: 45, node: <Savings key="savings" rows={savings} label={label} /> },
    { order: 60, node: <Ended key="ended" rows={ended} label={label} /> },
    ...visibleSections(ctx, "bills").map((s) => ({ order: s.order, node: <s.Component key={s.id} ctx={ctx} /> })),
  ];
  parts.sort((a, b) => a.order - b.order);

  return (
    <div className={`stack ${recurring.loading || reports.loading || dashboard.loading ? "loading" : ""}`}>
      {fixedTotal > 0 && (
        <p className="bills-line">
          Kiinteät menot <strong>{money(fixedTotal, false)}</strong> kuussa
          {subsMonthly > 0 && (
            <>
              , joista tilauksia <strong>{money(subsMonthly, false)}</strong>
            </>
          )}
        </p>
      )}
      {markError && (
        <div className="error" role="alert">
          {markError}
        </div>
      )}
      {parts.map((p) => p.node)}
      {!series.length && <div className="card empty">Toistuvia maksuja ei vielä löytynyt. Ne tunnistetaan, kun samalta kauppiaalta on useita maksuja eri kuukausina.</div>}
    </div>
  );
}

/** Phone, insurance, housing and loans next to the bills: what the household is tied to. */
function Contracts({ rows, label }: { rows: Series[]; label: (id: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Sopimukset ja laskut</h2>
          <div className="card-sub">Puhelin, vakuutukset, asuminen ja lainat kuuluvat kiinteisiin menoihin.</div>
        </div>
        <strong>{money(monthlyOf(rows), false)}/kk</strong>
      </div>
      <SeriesTable rows={rows} label={label} />
    </div>
  );
}

/** A monthly fund saving leaves the account like a bill, but the money is kept: apart from the fixed costs. */
function Savings({ rows, label }: { rows: Series[]; label: (id: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Säännöllinen säästäminen</h2>
          <div className="card-sub">Kuukausisäästö ei ole kiinteä meno, joten se ei ole mukana kiinteissä menoissa.</div>
        </div>
        <strong>{money(monthlyOf(rows), false)}/kk</strong>
      </div>
      <SeriesTable rows={rows} label={label} />
    </div>
  );
}

/** Folded: what has stopped is looked at when a bill is missing, not every visit. */
function Ended({ rows, label }: { rows: Series[]; label: (id: string) => string }) {
  if (!rows.length) return null;
  return (
    <details className="card">
      <summary>
        <strong>Loppuneet</strong> <span className="muted small">· {plural(rows.length, "maksu", "maksua")}</span>
      </summary>
      <SeriesTable rows={rows} label={label} ended />
    </details>
  );
}
