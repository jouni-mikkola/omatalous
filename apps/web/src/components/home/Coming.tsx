// Decision: which of the coming months leave too little after the bills, so the month's spending needs a limit now
import { unknownBillsIn } from "@banking/core";
import { query } from "../../api.ts";
import { money, monthLong } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { t, tn } from "../../text.ts";
import type { ReportsData, Scope } from "../../types.ts";
import { nothingToCome } from "../bills/calendar-rows.ts";
import { Notice } from "../ui/Notice.tsx";
import { Table } from "../table/Table.tsx";

type Calendar = ReportsData["billCalendar"];
type Month = Calendar["months"][number];

/** The months the block shows: three, from the first that has something to come. */
const COMING_MONTHS = 3;

const capital = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/** A line under a figure of a cell, in the small muted type of a second line of a row. */
const note = (text: string) => <span className="home-coming-note">{text}</span>;

/**
 * The bills of a month still to come, with the estimated part under them when there is one: *Tulossa*, the figure Laskut' month head and
 * its total give under that name. Bills already paid (the running month) are in no part of it, so the column never reads 0 for them.
 */
const billsCell = (m: Month) => (m.estimateCents > 0 ? <>{money(m.billsCents)} {note(t("home.coming_estimate", { estimate: money(m.estimateCents) }))}</> : money(m.billsCents));

/** The pays of a month, marked as an estimate when one of them is: the calendar's rows say which pays are known. */
const incomeCell = (m: Month) => (m.incomeCents > 0 ? <>{money(m.incomeCents)} {m.rows.some((r) => r.kind === "income" && r.state === "estimate") && note(t("home.coming_income_estimate"))}</> : "–");

/** The saving still to come of a month, as Laskut's Säästöön tells it: the part of the pays that is neither a bill nor left after them. */
const savingCell = (m: Month) => (m.savingCents > 0 ? money(m.savingCents) : "–");

/** What is left of the pays after the bills, as Laskut's month head tells it: below 0 in a month with no pay, and a status in a month a bill with no known sum falls in, never 0. */
const afterText = (m: Month) => (m.afterCents === null ? t("home.coming_after_unknown") : nothingToCome(m) ? "–" : money(m.afterCents));

/**
 * Tulevat kuukaudet: this month and the two after it (the running month is left out once its bills are all paid and nothing else is to come), each with the bills still to come (and the estimated part of them), the pays
 * expected and what is left after the bills. Every figure is a field of the month in `billCalendar`, the answer Laskut's
 * month heads read, so a month has the same sums in both places: `billsCents`, `estimateCents`, `savingCents`, `incomeCents` and
 * `afterCents`, which is null in a month a bill with no known sum falls in (`unknowns`), and in every month while a bill has no day. Nothing is added up here.
 * A month with nothing to come between two that have something keeps its row; with no month that has anything (or none at all) the
 * block says so in one line.
 */
export function ComingMonths({ calendar }: { calendar: Calendar }) {
  // the running month, once its bills are all paid and nothing else is to come, would stand as an empty row: the block starts at the next
  const first = calendar.months.findIndex((m) => !nothingToCome(m));
  if (first < 0) return <p className="home-detail">{t("home.coming_none")}</p>;
  const months = calendar.months.slice(first, first + COMING_MONTHS);
  // only the bills that leave a shown month's sum after the bills unknown, each once; one of a later month is not counted
  const unknownBills = unknownBillsIn(calendar, months.map((m) => m.month));
  // a row reconciles: the pays less the bills and the saving are what is left after them, so a column for the saving stands when a shown month has one
  const hasSaving = months.some((m) => m.savingCents > 0);
  return (
    <>
      <Table<Month>
        caption={t("home.coming_title")}
        rows={months}
        rowKey={(m) => m.month}
        columns={[
          { key: "month", label: t("rpt.month"), kind: "text", rowHead: true, cell: (m) => capital(monthLong(m.month)) },
          { key: "income", label: t("home.coming_income"), kind: "money", cents: (m) => m.incomeCents, cell: incomeCell },
          { key: "bills", label: t("home.coming_bills"), kind: "money", main: true, cents: (m) => m.billsCents, cell: billsCell },
          ...(hasSaving ? [{ key: "saving", label: t("home.coming_saving"), kind: "money" as const, cents: (m: Month) => m.savingCents, cell: savingCell }] : []),
          { key: "after", label: t("home.coming_after"), kind: "money", cents: (m) => m.afterCents, cell: afterText, className: () => "home-coming-after" },
        ]}
        keepColumns
        drillButton={false}
        toolbar={false}
        csv={false}
        search={false}
      />
      {unknownBills > 0 && <p className="home-detail">{tn(unknownBills, "bills.unknown_one", "bills.unknown_many")}</p>}
    </>
  );
}

/** The block: reads the bill calendar of the scope itself, as Laskut does, and keeps its place while it loads. Its answer stays on the device with the page's others (offline.ts). */
export function Coming({ scope }: { scope: Scope }) {
  const answer = useApi<ReportsData>(`/api/reports${query({ scope, reports: "billCalendar" })}`, true);
  const calendar = answer.data?.billCalendar;
  return (
    <section className="card home-coming" aria-labelledby="home-coming-h">
      <h2 id="home-coming-h">{t("home.coming_title")}</h2>
      {answer.error && !calendar ? <Notice tone="error">{answer.error}</Notice> : calendar ? <ComingMonths calendar={calendar} /> : <span className="home-coming-wait" aria-hidden="true" />}
    </section>
  );
}
