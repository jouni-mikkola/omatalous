/** The answer of the bill calendar as the page of Laskut reads it, with the sums set by the test as core would give them. */
import type { CalBill, CalMonth, Calendar } from "../src/components/bills/calendar-rows.ts";

export const bill = (over: Partial<CalBill> = {}): CalBill => ({ date: "2026-11-05", payee: "Sähköyhtiö", category: "utilities", cents: 6420, state: "known", kind: "bill", seriesId: null, ...over });

export const month = (key: string, rows: CalBill[], over: Partial<CalMonth> = {}): CalMonth => ({
  month: key,
  rows,
  knownCents: 0,
  estimateCents: 0,
  savingCents: 0,
  incomeCents: 0,
  billsCents: 0,
  afterCents: 0,
  monthlyBillsCount: 0,
  monthlyBillsCents: 0,
  ...over,
});

export const calendar = (months: CalMonth[], over: Partial<Calendar> = {}): Calendar => ({
  from: `${months[0]?.month ?? "2026-10"}-11`,
  to: `${months.at(-1)?.month ?? "2026-10"}-28`,
  months,
  billsCents: 0,
  yearlyCents: 0,
  reserveMonthlyCents: 0,
  unknownCount: 0,
  ...over,
});
