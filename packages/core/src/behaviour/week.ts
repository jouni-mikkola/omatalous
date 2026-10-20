/**
 * The weeks and months the behaviour counts are told over, and the coverage gate they share. A week is Monday to
 * Sunday by day number (ISO, no summer-time hour). The week told is the week of `ctx.today` from its third day on,
 * else the week before: a Monday's week has nothing to say yet.
 */
import { dayNumber, fromDayNumber, monthOf } from "../dates.ts";
import { median } from "../stats.ts";
import type { IsoDate } from "../types.ts";
import { accountCovers, endedAccounts } from "../analysis/coverage.ts";
import type { AnalysisContext } from "../analysis/context.ts";

/** The covered weeks before the told one a usual level is the median of, and how many it needs. */
const USUAL_WEEKS = 26;
const MIN_USUAL_WEEKS = 8;
/** The days back an account paid the line to be one the gate asks about. */
const PAYER_DAYS = 90;
/** Wednesday, the third day: from it on the running week is told. */
const TOLD_FROM_WEEKDAY = 2;

/** The Monday of the week of a day number. */
export const mondayOf = (day: number): number => day - ((day + 3) % 7);

export interface Span {
  from: IsoDate;
  to: IsoDate;
}

/** The windows a behaviour count is told over, as day numbers and dates. */
export interface Windows {
  /** The Monday of the told week. */
  monday: number;
  week: Span;
  /** The calendar month of `ctx.today` so far, and the month before it. */
  month: Span;
  lastMonth: Span;
  /** The first day the rows are read from: the first Monday of the usual weeks, or the month before when that is older. */
  fromDay: number;
  /** The first day of the payer window. */
  payersFrom: number;
  /** The windows told as day numbers, first and last day, in `WINDOWS` order. */
  days: readonly (readonly [number, number])[];
}

/** The windows a count is told over. */
export const WINDOWS = ["week", "month", "lastMonth"] as const;

export function windowsOf(ctx: AnalysisContext): Windows {
  const today = dayNumber(ctx.today);
  const thisMonday = mondayOf(today);
  const monday = today - thisMonday >= TOLD_FROM_WEEKDAY ? thisMonday : thisMonday - 7;
  const weekEnd = Math.min(monday + 6, today);
  const monthStart = dayNumber(`${monthOf(ctx.today)}-01`);
  const lastStart = dayNumber(`${monthOf(fromDayNumber(monthStart - 1))}-01`);
  return {
    monday,
    week: { from: fromDayNumber(monday), to: fromDayNumber(weekEnd) },
    month: { from: fromDayNumber(monthStart), to: ctx.today },
    lastMonth: { from: fromDayNumber(lastStart), to: fromDayNumber(monthStart - 1) },
    fromDay: Math.min(monday - USUAL_WEEKS * 7, lastStart),
    payersFrom: today - PAYER_DAYS + 1,
    days: [
      [monday, weekEnd],
      [monthStart, today],
      [lastStart, monthStart - 1],
    ],
  };
}

/** Does the data hold the whole of a window, its first and last day? */
export type Covers = (from: IsoDate, to: IsoDate) => boolean;

/**
 * Does the data hold the whole window for a line? Every account that paid the line in the last 90 days must cover it:
 * it began by the window's first day (`accountCovers`), since a card whose rows begin mid-history leaves an early week
 * looking quiet, and it had not ended before the window's last day (`endedAccounts`), since a card that stopped
 * syncing leaves a late week looking quiet. With no payer in the 90 days, every account with a row in them is asked.
 */
export function coverGate(ctx: AnalysisContext, payers: ReadonlySet<string>, active: ReadonlySet<string>): Covers {
  const asked = payers.size ? payers : active;
  const ended = endedAccounts(ctx);
  const memo = new Map<string, boolean>();
  return (from, to) => {
    const key = `${from}|${to}`;
    let ok = memo.get(key);
    if (ok === undefined) {
      ok = accountCovers(ctx, asked, from) && [...asked].every((id) => !ended.has(id) || ended.get(id)! >= dayNumber(to));
      memo.set(key, ok);
    }
    return ok;
  };
}

/**
 * The usual weekly figure: the median over the covered weeks of the `USUAL_WEEKS` before the told one, a week without
 * a row counting 0; null under `MIN_USUAL_WEEKS` covered weeks or when the told week is not covered itself.
 */
export function usualWeekly(byWeek: ReadonlyMap<number, number>, w: Windows, covers: Covers): { usual: number; values: number[] } | null {
  const { monday } = w;
  if (!covers(w.week.from, w.week.to)) return null;
  const values: number[] = [];
  for (let k = 1; k <= USUAL_WEEKS; k++) {
    const m = monday - 7 * k;
    if (covers(fromDayNumber(m), fromDayNumber(m + 6))) values.push(byWeek.get(m) ?? 0);
  }
  return values.length < MIN_USUAL_WEEKS ? null : { usual: median(values), values };
}

/** The value at or under which 80 of 100 of the values fall (the nearest rank). */
export function p80(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.8) - 1)] ?? 0;
}

/** A count and its cents over one window. */
export interface Tally extends Span {
  count: number;
  cents: number;
  /** Every account that paid the line covers the window (`coverGate`); a count of a window not covered is no quiet week. */
  covered: boolean;
}

/** Counts and cents by week and in the windows told, filled one row at a time. */
export class Counter {
  readonly byWeek = new Map<number, number>();
  readonly ids: string[] = [];
  private readonly sums = WINDOWS.map(() => [0, 0]);
  private readonly w: Windows;
  constructor(w: Windows) {
    this.w = w;
  }

  add(day: number, cents: number, id: string): void {
    const { w, sums } = this;
    const monday = mondayOf(day);
    this.byWeek.set(monday, (this.byWeek.get(monday) ?? 0) + 1);
    for (let i = 0; i < WINDOWS.length; i++) {
      const [from, to] = w.days[i]!;
      if (day < from || day > to) continue;
      sums[i]![0]!++;
      sums[i]![1]! += cents;
      if (i === 0) this.ids.push(id);
    }
  }

  tally(key: (typeof WINDOWS)[number], covers: Covers): Tally {
    const [count, cents] = this.sums[WINDOWS.indexOf(key)]!;
    return { ...this.w[key], count: count!, cents: cents!, covered: covers(this.w[key].from, this.w[key].to) };
  }
}
