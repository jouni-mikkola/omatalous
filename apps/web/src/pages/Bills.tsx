/**
 * Decision: what is coming, and which bill, contract or subscription to drop.
 *
 * Tulossa (docs/design/README.md 1.3) is one list: the household's bills, contracts and subscriptions in the order of
 * their next day, with no timeline, no sum lines, no search and no sorting. A bill the history cannot know yet is added
 * by hand behind "Lisää lasku" and is a row of the same list. Every figure comes from one definition in core
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
import { BillForm } from "../components/bills/BillForm.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Button } from "../components/ui/Button.tsx";
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
  const label = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;
  const markList = saved ?? recurring.data.marks;
  const marks = marksBySubject(markList);
  const cancelled = cancelledSubjects({ ...NO_INPUTS, marks: markList });
  // a typed-in bill changes what the list holds
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
      .then((res) => setSaved(res.marks))
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
    <div className={`page-grid ${recurring.loading || reports.loading ? "loading" : ""}`}>
      <section className="card span-12" id="tulossa" aria-labelledby="coming-h">
        <div className="card-head tb">
          <div className="card-name">
            <h2 id="coming-h">{t("bills.coming")}</h2>
          </div>
          <div className="card-tool">
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
      </section>
      {markError && <Notice tone="error">{markError}</Notice>}
      {items.length > 0 ? (
        <div className="span-12">
          <BillsTable items={items} fixedCents={fixedMonthlyCents(series, cancelled)} controls={controls} label={label} cards={cards} today={meta.today} range={nowRange} scope={scope} onRemoved={removed} />
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
