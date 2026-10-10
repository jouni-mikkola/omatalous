import { type AnalysisContext, historyCovers } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import { daysInMonth, fromMonthIndex, monthIndex } from "../dates.ts";

/** Month indexes covered by a range, capped to the latest `max` months. */
export function rangeMonthIndexes(range: DateRange, max = 24): number[] {
  const end = monthIndex(range.to);
  const start = Math.max(monthIndex(range.from), end - max + 1);
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

export const monthLabels = (indexes: readonly number[]) => indexes.map(fromMonthIndex);

type MonthContext = Pick<AnalysisContext, "dataFrom" | "today">;

/**
 * The months a monthly average should divide by: those the range covers
 * from the 1st to the last day, that have ended and that the history fully
 * reaches. Early in a month, the current month would otherwise pull every
 * average down, and so would months before the first transaction.
 */
export function fullMonths(ctx: MonthContext, range: DateRange, months: readonly number[]): number[] {
  return months.filter((m) => {
    const label = fromMonthIndex(m);
    const start = `${label}-01`;
    const end = `${label}-${String(daysInMonth(label)).padStart(2, "0")}`;
    return start >= range.from && end <= range.to && end < ctx.today && historyCovers(ctx, start);
  });
}

/** fullMonths, or the last month when there is none (so per-row averages stay numbers). */
export function completeMonths(ctx: MonthContext, range: DateRange, months: readonly number[]): number[] {
  const full = fullMonths(ctx, range, months);
  return full.length ? full : months.slice(-1);
}
