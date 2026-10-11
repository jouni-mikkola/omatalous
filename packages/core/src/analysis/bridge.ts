// Decision: is income or saving changing, and which month does the split of income describe
/**
 * What the overview's "where the income went" bar is made of. The running month has its bills but often not its
 * salary, so the split is told from complete months; when the selected period has none yet (the default view, the
 * month so far) the latest complete month stands in and the page names it.
 */
import { daysInMonth, monthOf, monthRange } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import { median } from "../stats.ts";
import { type AnalysisContext, inDays } from "./context.ts";
import { type PeriodTotals, totalsOf } from "./flows.ts";
import { type DateRange, toDayRange } from "./period.ts";
import { completeMonthsBefore, isCompleteMonth, MIN_COMPARE_MONTHS, usualCents } from "./usual.ts";

export interface Bridge {
  totals: PeriodTotals;
  /**
   * "range": the selected period as it is. "settled": the complete months of a running period. "last": a running
   * period without a complete month, so the latest complete month. "running": nothing complete exists yet.
   */
  basis: "range" | "settled" | "last" | "running";
  /** The one month the totals describe (`2026-09`), or null when they cover a longer period. */
  month: string | null;
  /** Tavallisesti for that month: the median income of the complete months before it, null under three of them or without a month. */
  usualIncomeCents: number | null;
  /** The same for the savings rate (months without income have none and do not count). */
  usualSavingsRate: number | null;
}

const lastDay = (month: string): IsoDate => `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

function monthTotals(ctx: AnalysisContext, month: string): PeriodTotals {
  return totalsOf(inDays(ctx, toDayRange({ from: `${month}-01`, to: lastDay(month) })).map((t) => t.flows));
}

function usualOf(ctx: AnalysisContext, month: string): Pick<Bridge, "usualIncomeCents" | "usualSavingsRate"> {
  if (!isCompleteMonth(ctx, month)) return { usualIncomeCents: null, usualSavingsRate: null };
  const before = completeMonthsBefore(ctx, month).map((m) => monthTotals(ctx, m));
  const rates = before.flatMap((t) => (t.savingsRate === null ? [] : [t.savingsRate]));
  return { usualIncomeCents: usualCents(before.map((t) => t.incomeCents)), usualSavingsRate: rates.length < MIN_COMPARE_MONTHS ? null : median(rates) };
}

/**
 * `totals` are the period's own and `settled` those of its complete months (null without one, see `settledTotals` in
 * dashboard.ts); `running` says the period reaches today.
 */
export function buildBridge(ctx: AnalysisContext, range: DateRange, running: boolean, totals: PeriodTotals, settled: PeriodTotals | null): Bridge {
  const none = { usualIncomeCents: null, usualSavingsRate: null };
  const months = monthRange(monthOf(range.from), monthOf(range.to));
  const single = months.length === 1 && range.from === `${months[0]}-01` && range.to === lastDay(months[0]!) ? months[0]! : null;
  if (!running) return { totals, basis: "range", month: single, ...(single ? usualOf(ctx, single) : none) };

  // a range from the 15th holds half of that month, so only months it covers from the 1st count
  const covered = months.filter((m) => `${m}-01` >= range.from && isCompleteMonth(ctx, m));
  if (settled && covered.length) {
    const month = covered.length === 1 ? covered[0]! : null;
    return { totals: settled, basis: "settled", month, ...(month ? usualOf(ctx, month) : none) };
  }
  const last = completeMonthsBefore(ctx, monthOf(ctx.today), 1)[0];
  if (last) return { totals: monthTotals(ctx, last), basis: "last", month: last, ...usualOf(ctx, last) };
  return { totals, basis: "running", month: null, ...none };
}
