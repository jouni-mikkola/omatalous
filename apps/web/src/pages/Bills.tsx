/**
 * Decision: what is coming in the next twelve months, and which bill, contract or subscription to drop.
 *
 * Laskut answers with one table in the order of the calendar: a group for each of the twelve months, with the bills, the
 * pays and the regular saving of the month and what is left after the bills (BillsTable). Above it one line says what the
 * bills of the year come to and what the ones that come less often than monthly take a month. A bill the history cannot
 * know yet is added by hand behind "Lisää lasku", a secondary action of the head, and is a row of the table. Every figure
 * comes from core's bill calendar and `upcoming` report (`billCalendar`, `isSubscription`, `isContract`, `isSavingsPlan`);
 * the page adds up nothing. A subscription marked as cancelled is out of every total. A mark is on one series
 * (`seriesMarkSubject`); an old one on a merchant still covers every series of it. Instalment plans and loans are asked
 * in Tarkistettavat, never here.
 */
import { cancelledSubjects, countingMark, type MarkKind, marksBySubject, NO_INPUTS, seriesMarkSubject, type UserMark } from "@banking/core";
import { useState } from "react";
import { api, query } from "../api.ts";
import { BillForm } from "../components/bills/BillForm.tsx";
import { BillsTable, type MarkControls } from "../components/bills/BillsTable.tsx";
import { billItems } from "../components/bills/items.ts";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { answerMoney, monthLong, monthStarting } from "../format.ts";
import { useApi } from "../hooks.ts";
import { t, tn } from "../text.ts";
import type { Meta, Recurring as Series, ReportsData, Scope } from "../types.ts";
import "../styles/table.css";
import "../styles/bills.css";
import "../styles/statement.css";

export function Bills({ meta, scope }: { meta: Meta; scope: Scope }) {
  const recurring = useApi<{ series: Series[]; marks: UserMark[] }>(`/api/recurring${query({ scope })}`);
  // the calendar of the twelve months, and the bills typed in, which are the `upcoming` report's list
  const reports = useApi<ReportsData>(`/api/reports${query({ scope, reports: "billCalendar,upcoming" })}`);
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
  const { billCalendar: calendar, upcoming } = reports.data;
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
  // the month the lead already named says its sum once
  const dearest = calendar.dearest && calendar.dearest.month !== calendar.next?.month ? calendar.dearest : null;

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
        <p className="bills-year">
          {t("bills.year", { bills: answerMoney(calendar.billsCents), perMonth: answerMoney(calendar.perMonthCents) })}
          {calendar.next && (
            <>
              {" "}
              {calendar.next.debtCents > 0
                ? t("bills.due_debt", { month: monthStarting(calendar.next.month), bills: answerMoney(calendar.next.billsCents), debt: answerMoney(calendar.next.debtCents) })
                : t("bills.due", { month: monthStarting(calendar.next.month), bills: answerMoney(calendar.next.billsCents) })}
            </>
          )}
          {calendar.unknownCount > 0 && <span className="bills-unknown">{tn(calendar.unknownCount, "bills.unknown_one", "bills.unknown_many")}</span>}
        </p>
        {(dearest || calendar.yearlyCents > 0) && (
          <p className="bills-year bills-facts">
            {dearest && t("bills.dearest", { month: monthLong(dearest.month), bills: answerMoney(dearest.billsCents) })}
            {calendar.yearlyCents > 0 && (
              <>
                {" "}
                {t("bills.rare", { rare: answerMoney(calendar.yearlyCents), reserve: answerMoney(calendar.reserveMonthlyCents) })}
              </>
            )}
          </p>
        )}
      </section>
      {markError && <Notice tone="error">{markError}</Notice>}
      {listed ? (
        <div className="span-12">
          <BillsTable calendar={calendar} items={items} controls={controls} label={label} scope={scope} onRemoved={removed} />
        </div>
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
