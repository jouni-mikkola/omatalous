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
  /** At least three comparable months (`MIN_COMPARE_MONTHS`): months both years cover with the same accounts, and in which the accounts left out carry at most a tenth of the spending. Below that the change is not told. */
  comparable: boolean;
  /** The running month (1–12) when range.to falls in a month that has not ended: the line stops or dashes there. */
  partialMonth: number | null;
  /**
   * Spending per category in the year to date on the compared months, this year and last: the ends of the slope chart.
   * Largest of either year first; empty when not `comparable`.
   */
  categories: { category: string; currentCents: number; previousCents: number; changeCents: number }[];
  /** Spending from 1 Jan to the same day of the year. */
  ytdCents: number;
  /** `ytdCents` less `previousYtdCents`: the answer under the slope chart. */
  ytdChangeCents: number;
  previousYtdCents: number;
  /** `ytdCents` against `previousYtdCents` as a share (0.12 is 12 % more); null when last year had no spending to compare with. */
  ytdChange: number | null;
  incomeYtdCents: number;
  previousIncomeYtdCents: number;
}

/**
 * This year against last year, month by month and year to date, on the accounts that have the whole of both months
 * (`accountsCoverage`): an account that began or ended in between is left out of both sides of that month, since it
 * would show as a huge change. A month where the accounts left out carry over a tenth of its spending is not compared
 * at all, so months a long-standing account holds do not hide the months a younger main account shares. Under three
 * months compared, the report says it is not `comparable`.
 */
export function yearOverYearReport(ctx: AnalysisContext, range: DateRange): YearOverYearReport {
  const year = Number(range.to.slice(0, 4));
  const cutoff = range.to.slice(5); // "MM-DD": compare the same part of both years
  const lastMonth = Number(range.to.slice(5, 7));
  const coverage = accountsCoverage(ctx);
  // the accounts both years have the whole of, month by month; a month with none is not compared
  const sharedIn = new Map<number, ReadonlySet<string>>();
  let leftOutAccounts = false;
  for (let m = 1; m <= lastMonth; m++) {
    const mm = String(m).padStart(2, "0");
    const c = coverage.compare({ from: `${year - 1}-${mm}-01`, to: monthEnd(`${year - 1}-${mm}`) }, { from: `${year}-${mm}-01`, to: monthEnd(`${year}-${mm}`) });
    // a month whose spending sits mostly on accounts the other year lacks says nothing of the change: it is not compared, and the months that are keep their say
    if (!c || c.leftOutCents > LEFT_OUT_SHARE * c.laterCents) continue;
    sharedIn.set(m, c.shared);
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
  const byCategory = new Map<string, [number, number]>();
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
        if (t.spend) (byCategory.get(t.category ?? "") ?? byCategory.set(t.category ?? "", [0, 0]).get(t.category ?? "")!)[0] += t.spend;
      }
    } else {
      if (previous[m - 1] !== null) previous[m - 1]! += t.spend;
      if (inYtd) {
        prevYtd += t.spend;
        prevIncomeYtd += t.flows.income;
        if (t.spend) (byCategory.get(t.category ?? "") ?? byCategory.set(t.category ?? "", [0, 0]).get(t.category ?? "")!)[1] += t.spend;
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
  const comparable = comparableMonths >= MIN_COMPARE_MONTHS;
  const categories = !comparable || comparableFromMonth === null
    ? []
    : [...byCategory]
        .filter(([category]) => category !== "")
        .map(([category, [now, before]]) => ({ category, currentCents: now, previousCents: before, changeCents: now - before }))
        .sort((a, b) => Math.max(b.currentCents, b.previousCents) - Math.max(a.currentCents, a.previousCents) || a.category.localeCompare(b.category));
  return {
    year,
    categories,
    current,
    previous,
    comparableFromMonth,
    comparedMonths,
    comparableMonths,
    dataFrom,
    shortHistory: dataFrom !== null && dataFrom > `${year - 1}-01`,
    leftOutAccounts,
    comparable,
    partialMonth,
    ytdCents: ytd,
    ytdChangeCents: ytd - prevYtd,
    previousYtdCents: prevYtd,
    ytdChange: prevYtd ? (ytd - prevYtd) / prevYtd : null,
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
  return r.leftOutAccounts ? `${months} Mukana eivät ole tilit, joilta puuttuu toisen vuoden tiedot.` : months;
}
