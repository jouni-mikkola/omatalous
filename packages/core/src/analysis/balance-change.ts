// Decision: how far the money on the accounts moved over a range, counted from one day to another, so every row of the range is in it
import type { AnalysisContext } from "./context.ts";
import type { DateRange } from "./period.ts";
import { dayNumber, fromDayNumber } from "../dates.ts";
import { DAILY_POINTS } from "../thresholds.ts";
import type { IsoDate } from "../types.ts";
import type { BalanceWalk } from "./balance-walk.ts";

/**
 * The change of the accounts' total over a range, from the end of the day `from` to the end of the day `to`: the rows
 * of the days after `from` up to `to` are what moved it, so a bridge of those rows (`cashflowReport`) adds up to `cents`.
 */
export interface BalanceChange {
  /** The day whose closing balance the change is counted from. The rows of the days after it are in the change. */
  from: IsoDate;
  /** The newest known day of the range, at most today: the change is counted to its close. */
  to: IsoDate;
  cents: number;
  /**
   * `dayBefore`: `from` is the day before the range starts, so every row of the range is in the change.
   * `firstDay`: the balance before the start is not known (an account has no row before it, or a row in another currency
   * hides it), so `from` is the first day it is known on, and that day's own rows are not in the change.
   */
  basis: "dayBefore" | "firstDay";
}

/**
 * The days Saldot reads a range over: the range's end or today, and its start, cut to the newest `DAILY_POINTS` days (the
 * chart's budget is 2 000 points a series, ENGINE 3). The change and the bridge of the cash flow both count over these.
 */
export function balanceDays(ctx: AnalysisContext, range: DateRange): { fromDay: number; toDay: number } {
  const toDay = Math.min(dayNumber(range.to), ctx.todayDay);
  return { fromDay: Math.max(dayNumber(range.from), toDay - (DAILY_POINTS - 1)), toDay };
}

/** The accounts' total at the end of `day`; null when an account is not known that day or is blanked by a row in another currency. */
export function totalOn(walks: readonly BalanceWalk[], day: number): number | null {
  let sum = 0;
  for (const w of walks) {
    const v = w.blanked(day) ? null : w.at(day);
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

/**
 * The change of the accounts added up (`BalanceChange`) over the days `fromDay` to `toDay`, with each account's part in
 * `byAccount` (account id to cents, adding up to the total's). It starts at the close of the day before `fromDay`, and
 * when that is not known, at the first day of the range that is known. Null when the end is not known, or no known day
 * comes before it to start from.
 */
export function balanceChange(walks: readonly BalanceWalk[], fromDay: number, toDay: number): (BalanceChange & { byAccount: ReadonlyMap<string, number> }) | null {
  if (!walks.length || fromDay > toDay || totalOn(walks, toDay) === null) return null;
  let start = fromDay - 1;
  while (start < toDay && totalOn(walks, start) === null) start++;
  const baseline = totalOn(walks, start);
  if (baseline === null || start >= toDay) return null;
  return {
    from: fromDayNumber(start),
    to: fromDayNumber(toDay),
    cents: totalOn(walks, toDay)! - baseline,
    basis: start === fromDay - 1 ? "dayBefore" : "firstDay",
    byAccount: new Map(walks.map((w) => [w.accountId, w.at(toDay)! - w.at(start)!])),
  };
}
