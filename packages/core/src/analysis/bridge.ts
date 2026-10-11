// Decision: is income or saving changing, and which month does the split of income describe
/**
 * What the overview's "where the income went" bar is made of. The running month has its bills but often not its
 * salary, so the split is told from complete months; when the selected period has none yet (the default view, the
 * month so far) the latest complete month stands in and the page names it. Before any month has ended, the latest month
 * with income stands in, marked as partial.
 */
import { fromMonthIndex, monthEnd, monthIndex, monthOf, monthRange } from "../dates.ts";
import { median } from "../stats.ts";
import { type AnalysisContext, inDays } from "./context.ts";
import { type PeriodTotals, totalsOf } from "./flows.ts";
import { type DateRange, toDayRange } from "./period.ts";
import { completeMonthsBefore, earnedIncome, isCompleteMonth, MIN_COMPARE_MONTHS, usualIncome } from "./usual.ts";

export interface Bridge {
  totals: PeriodTotals;
  /**
   * "range": the selected period as it is. "settled": the complete months of a running period. "last": a running
   * period without a complete month, so the latest complete month. "partial": no month is complete yet and the
   * running one has no income, so the latest month with income, which is not complete (the first, partly fetched
   * month). "running": the running period as it is, with nothing else to tell.
   */
  basis: "range" | "settled" | "last" | "partial" | "running";
  /** The one month the totals describe (`2026-09`), or null when they cover a longer period. */
  month: string | null;
  /**
   * Tavalliset tulot for that month (`usualIncome`): the median earned income of the complete months before it, null
   * under three of them or without a month.
   */
  usualIncomeCents: number | null;
  /** That month's own earned income, what `usualIncomeCents` is compared with; null without a month. */
  earnedIncomeCents: number | null;
  /** The same for the savings rate (months without income have none and do not count). */
  usualSavingsRate: number | null;
}


function monthTotals(ctx: AnalysisContext, month: string): PeriodTotals {
  return totalsOf(inDays(ctx, toDayRange({ from: `${month}-01`, to: monthEnd(month) })).map((t) => t.flows));
}

function usualOf(ctx: AnalysisContext, month: string): Pick<Bridge, "usualIncomeCents" | "earnedIncomeCents" | "usualSavingsRate"> {
  if (!isCompleteMonth(ctx, month)) return { usualIncomeCents: null, earnedIncomeCents: null, usualSavingsRate: null };
  const before = completeMonthsBefore(ctx, month).map((m) => monthTotals(ctx, m));
  const rates = before.flatMap((t) => (t.savingsRate === null ? [] : [t.savingsRate]));
  return { usualIncomeCents: usualIncome(ctx, month), earnedIncomeCents: earnedIncome(ctx, month), usualSavingsRate: rates.length < MIN_COMPARE_MONTHS ? null : median(rates) };
}

/**
 * `totals` are the period's own and `settled` those of its complete months (null without one, see `settledTotals` in
 * dashboard.ts); `running` says the period reaches today.
 */
export function buildBridge(ctx: AnalysisContext, range: DateRange, running: boolean, totals: PeriodTotals, settled: PeriodTotals | null): Bridge {
  const none = { usualIncomeCents: null, earnedIncomeCents: null, usualSavingsRate: null };
  const months = monthRange(monthOf(range.from), monthOf(range.to));
  const single = months.length === 1 && range.from === `${months[0]}-01` && range.to === monthEnd(months[0]!) ? months[0]! : null;
  if (!running) return { totals, basis: "range", month: single, ...(single ? usualOf(ctx, single) : none) };

  // a range from the 15th holds half of that month, so only months it covers from the 1st count
  const covered = months.filter((m) => `${m}-01` >= range.from && isCompleteMonth(ctx, m));
  if (settled && covered.length) {
    const month = covered.length === 1 ? covered[0]! : null;
    return { totals: settled, basis: "settled", month, ...(month ? usualOf(ctx, month) : none) };
  }
  const last = completeMonthsBefore(ctx, monthOf(ctx.today), 1)[0];
  if (last) return { totals: monthTotals(ctx, last), basis: "last", month: last, ...usualOf(ctx, last) };
  // no month has ended yet: a running month without its salary would read "no income" while the first, partly
  // fetched month had one, so that month stands in, marked as partial
  if (totals.incomeCents <= 0 && ctx.dataFrom) {
    for (let i = monthIndex(ctx.today) - 1; i >= monthIndex(ctx.dataFrom); i--) {
      const month = fromMonthIndex(i);
      const t = monthTotals(ctx, month);
      if (t.incomeCents > 0) return { totals: t, basis: "partial", month, ...none };
    }
  }
  return { totals, basis: "running", month: null, ...none };
}
