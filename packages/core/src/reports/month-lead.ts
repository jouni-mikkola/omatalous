// Decision: where the running month's money went so far, and which payee is new and worth keeping an eye on
import { type AnalysisContext, type AnalysisTx, paidToPerson, spendRows } from "../analysis/context.ts";
import { totalsOf } from "../analysis/flows.ts";
import { toDayRange } from "../analysis/period.ts";
import { addMonths, monthOf } from "../dates.ts";
import { UNKNOWN_MERCHANT } from "../merchant.ts";
import { LEAD_PAYEES } from "../thresholds.ts";
import type { IsoDate } from "../types.ts";

interface PayeeSum {
  merchant: string;
  /** What the month's purchases there came to, positive. */
  outCents: number;
}

interface MonthLead {
  /** `YYYY-MM`: the month of today. */
  month: string;
  /** The day of the month with the most spending, as the totals above the list add it: its sum and how many of the day's rows spent money (income and transfers are not counted, like the sum). Null while the month has no spending. */
  biggestDay: { date: IsoDate; outCents: number; count: number } | null;
  /** The payees the month's purchases went to most, the largest first. Debt service and money to people are not purchases. */
  top: PayeeSum[];
  /** Payees with a purchase this month and none before it on an account that had rows before the month. Empty while the history does not cover the month before. */
  fresh: PayeeSum[];
}

/** What a row bought: its consumption. Debt payments, card bills and money to people are not purchases. */
const purchaseCents = (t: AnalysisTx): number => (paidToPerson(t) || t.merchant === UNKNOWN_MERCHANT ? 0 : Math.max(0, t.flows.consumption));

const largest = (sums: Map<string, number>): PayeeSum[] =>
  [...sums]
    .map(([merchant, outCents]) => ({ merchant, outCents }))
    .sort((a, b) => b.outCents - a.outCents || a.merchant.localeCompare(b.merchant))
    .slice(0, LEAD_PAYEES);

/**
 * The lead of Tapahtumat: the biggest day of the month of today so far, the payees that took most, and the ones seen
 * for the first time. The month's rows are those the totals above the list add up (`spendRows`), so the day's sum is the
 * list's own. Always about the running month, whatever period the list shows.
 */
export function monthLeadReport(ctx: AnalysisContext): MonthLead {
  const month = monthOf(ctx.today);
  const first = `${month}-01`;
  const rows = spendRows(ctx, toDayRange({ from: first, to: ctx.today }));
  const flowsOfDay = new Map<IsoDate, AnalysisTx["flows"][]>();
  for (const t of rows) flowsOfDay.set(t.bookingDate, [...(flowsOfDay.get(t.bookingDate) ?? []), t.flows]);
  let biggest: MonthLead["biggestDay"] = null;
  for (const [date, flows] of [...flowsOfDay].sort(([a], [b]) => a.localeCompare(b))) {
    const outCents = totalsOf(flows).expenseCents;
    if (outCents > (biggest?.outCents ?? 0)) biggest = { date, outCents, count: flows.filter((f) => totalsOf([f]).expenseCents > 0).length };
  }

  const sums = new Map<string, number>();
  for (const t of rows) if (purchaseCents(t) > 0) sums.set(t.merchant, (sums.get(t.merchant) ?? 0) + purchaseCents(t));

  // a payee is new only against a history that covers the month before; an account connected this month brings only old payees
  const covered = ctx.dataFrom !== null && ctx.dataFrom <= `${addMonths(month, -1)}-01`;
  const fresh = new Map<string, number>();
  if (covered) {
    const before = ctx.txs.filter((t) => t.bookingDate < first);
    const known = new Set(before.map((t) => t.merchant));
    const accounts = new Set(before.map((t) => t.accountId));
    for (const t of rows) if (accounts.has(t.accountId) && !known.has(t.merchant) && purchaseCents(t) > 0) fresh.set(t.merchant, (fresh.get(t.merchant) ?? 0) + purchaseCents(t));
  }
  return { month, biggestDay: biggest, top: largest(sums), fresh: largest(fresh) };
}
