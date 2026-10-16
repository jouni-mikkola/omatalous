// Decision: is income or saving changing, and which month does the split of income describe
/**
 * What the overview's "where the income went" bar is made of. The running month has its bills but often not its
 * salary, so the split is told from complete months; when the selected period has none yet (the default view, the
 * month so far) the latest complete month stands in and the page names it. Before any month has ended, the latest month
 * with income stands in, marked as partial.
 */
import { fromMonthIndex, monthEnd, monthIndex, monthOf, monthRange } from "../dates.ts";
import { type AnalysisContext, spendRows, spendTotals } from "./context.ts";
import { type PeriodTotals, totalsOf } from "./flows.ts";
import { type DateRange, toDayRange } from "./period.ts";
import { completeMonthsBefore, isCompleteMonth } from "./usual.ts";

export interface Bridge {
  totals: PeriodTotals;
  /**
   * "range": the selected period as it is. "settled": the complete months of a running period. "last": a running
   * period without a complete month, so the latest complete month. "partial": no month is complete yet and the
   * running one has no income, so the latest month with income, which is not complete (the first, partly fetched
   * month). "running": the running period as it is, with nothing else to tell.
   */
  basis: "range" | "settled" | "last" | "partial" | "running";
  /**
   * The one month the totals describe (`2026-09`), or null when they cover a longer period or when the history covers
   * the month only in part: a partial month has no savings rate to tell.
   */
  month: string | null;
}

/** The savings rate of a run of months, and which months it is told from (`savingsRateOf`). */
interface SavingsRate {
  /** Saved / income over the complete months of the run; null without a complete month or without income. */
  rate: number | null;
  /** The months the rate is told from: the complete ones of the run, oldest first. */
  months: string[];
  /** "Säästöaste, viimeiset 12 kuukautta": the name of the figure with its window. */
  label: string;
}

/**
 * The one savings rate: pooled over the complete months among `months` (`isCompleteMonth`), from the rows the
 * overview's bridge reads. A month that is running, or that the history covers only in part, is left out, so no view
 * tells the rate of a month with half its income missing.
 */
export function savingsRateOf(ctx: AnalysisContext, months: readonly string[]): SavingsRate {
  const complete = months.filter((m) => isCompleteMonth(ctx, m));
  const totals = totalsOf(complete.flatMap((m) => spendRows(ctx, toDayRange({ from: `${m}-01`, to: monthEnd(m) })).map((t) => t.flows)));
  return { rate: complete.length ? totals.savingsRate : null, months: complete, label: `Säästöaste, ${complete.length === 1 ? "viimeinen kuukausi" : `viimeiset ${complete.length} kuukautta`}` };
}

function monthTotals(ctx: AnalysisContext, month: string): PeriodTotals {
  return spendTotals(ctx, toDayRange({ from: `${month}-01`, to: monthEnd(month) }));
}

/**
 * `totals` are the period's own and `settled` those of its complete months (null without one, see `settledTotals` in
 * dashboard.ts); `running` says the period reaches today.
 */
export function buildBridge(ctx: AnalysisContext, range: DateRange, running: boolean, totals: PeriodTotals, settled: PeriodTotals | null): Bridge {
  const months = monthRange(monthOf(range.from), monthOf(range.to));
  const whole = months.length === 1 && range.from === `${months[0]}-01` && range.to === monthEnd(months[0]!) ? months[0]! : null;
  // a month the history covers in part has no rate (`savingsRateOf`), so it is not named as the month of the totals
  const single = whole && isCompleteMonth(ctx, whole) ? whole : null;
  if (!running) return { totals, basis: "range", month: single };

  // a range from the 15th holds half of that month, so only months it covers from the 1st count
  const covered = months.filter((m) => `${m}-01` >= range.from && isCompleteMonth(ctx, m));
  if (settled && covered.length) {
    const month = covered.length === 1 ? covered[0]! : null;
    return { totals: settled, basis: "settled", month };
  }
  const last = completeMonthsBefore(ctx, monthOf(ctx.today), 1)[0];
  if (last) return { totals: monthTotals(ctx, last), basis: "last", month: last };
  // no month has ended yet: a running month without its salary would read "no income" while the first, partly
  // fetched month had one, so that month stands in, marked as partial
  if (totals.incomeCents <= 0 && ctx.dataFrom) {
    for (let i = monthIndex(ctx.today) - 1; i >= monthIndex(ctx.dataFrom); i--) {
      const month = fromMonthIndex(i);
      const t = monthTotals(ctx, month);
      if (t.incomeCents > 0) return { totals: t, basis: "partial", month };
    }
  }
  return { totals, basis: "running", month: null };
}
