/** The answer of the bill calendar as the page of Laskut reads it, with the sums set by the test as core would give them. */
import type { CalBill, CalMonth, Calendar } from "../src/components/bills/calendar-rows.ts";
import { createContext } from "../../../packages/core/src/analysis/context.ts";
import { billCalendar } from "../../../packages/core/src/reports/bill-calendar.ts";
import { type Account, NO_INPUTS } from "../../../packages/core/src/types.ts";
import { tx } from "../../../packages/core/test/helpers.ts";

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

/**
 * What core itself makes of a household whose power bill, due on the 5th each month, did not come on 5.10.: its series
 * (active, six days late) and the calendar, which has no row for it. Prices no two months share, so it is a bill.
 */
export function lateBill(): { today: string; series: ReturnType<typeof createContext>["recurring"]; power: ReturnType<typeof createContext>["recurring"][number]; calendar: Calendar } {
  const today = "2026-10-11";
  const own: Account = { id: "own", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
  const ranks = [9, 11, 10, 8, 7, 3, 1, 0, 2, 4, 5, 6, 12];
  const rows = ranks.map((rank, i) =>
    tx({ accountId: "own", bookingDate: `${i < 4 ? 2025 : 2026}-${String(((8 + i) % 12) + 1).padStart(2, "0")}-05`, amountCents: -Math.round(6000 * 1.12 ** rank), merchant: "Esimerkki Energia", category: "utilities" }),
  );
  const ctx = createContext(rows, [own], today);
  const power = ctx.recurring.find((s) => s.merchant === "Esimerkki Energia")!;
  return { today, series: ctx.recurring, power, calendar: billCalendar(ctx, NO_INPUTS) };
}

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
