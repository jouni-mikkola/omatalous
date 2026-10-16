// Decision: is the household spending more than a year ago
import type { AnalysisContext } from "../analysis/context.ts";
import { accountsCoverage, LEFT_OUT_SHARE } from "../analysis/coverage.ts";
import type { DateRange } from "../analysis/period.ts";
import { MIN_COMPARE_MONTHS } from "../analysis/usual.ts";
import { monthEnd } from "../dates.ts";

export interface YearOverYearReport {
  year: number;
  /** Spending per calendar month (index 0 = January); null for months not reached yet. */
  current: (number | null)[];
  /** null for months before the data starts, so missing data is not drawn as zero. */
  previous: (number | null)[];
  /** First month (1–12) both years have data for from the same accounts; the year-to-date figures start here. */
  comparableFromMonth: number | null;
  /** The months (1–12) both years cover with the same accounts: the year-to-date figures hold these and no others. */
  comparedMonths: number[];
  /** Of those, the months that have ended: the ones the comparison rests on. */
  comparableMonths: number;
  /** The first month (`2024-05`) the scope has data from, the earliest account's start; null without rows. */
  dataFrom: string | null;
  /** The history starts after January of last year: a short history is why months are missing. */
  shortHistory: boolean;
  /** An account was left out of both sides of some compared month (it began or ended in between). */
  leftOutAccounts: boolean;
  /** At least three comparable months, and the accounts left out carry at most a tenth of the spending compared. Below that the change is not told. */
  comparable: boolean;
  /** The running month (1–12) when range.to falls in a month that has not ended: the line stops or dashes there. */
  partialMonth: number | null;
  /** Spending from 1 Jan to the same day of the year. */
  ytdCents: number;
  previousYtdCents: number;
  incomeYtdCents: number;
  previousIncomeYtdCents: number;
}

/**
 * This year against last year, month by month and year to date, on the accounts that have the whole of both months
 * (`accountsCoverage`): an account that began or ended in between is left out of both sides of that month, since it
 * would show as a huge change. Under three months with a shared account, or when the accounts left out carry over a
 * tenth of the spending compared, the report says it is not `comparable`.
 */
export function yearOverYearReport(ctx: AnalysisContext, range: DateRange): YearOverYearReport {
  const year = Number(range.to.slice(0, 4));
  const cutoff = range.to.slice(5); // "MM-DD": compare the same part of both years
  const lastMonth = Number(range.to.slice(5, 7));
  const coverage = accountsCoverage(ctx);
  // the accounts both years have the whole of, month by month; a month with none is not compared
  const sharedIn = new Map<number, ReadonlySet<string>>();
  let leftOutCents = 0;
  let laterCents = 0;
  let leftOutAccounts = false;
  for (let m = 1; m <= lastMonth; m++) {
    const mm = String(m).padStart(2, "0");
    const c = coverage.compare({ from: `${year - 1}-${mm}-01`, to: monthEnd(`${year - 1}-${mm}`) }, { from: `${year}-${mm}-01`, to: monthEnd(`${year}-${mm}`) });
    if (!c) continue;
    sharedIn.set(m, c.shared);
    leftOutCents += c.leftOutCents;
    laterCents += c.laterCents;
    leftOutAccounts ||= c.leftOut;
  }
  const comparedMonths = [...sharedIn.keys()];
  const comparableFromMonth = comparedMonths[0] ?? null;
  const dataFrom = coverage.firstMonth;

  const current: (number | null)[] = Array.from({ length: 12 }, (_, i) => (i < lastMonth ? 0 : null));
  // last year is drawn on the months compared and, as a line to read against, on those still to come
  const previous: (number | null)[] = Array.from({ length: 12 }, (_, i) => (sharedIn.has(i + 1) || (i + 1 > lastMonth && comparableFromMonth !== null) ? 0 : null));
  let ytd = 0;
  let prevYtd = 0;
  let incomeYtd = 0;
  let prevIncomeYtd = 0;
  for (const t of ctx.txs) {
    const y = Number(t.bookingDate.slice(0, 4));
    if (y !== year && y !== year - 1) continue;
    const m = Number(t.bookingDate.slice(5, 7));
    const shared = sharedIn.get(m);
    // a compared month sums the shared accounts on both sides
    if (shared && !shared.has(t.accountId) && m <= lastMonth) continue;
    // with nothing to compare to, this year's total still counts from January
    const inYtd = t.bookingDate.slice(5) <= cutoff && (comparableFromMonth === null ? y === year : shared !== undefined);
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
  const toMonthEnd = monthEnd(range.to.slice(0, 7));
  const partialMonth = range.to < toMonthEnd || toMonthEnd >= ctx.today ? lastMonth : null;
  // whole months of both years: a month that is not over, or that the range cuts, is left out of the count
  let comparableMonths = 0;
  for (const m of comparedMonths) {
    const label = `${year}-${String(m).padStart(2, "0")}`;
    const end = monthEnd(label);
    if (end <= range.to && end < ctx.today) comparableMonths++;
  }
  return {
    year,
    current,
    previous,
    comparableFromMonth,
    comparedMonths,
    comparableMonths,
    dataFrom,
    shortHistory: dataFrom !== null && dataFrom > `${year - 1}-01`,
    leftOutAccounts,
    comparable: comparableMonths >= MIN_COMPARE_MONTHS && leftOutCents <= LEFT_OUT_SHARE * laterCents,
    partialMonth,
    ytdCents: ytd,
    previousYtdCents: prevYtd,
    incomeYtdCents: incomeYtd,
    previousIncomeYtdCents: prevIncomeYtd,
  };
}

/**
 * The line under a year comparison: the months it rests on, and that accounts were left out; or why there is none yet.
 * null when there is nothing to say (no rows at all).
 */
export function yearComparisonNote(r: Pick<YearOverYearReport, "comparable" | "comparableMonths" | "dataFrom" | "shortHistory" | "leftOutAccounts">): string | null {
  if (!r.comparable) {
    if (r.dataFrom === null) return null;
    return r.shortHistory
      ? `Vertailuun ei ole vielä tarpeeksi tietoja: tiedot alkavat ${Number(r.dataFrom.slice(5, 7))}/${r.dataFrom.slice(0, 4)}.`
      : "Vertailuun ei ole tarpeeksi kuukausia, joilta on tiedot samoista tileistä molempina vuosina.";
  }
  const months = r.comparableMonths === 1 ? "Verrattu 1 kuukausi, jolta on tiedot molempina vuosina." : `Verrattu ${r.comparableMonths} kuukautta, joilta on tiedot molempina vuosina.`;
  return r.leftOutAccounts ? `${months} Vertailusta on jätetty pois tilit, joilta ei ole tietoja molemmilta vuosilta.` : months;
}
