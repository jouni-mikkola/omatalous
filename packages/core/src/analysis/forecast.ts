/**
 * How the running month is going: the pace curve, its spending so far against the month before on the same days.
 */
import { billCents } from "../account-use.ts";
import { expectedDates } from "../commitments.ts";
import { addDays, addMonths, dayNumber, daysInMonth, monthEnd, monthIndex, monthOf } from "../dates.ts";
import { fold } from "../merchant.ts";
import { projectDates, type RecurringSeries } from "../recurring.ts";
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

type MonthStats = Map<number, { spend: number; everyday: number }>;
const statsCache = new WeakMap<AnalysisContext, MonthStats>();

/**
 * Spending per month (consumption + debt) and the part of it that is everyday: not in a subscription or bill series.
 * Keyed by month index. With `accounts`, of the rows of those accounts only.
 */
function statsOf(ctx: AnalysisContext, accounts?: ReadonlySet<string>): MonthStats {
  const stats: MonthStats = new Map();
  for (const t of ctx.txs) {
    if (accounts && !accounts.has(t.accountId)) continue;
    const e = stats.get(t.month) ?? { spend: 0, everyday: 0 };
    e.spend += t.spend;
    if (!ctx.fixedIds.has(t.id)) e.everyday += t.spend;
    stats.set(t.month, e);
  }
  return stats;
}

/** `statsOf` over every account: one pass per context. */
function monthStats(ctx: AnalysisContext): MonthStats {
  let stats = statsCache.get(ctx);
  if (!stats) statsCache.set(ctx, (stats = statsOf(ctx)));
  return stats;
}

/**
 * The usual everyday spending per day for the month: the median of the complete months before it, in cents and
 * fractional. 0 without a complete month. The median keeps one sofa out of it. With `accounts`, what those accounts
 * paid themselves: the payday window passes the accounts whose balance it counts.
 */
export function everydayPerDay(ctx: AnalysisContext, month: string, accounts?: ReadonlySet<string>): number {
  const stats = accounts ? statsOf(ctx, accounts) : monthStats(ctx);
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

/** A series' latest charge as the bank booked it, positive: on a joint account in a member's own view the series' own sums are that member's part. */
function lastCharge(ctx: AnalysisContext, s: RecurringSeries): number {
  const ids = new Set(s.transactionIds);
  const day = dayNumber(s.lastDate);
  return inDays(ctx, { fromDay: day, toDay: day }).reduce((sum, t) => (ids.has(t.id) ? sum + Math.abs(billCents(t)) : sum), 0);
}

/**
 * The dates of the typed-in bills from `from` to `until` that are still to pay. A typed-in bill is the whole bill, so
 * it is set against the bank's amount of a row (`billCents`). A date is left out for two reasons only:
 *
 * - It was paid: a row of money out, booked from 31 days before the date up to today, that is no transfer and belongs
 *   to no series of its own, and that has the bill's name as its payee or is about the bill's size (within 5 %). The
 *   rent does not pay a one-off bill of the landlord's, and a phone bill does not pay the dentist's.
 * - A series carries it: a subscription or bill of the bill's name that is expected (active, not late), whose latest
 *   charge is about the bill's size and that has a charge, booked or coming, within 31 days of the date. Counting
 *   both would count one bill twice.
 */
export function expectedBillRows(ctx: AnalysisContext, bills: readonly ExpectedBill[], from: IsoDate, until: IsoDate): ExpectedBillRow[] {
  const out: ExpectedBillRow[] = [];
  if (!bills.length) return out;
  const inSeries = new Set(ctx.recurring.flatMap((s) => s.transactionIds));
  for (const b of bills) {
    const name = fold(b.name);
    const near = (cents: number) => Math.abs(cents - b.amountCents) * 100 <= b.amountCents * PAID_TOLERANCE_PERCENT;
    const carriers = ctx.recurring.filter((s) => (s.kind === "subscription" || s.kind === "bill") && s.active && !s.overdue && fold(s.merchant) === name && near(lastCharge(ctx, s)));
    for (const date of expectedDates(b, from, until)) {
      const early = addDays(date, -PAID_EARLY_DAYS);
      if (carriers.some((s) => [s.lastDate, ...projectDates(s, addDays(date, PAID_EARLY_DAYS))].some((d) => d >= early))) continue;
      const paid = inDays(ctx, { fromDay: dayNumber(early), toDay: ctx.todayDay }).some(
        (t) => t.amountCents < 0 && !t.isTransfer && !inSeries.has(t.id) && (fold(t.merchant) === name || near(-billCents(t))),
      );
      if (!paid) out.push({ date, name: b.name, category: b.category, amountCents: b.amountCents });
    }
  }
  return out;
}
