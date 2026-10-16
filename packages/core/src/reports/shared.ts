import type { AnalysisContext } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { fromMonthIndex, monthEnd, monthIndex } from "../dates.ts";

/**
 * Month indexes covered by a range, capped to the latest `max` months. With a context, the months before the history
 * starts are left out (Viime vuosi of a history from September has four months, not eight empty ones before them); the
 * last month stays, so a range wholly before the history still has one.
 */
export function rangeMonthIndexes(range: DateRange, max = 24, ctx?: Pick<AnalysisContext, "dataFrom">): number[] {
  const end = monthIndex(range.to);
  const first = ctx?.dataFrom ? monthIndex(ctx.dataFrom) : -Infinity;
  const start = Math.min(end, Math.max(monthIndex(range.from), end - max + 1, first));
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

export const monthLabels = (indexes: readonly number[]) => indexes.map(fromMonthIndex);

type MonthContext = AnalysisContext;

/**
 * The months a monthly average should divide by: those the range covers
 * from the 1st to the last day and that are complete (`isCompleteMonth`).
 * Early in a month, the current month would otherwise pull every average
 * down, and so would months before the first transaction. With none, there is
 * no average: a running month's spending so far is not a monthly figure.
 */
export function fullMonths(ctx: MonthContext, range: DateRange, months: readonly number[]): number[] {
  return months.filter((m) => {
    const label = fromMonthIndex(m);
    const start = `${label}-01`;
    const end = monthEnd(label);
    return start >= range.from && end <= range.to && isCompleteMonth(ctx, label);
  });
}
