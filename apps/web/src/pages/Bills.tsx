/**
 * Decision: what is coming in the next twelve months, and which bill, contract or subscription to drop.
 *
 * Laskut answers with three cards of the kinds of a figure (Nyt: the bills paid this month, Arvio: what is still to come,
 * Tavallinen: what a month of the twelve costs and what to set aside for the bills that come less often), the twelve months in one picture
 * (MonthColumns: the bills that come every month and the rest), the picked month by day (BillDays) and one table in the
 * order of the calendar: a group for each of the twelve months, with the bills, the pays and the regular saving of the month
 * and what is left after the bills (BillsTable). A month picked on the picture opens in the table. A bill the history cannot
 * know yet is added by hand behind "Lisää lasku", a secondary action of the head, and is a row of the table. Every figure
 * comes from core's bill calendar and `upcoming` report (`billCalendar`, `isSubscription`, `isContract`, `isSavingsPlan`);
 * the page adds up nothing. A subscription marked as cancelled is out of every total. A mark is on one series
 * (`seriesMarkSubject`); an old one on a merchant still covers every series of it. Instalment plans and loans are asked
 * in Tarkistettavat, never here.
 */
import { cancelledSubjects, countingMark, type MarkKind, marksBySubject, monthEnd, NO_INPUTS, seriesMarkSubject, type UserMark } from "@banking/core";
import { useState } from "react";
import { api, query } from "../api.ts";
import { MonthColumns } from "../charts/forms/MonthColumns.tsx";
import { BillDays } from "../components/bills/BillDays.tsx";
import { BillForm } from "../components/bills/BillForm.tsx";
import { BillsTable, type MarkControls } from "../components/bills/BillsTable.tsx";
import { startOpenMonth } from "../components/bills/calendar-rows.ts";
import { billItems } from "../components/bills/items.ts";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { KindCard } from "../components/KindCard.tsx";
import { ChartWithTable } from "../components/table/selection.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { answerMoney, dayMonth, monthInside, monthLong, monthStarting } from "../format.ts";
import { useApi } from "../hooks.ts";
import { t, tn } from "../text.ts";
import type { Meta, Recurring as Series, ReportsData, Scope } from "../types.ts";
import "../styles/table.css";
import "../styles/bills.css";
import "../styles/statement.css";

export function Bills({ meta, scope }: { meta: Meta; scope: Scope }) {
  const recurring = useApi<{ series: Series[]; marks: UserMark[] }>(`/api/recurring${query({ scope })}`);
  // the calendar of the twelve months, and the bills typed in, which are the `upcoming` report's list
  const reports = useApi<ReportsData>(`/api/reports${query({ scope, reports: "billCalendar,upcoming,fixedCosts" })}`);
  // what the last save answered: fresher than the list the page was loaded with
  const [saved, setSaved] = useState<UserMark[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const failed = [recurring, reports].find((r) => r.error && !r.data);
  if (failed) {
    return (
      <ErrorCard
        message={failed.error ?? ""}
        onRetry={() => {
          recurring.reload();
          reports.reload();
        }}
      />
    );
  }
  if (!recurring.data || !reports.data) return <BillsLoading />;

  const { series } = recurring.data;
  const { billCalendar: calendar, upcoming, fixedCosts } = reports.data;
  const label = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;
  const markList = saved ?? recurring.data.marks;
  const marks = marksBySubject(markList);
  const cancelled = cancelledSubjects({ ...NO_INPUTS, marks: markList });
  // a typed-in bill or a mark changes what the calendar holds
  const refresh = () => reports.reload();
  // the line that says a bill was added goes with the bill
  const removed = () => {
    setAdded(null);
    refresh();
  };
  const save = (subject: string, mark: MarkKind | null) => {
    setBusy(true);
    setMarkError(null);
    api<{ marks: UserMark[] }>("/api/marks", { method: "PUT", body: { subject, mark } })
      .then((res) => {
        setSaved(res.marks);
        refresh();
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
  const items = billItems({ series, typed: upcoming.manual, cancelled, marks, today: meta.today });
  const listed = items.length > 0 || calendar.months.some((m) => m.rows.length > 0);
  // the open month: what is paid of it (now), what is still to come (estimate); the bills a month the series run at is the usual
  const open = calendar.months[0]!;
  const month = monthInside(open.month);

  return (
    <div className={`page-grid ${recurring.loading || reports.loading ? "loading" : ""}`}>
      <section className="card span-12" id="tulossa" aria-labelledby="coming-h">
        <div className="bills-head">
          <h2 id="coming-h">{t("bills.coming")}</h2>
          <div className="bills-add">
            <Button
              onClick={() => {
                setAdding(true);
                setAdded(null);
              }}
            >
              {t("bills.form.add")}
            </Button>
            {/* the dialog is in the head, so the card under it stays where it was */}
            {adding && (
              <BillForm
                today={meta.today}
                onCancel={() => setAdding(false)}
                onAdded={(name) => {
                  setAdding(false);
                  setAdded(name);
                  refresh();
                }}
              />
            )}
          </div>
        </div>
        {added && (
          <p className="small muted" role="status">
            {t("bills.added", { name: added })}
          </p>
        )}
        <div className="kind-cards">
          <KindCard kind="now" date={dayMonth(meta.today)} label={t("bills.kind_paid", { month })} figure={answerMoney(open.paidCents)} rows={[{ label: t("bills.kind_count"), value: String(open.paidCount) }]} />
          <KindCard
            kind="estimate"
            date={dayMonth(monthEnd(open.month))}
            label={t("bills.kind_coming", { month })}
            figure={answerMoney(open.billsCents)}
            rows={[...(calendar.next ? [{ label: monthStarting(calendar.next.month), value: answerMoney(calendar.next.billsCents) }] : []), { label: t("bills.kind_year"), value: answerMoney(calendar.billsCents) }]}
          />
          <KindCard
            kind="usual"
            label={t("rep.fixed_figure")}
            figure={answerMoney(fixedCosts.monthlyCents)}
            rows={calendar.yearlyCents > 0 ? [{ label: t("bills.fig_reserve"), value: answerMoney(calendar.reserveMonthlyCents) }] : []}
          />
        </div>
        {calendar.unknownCount > 0 && <p className="bills-lead bills-unknown">{tn(calendar.unknownCount, "bills.unknown_one", "bills.unknown_many")}</p>}
      </section>
      {markError && <Notice tone="error">{markError}</Notice>}
      {listed ? (
        <ChartWithTable
          chart={(pick) => {
            // the picked month, else the one the table starts open on
            const shown = calendar.months.find((m) => m.month === (pick.selected ?? startOpenMonth(calendar, items))) ?? calendar.months[0]!;
            return (
              <>
                {calendar.billsCents > 0 && (
                  <section className="card span-12" aria-labelledby="bills-months-h">
                    <h2 id="bills-months-h">{t("bills.chart")}</h2>
                    <MonthColumns
                      months={calendar.months.map((m) => ({ month: m.month, complete: true, paid: [m.paidRegularCents, m.paidLessOftenCents], parts: [m.regularCents, m.lessOftenCents], totalCents: m.wholeBillsCents }))}
                      series={[
                        { key: "regular", label: t("bills.series_regular") },
                        { key: "rare", label: t("bills.series_rare") },
                      ]}
                      tone="spending"
                      usual={fixedCosts.monthlyCents > 0 ? { cents: fixedCosts.monthlyCents, label: `${t("kind.usual")} ${answerMoney(fixedCosts.monthlyCents)}`, short: `${t("kind.usual")} ${answerMoney(fixedCosts.monthlyCents)}` } : null}
                      today={meta.today}
                      keepHeight
                      states={{ paid: t("bills.total_paid"), coming: t("bills.total_coming") }}
                      running={calendar.months[0]!.month}
                      resting={shown.month}
                      label={t("bills.chart_label")}
                    />
                  </section>
                )}
                {shown.billsCents > 0 && (
                  <section className="card span-12" aria-labelledby="bills-days-h">
                    <div className="bills-head">
                      <h2 id="bills-days-h">{monthLong(shown.month).replace(/^./u, (c) => c.toLocaleUpperCase())}</h2>
                      <span className="bills-days-sum">{t("bills.sum_coming", { sum: answerMoney(shown.billsCents) })}</span>
                    </div>
                    <BillDays month={shown} />
                  </section>
                )}
                <div className="span-12">
                  <BillsTable calendar={calendar} items={items} controls={controls} label={label} scope={scope} focus={pick.selected} onRemoved={removed} />
                </div>
              </>
            );
          }}
        />
      ) : (
        <div className="card span-12 bills-first">
          <h2>{t("bills.first_title")}</h2>
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
