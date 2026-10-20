/**
 * Whether a spending change stands out from the household's own month-to-month noise (ADR 0011, signal.ts). The change
 * report may describe every period, but a sentence calls a period dearer or cheaper, or names a category's cause,
 * only when that change stands out: a month against its usual level as `monthT` reads it, a month or a window against
 * the same a year earlier as `meansApart` does. The noise is read from a category's months with their one-offs
 * struck, so a sofa does not hide a change, and a rare category has a floor (`floorsOf`). A change stands out
 * without its one-offs, or its one-offs do on their own.
 */
import type { Plan } from "./change-plan.ts";
import type { AnalysisTx } from "./context.ts";
import { median } from "../stats.ts";
import { MIN_T, monthlyNoise } from "./signal.ts";

/** A category's (or the total's, under `null`) spending per month of a window, one-offs struck. */
export type MonthSeries = Map<string | null, number[]>;

/** The series of `months` by category and in total, each month's rows from `rowsOf`, the rows in `struck` left out. */
export function monthSeries(months: readonly string[], rowsOf: (m: string) => readonly AnalysisTx[], struck: ReadonlySet<string>): MonthSeries {
  const out: MonthSeries = new Map([[null, months.map(() => 0)]]);
  months.forEach((m, i) => {
    for (const t of rowsOf(m)) {
      if (struck.has(t.id)) continue;
      const list = out.get(t.category) ?? (out.set(t.category, months.map(() => 0)), out.get(t.category)!);
      list[i]! += t.spend;
      out.get(null)![i]! += t.spend;
    }
  });
  return out;
}

export interface SignalInput {
  plan: Plan;
  /** The months the noise of the usual and season views is read from, as series. */
  noise: MonthSeries;
  /** The target's and the base's months as series, for the year view's noise. */
  now: MonthSeries;
  then: MonthSeries;
  /** The least noise of a rare category (`floorsOf`). */
  floors: ReadonlyMap<string, number>;
}

/**
 * The least noise of each rare category among `rows` (purchases over `months` months, bills left out by the caller).
 * A category bought from in under half the months has a moving range of nothing in most months, so its noise is
 * read as the sum of a few purchases would vary by chance: the median purchase times the root of the purchases a
 * month, at least one in the window. A category bought from most months has its moving range.
 */
export function floorsOf(rows: readonly AnalysisTx[], months: number): Map<string, number> {
  const by = new Map<string, { cents: number[]; months: Set<number> }>();
  for (const t of rows) {
    if (t.spend <= 0) continue;
    const e = by.get(t.category) ?? (by.set(t.category, { cents: [], months: new Set() }), by.get(t.category)!);
    e.cents.push(t.spend);
    e.months.add(t.month);
  }
  const out = new Map<string, number>();
  for (const [category, e] of by) if (e.months.size * 2 < months) out.set(category, median(e.cents) * Math.sqrt(Math.max(1, e.cents.length) / Math.max(1, months)));
  return out;
}

/** The standard error of a change of `key` (a category, or the total under null) in the view. */
function errorOf(s: SignalInput, key: string | null): number {
  const k = s.plan.target.length;
  const floor = key === null ? 0 : (s.floors.get(key) ?? 0);
  if (s.plan.view === "year") {
    const sd = Math.max(floor, monthlyNoise(s.now.get(key) ?? [], s.then.get(key) ?? []));
    // the change of a sum over k months against another k months
    return sd * Math.sqrt(2 * k);
  }
  const sd = Math.max(floor, monthlyNoise(s.noise.get(key) ?? []));
  // one month against the median of the usual months (signal.ts `monthT`), or against one month a year ago
  return s.plan.view === "season" ? sd * Math.SQRT2 : sd * Math.sqrt(1 + Math.PI / (2 * Math.max(1, s.plan.base.length)));
}

/** A running month says nothing before this day of the month. */
const MIN_RUNNING_DAYS = 7;

/**
 * A sentence tests every category of the household, about fifteen, where an insight tests one figure: each test is
 * held this many standard errors over `MIN_T` so the sentence as a whole is as rarely wrong as one insight.
 */
export const CHANGE_T = MIN_T + 1;

/** Whether `cents` of change of `key` stands CHANGE_T standard errors from nothing. */
export function standsOut(s: SignalInput, key: string | null, cents: number): boolean {
  // the first days of a month hold a visit or two of each category: too few to tell a change from chance
  if (s.plan.running && s.plan.cap < MIN_RUNNING_DAYS) return false;
  return cents !== 0 && Math.abs(cents) >= CHANGE_T * errorOf(s, key);
}
