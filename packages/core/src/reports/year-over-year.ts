import type { AnalysisContext } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import { daysInMonth } from "../dates.ts";

export interface YearOverYearReport {
  year: number;
  /** Spending per calendar month (index 0 = January); null for months not reached yet. */
  current: (number | null)[];
  /** null for months before the data starts, so missing data is not drawn as zero. */
  previous: (number | null)[];
  /** First month (1–12) both years have data for; the year-to-date figures start here. */
  comparableFromMonth: number | null;
  /** The running month (1–12) when range.to falls in a month that has not ended: the line stops or dashes there. */
  partialMonth: number | null;
  /** Spending from 1 Jan to the same day of the year. */
  ytdCents: number;
  previousYtdCents: number;
  incomeYtdCents: number;
  previousIncomeYtdCents: number;
}

/**
 * This year against last year, month by month and year to date. When the
 * history starts during last year, only months both years cover are compared
 * (otherwise a partial previous year would show as a huge increase).
 */
export function yearOverYearReport(ctx: AnalysisContext, range: DateRange): YearOverYearReport {
  const year = Number(range.to.slice(0, 4));
  const cutoff = range.to.slice(5); // "MM-DD": compare the same part of both years
  const lastMonth = Number(range.to.slice(5, 7));
  const first = ctx.txs[0]?.bookingDate ?? range.to;
  const firstYear = Number(first.slice(0, 4));
  // a history starting mid-month makes that month partial: compare from the next one
  const firstFullMonth = Number(first.slice(5, 7)) + (Number(first.slice(8, 10)) > 1 ? 1 : 0);
  // last year's data must reach a month this year has already had, or the comparison is empty
  const comparableFromMonth = firstYear < year - 1 ? 1 : firstYear === year - 1 && firstFullMonth <= lastMonth ? firstFullMonth : null;

  const current: (number | null)[] = Array.from({ length: 12 }, (_, i) => (i < lastMonth ? 0 : null));
  const previous: (number | null)[] = Array.from({ length: 12 }, (_, i) => (comparableFromMonth !== null && i + 1 >= comparableFromMonth ? 0 : null));
  let ytd = 0;
  let prevYtd = 0;
  let incomeYtd = 0;
  let prevIncomeYtd = 0;
  for (const t of ctx.txs) {
    const y = Number(t.bookingDate.slice(0, 4));
    if (y !== year && y !== year - 1) continue;
    const m = Number(t.bookingDate.slice(5, 7));
    // with nothing to compare to, this year's total still counts from January
    const inYtd = t.bookingDate.slice(5) <= cutoff && (comparableFromMonth === null ? y === year : m >= comparableFromMonth);
    if (y === year) {
      if (t.bookingDate > range.to) continue;
      current[m - 1] = (current[m - 1] ?? 0) + t.spend;
      if (inYtd) {
        ytd += t.spend;
        incomeYtd += t.flows.income;
      }
    } else {
      if (previous[m - 1] !== null) previous[m - 1]! += t.spend;
      if (inYtd) {
        prevYtd += t.spend;
        prevIncomeYtd += t.flows.income;
      }
    }
  }
  const monthEnd = `${range.to.slice(0, 7)}-${String(daysInMonth(range.to.slice(0, 7))).padStart(2, "0")}`;
  const partialMonth = range.to < monthEnd || monthEnd >= ctx.today ? lastMonth : null;
  return {
    year,
    current,
    previous,
    comparableFromMonth,
    partialMonth,
    ytdCents: ytd,
    previousYtdCents: prevYtd,
    incomeYtdCents: incomeYtd,
    previousIncomeYtdCents: prevIncomeYtd,
  };
}
