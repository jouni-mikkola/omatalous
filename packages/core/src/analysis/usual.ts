/**
 * "Tavallisesti" and "valmis kuukausi": the one yardstick every view uses to say what is usual and which months may
 * be compared. A running month, or one the history does not cover from the 1st, is never part of it, and fewer than
 * three months say nothing. See docs/MONEY_FLOWS.md.
 */
import { daysInMonth, fromMonthIndex, monthIndex } from "../dates.ts";
import { median } from "../stats.ts";
import { type AnalysisContext, historyCovers } from "./context.ts";

/** The usual level is the median of this many complete months at most. */
export const USUAL_MONTHS = 6;
/** Fewer complete months than this give no usual level and no comparison. */
export const MIN_COMPARE_MONTHS = 3;

type MonthContext = Pick<AnalysisContext, "dataFrom" | "today">;

/** The month (`2026-09`) has ended and the history covers it from the 1st. */
export function isCompleteMonth(ctx: MonthContext, month: string): boolean {
  const end = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  return end < ctx.today && historyCovers(ctx, `${month}-01`);
}

/**
 * The complete months right before `month`, at most `n`, oldest first. It stops at the first month that is not
 * complete, so a history that starts later gives fewer (none when `month` itself is in the future).
 */
export function completeMonthsBefore(ctx: MonthContext, month: string, n: number = USUAL_MONTHS): string[] {
  const out: string[] = [];
  for (let i = monthIndex(month) - 1; out.length < n; i--) {
    const label = fromMonthIndex(i);
    if (!isCompleteMonth(ctx, label)) break;
    out.push(label);
  }
  return out.reverse();
}

/**
 * The first day with `MIN_COMPARE_MONTHS` complete months behind it: the 1st of the month after the third month the
 * history covers from its first day. Null without history.
 */
export function usualFrom(ctx: MonthContext): string | null {
  if (!ctx.dataFrom) return null;
  const start = monthIndex(ctx.dataFrom.slice(0, 7));
  const first = historyCovers(ctx, `${fromMonthIndex(start)}-01`) ? start : start + 1;
  return `${fromMonthIndex(first + MIN_COMPARE_MONTHS)}-01`;
}

/**
 * The usual level of a month figure: the median of the values of `completeMonthsBefore(ctx, month, USUAL_MONTHS)`,
 * in whole cents, or null under three values.
 */
export function usualCents(values: readonly number[]): number | null {
  return values.length < MIN_COMPARE_MONTHS ? null : Math.round(median(values));
}
