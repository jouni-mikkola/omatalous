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

/**
 * The bills of a month, with the estimated part when there is one: the figure Laskut's month head gives. A month with bills
 * already paid (the running one) says the sum is what is unpaid, as its head does, so the column never reads 0 for paid bills.
 */
const billsText = (m: Month) => {
  const sum = m.estimateCents > 0 ? t("home.coming_estimate", { sum: money(m.billsCents), estimate: money(m.estimateCents) }) : money(m.billsCents);
  return m.paidCents > 0 ? t("home.coming_unpaid", { sum }) : sum;
};

/** What is left of the pays after the bills, as Laskut's month head tells it: below 0 in a month with no pay, and a status in a month a bill with no known sum falls in, never 0. */
const afterText = (m: Month) => (m.afterCents === null ? t("home.coming_after_unknown") : nothingToCome(m) ? "–" : money(m.afterCents));

/**
 * Tulevat kuukaudet: this month and the two after it (the running month is left out once its bills are all paid and nothing else is to come), each with the bills (and the estimated part of them), the pays
 * expected and what is left after the bills. Every figure is a field of the month in `billCalendar`, the answer Laskut's
 * month heads read, so a month has the same sums in both places: `billsCents`, `estimateCents`, `incomeCents` and
 * `afterCents`, which is null in a month a bill with no known sum falls in (`unknowns`), and in every month while a bill has no day. Nothing is added up here.
 */
export function ComingMonths({ calendar }: { calendar: Calendar }) {
  // the running month, once its bills are all paid and nothing else is to come, would stand as an empty row: the block starts at the next
  const first = Math.max(0, calendar.months.findIndex((m) => !nothingToCome(m)));
  const months = calendar.months.slice(first, first + COMING_MONTHS);
  if (months.length === 0) return null;
  // only the bills that leave a shown month's sum after the bills unknown, each once; one of a later month is not counted
  const unknownBills = unknownBillsIn(calendar, months.map((m) => m.month));
  return (
    <>
      <Table<Month>
        caption={t("home.coming_title")}
        rows={months}
        rowKey={(m) => m.month}
        columns={[
          { key: "month", label: t("rpt.month"), kind: "text", rowHead: true, cell: (m) => capital(monthLong(m.month)) },
          { key: "bills", label: t("nav.bills"), kind: "money", main: true, cents: (m) => m.billsCents, cell: billsText },
          { key: "income", label: t("home.coming_income"), kind: "money", cents: (m) => m.incomeCents, cell: (m) => (m.incomeCents > 0 ? money(m.incomeCents) : "–") },
          { key: "after", label: t("home.coming_after"), kind: "money", cents: (m) => m.afterCents, cell: afterText },
        ]}
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
