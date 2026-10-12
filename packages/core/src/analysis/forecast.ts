/**
 * How the running month is going: the pace curve, its spending so far against the month before on the same days.
 */
import { expectedDates } from "../commitments.ts";
import { addMonths, dayNumber, daysInMonth, monthEnd, monthIndex, monthOf } from "../dates.ts";
import { fold } from "../merchant.ts";
import { median } from "../stats.ts";
import type { ExpectedBill, IsoDate } from "../types.ts";
import { type AnalysisContext, inDays } from "./context.ts";
import { completeMonthsBefore, spendingThrough } from "./usual.ts";

export interface MonthPace {
  month: string;
  daysInMonth: number;
  /** Cumulative spending (consumption + debt) by day of month; null after today. */
  current: (number | null)[];
  /** The month's spending so far: the last point of `current`, 0 before the 1st. */
  currentTotal: number;
  /** The calendar month before, of real rows. null when the history has no row in it. */
  previous: {
    /** "2026-09" */
    month: string;
    /** Cumulative spending by day of that month, all its days, summed as `current` is. */
    curve: number[];
    /** The day of that month that `toToday` runs to: today's day of the month, or its last day when it is shorter. 0 before the 1st. */
    day: number;
    /** Its cumulative spending on its days 1 to `day`. */
    toToday: number;
  } | null;
}

/** A month's cumulative spending on each of its days; the last day takes in the 31st of a longer month, so the curve ends at the whole month. */
function spendingCurve(ctx: AnalysisContext, month: string): number[] {
  const days = daysInMonth(month);
  return Array.from({ length: days }, (_, i) => spendingThrough(ctx, month, i === days - 1 ? 31 : i + 1));
}

/** The history has a row in the month, of any kind: a month it does not reach has nothing to be set against. */
function hasRows(ctx: AnalysisContext, month: string): boolean {
  return inDays(ctx, { fromDay: dayNumber(`${month}-01`), toDay: dayNumber(monthEnd(month)) }).length > 0;
}

/**
 * What the month has cost so far, day by day, and what the month before had cost by the same day: both are sums of
 * the rows (`spendingThrough`), nothing is estimated.
 */
export function monthPace(ctx: AnalysisContext, month: string, today: IsoDate): MonthPace {
  const days = daysInMonth(month);
  const cur = spendingCurve(ctx, month);
  const lastDay = monthOf(today) === month ? Number(today.slice(8, 10)) : today < `${month}-01` ? 0 : days;
  const before = addMonths(month, -1);
  const curve = hasRows(ctx, before) ? spendingCurve(ctx, before) : null;
  // a month shorter than today's day of the month is read to its last day
  const day = Math.min(lastDay, curve?.length ?? 0);
  return {
    month,
    daysInMonth: days,
    current: cur.map((v, i) => (i < lastDay ? v : null)),
    currentTotal: lastDay ? cur[lastDay - 1]! : 0,
    previous: curve && { month: before, curve, day, toToday: day ? curve[day - 1]! : 0 },
  };
}

const statsCache = new WeakMap<AnalysisContext, Map<number, { spend: number; everyday: number }>>();

/**
 * Spending per month (consumption + debt) and the part of it that is everyday: not in a subscription or bill series.
 * One pass per context, keyed by month index.
 */
function monthStats(ctx: AnalysisContext): ReadonlyMap<number, { spend: number; everyday: number }> {
  let stats = statsCache.get(ctx);
  if (!stats) {
    stats = new Map();
    for (const t of ctx.txs) {
      const e = stats.get(t.month) ?? { spend: 0, everyday: 0 };
      e.spend += t.spend;
      if (!ctx.fixedIds.has(t.id)) e.everyday += t.spend;
      stats.set(t.month, e);
    }
    statsCache.set(ctx, stats);
  }
  return stats;
}

/**
 * The usual everyday spending per day for the month: the median of the complete months before it, in cents and
 * fractional. 0 without a complete month. The median keeps one sofa out of it.
 */
export function everydayPerDay(ctx: AnalysisContext, month: string): number {
  const stats = monthStats(ctx);
  return median(completeMonthsBefore(ctx, month).map((m) => (stats.get(monthIndex(m))?.everyday ?? 0) / daysInMonth(m)));
}

/** A date of a bill the household typed in. */
export interface ExpectedBillRow {
  date: IsoDate;
  name: string;
  category: string | null;
  /** Positive. */
  amountCents: number;
}

/** How far a booked amount may sit from a typed-in one and still be that bill, in percent. */
const PAID_TOLERANCE_PERCENT = 5;
/** A payment up to this many days before the due date counts as paying it (an early or a late due date). */
const PAID_EARLY_DAYS = 31;

/**
 * The dates of the typed-in bills from `from` to `until` that are still to pay. Left out: a bill the history already
 * shows as a series (the series carries it), and a date for which a row of about the same amount (within 5 %) was
 * booked from 31 days before it up to today, which is that bill paid.
 */
export function expectedBillRows(ctx: AnalysisContext, bills: readonly ExpectedBill[], from: IsoDate, until: IsoDate): ExpectedBillRow[] {
  const known = new Set(ctx.recurring.map((s) => fold(s.merchant)));
  const out: ExpectedBillRow[] = [];
  for (const b of bills) {
    if (known.has(fold(b.name))) continue;
    for (const date of expectedDates(b, from, until)) {
      const paid = inDays(ctx, { fromDay: dayNumber(date) - PAID_EARLY_DAYS, toDay: ctx.todayDay }).some(
        (t) => t.amountCents < 0 && !t.isTransfer && Math.abs(-t.amountCents - b.amountCents) * 100 <= b.amountCents * PAID_TOLERANCE_PERCENT,
      );
      if (!paid) out.push({ date, name: b.name, category: b.category, amountCents: b.amountCents });
    }
  }
  return out;
}
