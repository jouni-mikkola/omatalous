/**
 * Decision: what is coming in the next 30 days and how much, and which bill, contract or subscription to drop.
 *
 * Laskut answers one question once: "Tulevat maksut". The 30 days come first as one timeline with its
 * sums, then the one table of the household's bills, contracts and subscriptions, with no search or sorting. A
 * payment is a dot on the timeline and a row of the table, never a list of its own. Every figure comes from one definition in core
 * (`fixedMonthlyCents`, `isSubscription`, `isContract`, `isSavingsPlan`) and opens its rows where the
 * app works it out; a subscription marked as cancelled is out of every total. A mark is on one series
 * (`seriesMarkSubject`); an old one on a merchant still covers every series of it. Instalment plans and loans are asked
 * in Tarkistettavat, never here.
 */
import { cancelledSubjects, countingMark, fixedMonthlyCents, type MarkKind, marksBySubject, NO_INPUTS, seriesMarkSubject, type UserMark } from "@banking/core";
import { useState } from "react";
import { api, query } from "../api.ts";
import { BillsTable, type MarkControls } from "../components/bills/BillsTable.tsx";
import { billItems } from "../components/bills/items.ts";
import { type Ahead, Timeline } from "../components/bills/Timeline.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { useApi } from "../hooks.ts";
import { t } from "../text.ts";
import type { Meta, Recurring as Series, ReportsData, Scope } from "../types.ts";
import "../styles/table.css";
import "../styles/bills.css";
import "../styles/statement.css";

export function Bills({ meta, scope }: { meta: Meta; scope: Scope }) {
  const recurring = useApi<{ series: Series[]; marks: UserMark[] }>(`/api/recurring${query({ scope })}`);
  // the bills typed in are the `upcoming` report's list
  const reports = useApi<ReportsData>(`/api/reports${query({ scope, reports: "upcoming" })}`);
  const ahead = useApi<{ ahead: Ahead | null }>(`/api/ahead${query({ scope })}`);
  // what the last save answered: fresher than the list the page was loaded with
  const [saved, setSaved] = useState<UserMark[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const failed = [recurring, reports, ahead].find((r) => r.error && !r.data);
  if (failed) {
    return (
      <ErrorCard
        message={failed.error ?? ""}
        onRetry={() => {
          recurring.reload();
          reports.reload();
          ahead.reload();
        }}
      />
    );
  }
  if (!recurring.data || !reports.data || !ahead.data) return <BillsLoading />;

  const { series } = recurring.data;
  const label = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;
  const markList = saved ?? recurring.data.marks;
  const marks = marksBySubject(markList);
  const cancelled = cancelledSubjects({ ...NO_INPUTS, marks: markList });
  // a typed-in bill or a mark changes what the 30 days and the table hold
  const refresh = () => {
    reports.reload();
    ahead.reload();
  };
  const save = (subject: string, mark: MarkKind | null) => {
    setBusy(true);
    setMarkError(null);
    api<{ marks: UserMark[] }>("/api/marks", { method: "PUT", body: { subject, mark } })
      .then((res) => {
        setSaved(res.marks);
        // a subscription marked as cancelled leaves the 30 days
        ahead.reload();
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
  const cards = new Set(meta.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  // the fixed costs are a month as the series run today: their rows (each series' latest charge) open up to today
  const nowRange = { from: `${meta.today.slice(0, 7)}-01`, to: meta.today };
  const items = billItems({ series, typed: reports.data.upcoming.manual, cancelled, marks, today: meta.today });

  return (
    <div className={`page-grid ${recurring.loading || reports.loading || ahead.loading ? "loading" : ""}`}>
      <div className="span-12">
        <Timeline ahead={ahead.data.ahead} today={meta.today} onAdded={refresh} />
      </div>
      {markError && <Notice tone="error">{markError}</Notice>}
      {items.length > 0 ? (
        <div className="span-12">
          <BillsTable items={items} fixedCents={fixedMonthlyCents(series, cancelled)} controls={controls} label={label} cards={cards} today={meta.today} range={nowRange} scope={scope} onRemoved={refresh} />
        </div>
      ) : (
        <div className="card span-12 bills-first">
          <h2>{t("bills.first_title")}</h2>
          <p>{t("bills.first_text")}</p>
        </div>
      )}
    </div>
  );
}

/** The page while its answers are on the way: the frame of the two cards at their size. */
function BillsLoading() {
  return (
    <div className="page-grid" role="status" aria-live="polite">
      {["span-12", "span-12"].map((span, k) => (
        <div key={k} className={`card skeleton ${span}`} aria-hidden="true">
          <span className="sk-bar sk-head" />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="sk-row">
              <span className="sk-bar sk-name" />
              <span className="sk-bar sk-num" />
            </span>
          ))}
        </div>
      ))}
      <span className="sr-only">{t("load.loading")}</span>
    </div>
  );
}
