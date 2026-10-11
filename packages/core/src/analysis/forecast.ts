/**
 * Where the running month is heading: the pace curve against the usual month and the forecast to the month's end.
 */
import { getCategory } from "../categories.ts";
import { expectedDates } from "../commitments.ts";
import { dayNumber, daysInMonth, fromMonthIndex, monthIndex, monthOf } from "../dates.ts";
import { fold } from "../merchant.ts";
import { projectDates, type RecurringSeries } from "../recurring.ts";
import { median } from "../stats.ts";
import { type ExpectedBill, type IsoDate, NO_INPUTS, type UserInputs } from "../types.ts";
import { type AnalysisContext, inDays, recurringAt } from "./context.ts";
import { completeMonthsBefore, MIN_COMPARE_MONTHS, usualCents } from "./usual.ts";

export interface MonthPace {
  month: string;
  daysInMonth: number;
  /** Cumulative spending by day of month; null after today. */
  current: (number | null)[];
  /**
   * Tavallisesti: for each day, the median cumulative spending of the last six complete months before this one.
   * null under three complete months.
   */
  usual: number[] | null;
  currentTotal: number;
  usualAtToday: number | null;
  usualMonthTotal: number | null;
}

/** A subscription or bill charge the forecast expects on a date. */
export interface ExpectedCharge {
  merchant: string;
  category: string;
  /** Expected charge, positive. */
  amountCents: number;
  date: IsoDate;
}

/** Running month: spending so far, the forecast to month end and bills still to come. */
export interface MonthForecast {
  /** "2026-10" */
  month: string;
  /** consumption + debt so far this month */
  spentCents: number;
  /** spent + bills still due + usual everyday spending for the days left */
  forecastCents: number;
  /** Subscriptions and bills still due before the month ends. */
  billsLeftCents: number;
  /** Usual everyday spending for the days left. */
  usualLeftCents: number;
  /** Tavallisesti: the median spending of the last six complete months, null under three. */
  usualMonthCents: number | null;
  /** The complete months that level is the median of, oldest first, so a page can name them. */
  usualMonths: string[];
  /** The month's likely total from lowCents to highCents: the forecast plus and minus its typical error (see forecastRange). */
  lowCents: number;
  highCents: number;
  /** "own": the error of this forecast on the household's own past months. "table": typical errors of test households, used under three months. */
  rangeBasis: "own" | "table";
  /** The past months an "own" range rests on, 0 for the table. */
  rangeMonths: number;
  /** Half the width of the range, in percent of the forecast, one decimal. */
  rangePercent: number;
}

/** Is this month's spending running ahead of or behind the usual month? */
export function monthPace(ctx: AnalysisContext, month: string, today: IsoDate): MonthPace {
  const days = daysInMonth(month);
  const target = monthIndex(month);
  // a month after the running one has no complete month right before it: count back from the running one
  const before = completeMonthsBefore(ctx, month > monthOf(ctx.today) ? monthOf(ctx.today) : month);
  const needed = new Set([target, ...before.map(monthIndex)]);
  const curves = new Map<number, number[]>();
  for (const t of ctx.txs) {
    if (!needed.has(t.month) || !t.spend) continue;
    const daily = curves.get(t.month) ?? new Array<number>(days).fill(0);
    daily[Math.min(days, Number(t.bookingDate.slice(8, 10))) - 1]! += t.spend;
    curves.set(t.month, daily);
  }
  const cumulative = (m: number) => {
    let acc = 0;
    return (curves.get(m) ?? new Array<number>(days).fill(0)).map((v) => (acc += v));
  };
  const past = before.map((m) => cumulative(monthIndex(m)));
  const usual = past.length < MIN_COMPARE_MONTHS ? null : Array.from({ length: days }, (_, i) => usualCents(past.map((c) => c[i]!))!);
  const cur = cumulative(target);
  const lastDay = monthOf(today) === month ? Number(today.slice(8, 10)) : today < `${month}-01` ? 0 : days;
  return {
    month: fromMonthIndex(target),
    daysInMonth: days,
    current: cur.map((v, i) => (i < lastDay ? v : null)),
    usual,
    currentTotal: lastDay ? cur[lastDay - 1]! : 0,
    usualAtToday: usual ? (lastDay ? usual[lastDay - 1]! : 0) : null,
    usualMonthTotal: usual ? usual[days - 1] ?? 0 : null,
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

/** The merchants the household marked as cancelled (`merchant:<name>`): the series stays active until its last charge is old. */
export function cancelledMerchants(inputs: UserInputs): ReadonlySet<string> {
  const prefix = "merchant:";
  return new Set(inputs.marks.filter((m) => m.mark === "cancelled" && m.subject.startsWith(prefix)).map((m) => m.subject.slice(prefix.length)));
}

/**
 * The charges the forecast expects between `from` and `until`: active subscriptions and bills that are not overdue,
 * each at its typical amount on its projected dates. A date before `from` is a charge a few days late, expected on
 * `from`. A merchant in `cancelled` is left out. Savings plans leave the checking account but are not spending, so
 * they come only with `savings`. Date ascending, the larger first.
 */
export function expectedCharges(
  series: readonly RecurringSeries[],
  from: IsoDate,
  until: IsoDate,
  opts: { cancelled?: ReadonlySet<string>; savings?: boolean } = {},
): ExpectedCharge[] {
  const out: ExpectedCharge[] = [];
  for (const s of series) {
    if (!s.active || s.overdue || (s.kind !== "subscription" && s.kind !== "bill") || opts.cancelled?.has(s.merchant)) continue;
    const kind = getCategory(s.category).kind;
    if (kind !== "expense" && kind !== "debt" && !(opts.savings && kind === "savings")) continue;
    for (const d of projectDates(s, until)) out.push({ merchant: s.merchant, category: s.category, amountCents: s.typicalAmountCents, date: d < from ? from : d });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents);
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

/** The forecast of one month as it stood on `asOf`, by its parts. */
interface ForecastParts {
  spentCents: number;
  billsLeftCents: number;
  usualLeftCents: number;
  forecastCents: number;
}

/**
 * What has gone by `asOf` (that day included), the bills still due as the series looked on that day, the typed-in bills
 * still to pay this month and the usual everyday spending for the days left. The same sum for today and for a past day,
 * so the past can grade it; the past months are graded without typed-in bills, which the household did not have then.
 */
function forecastAsOf(ctx: AnalysisContext, asOf: IsoDate, cancelled?: ReadonlySet<string>, typed: readonly ExpectedBill[] = []): ForecastParts {
  const month = monthOf(asOf);
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const spent = inDays(ctx, { fromDay: dayNumber(`${month}-01`), toDay: dayNumber(asOf) }).reduce((s, t) => s + t.spend, 0);
  const series = expectedCharges(recurringAt(ctx, asOf), asOf, monthEnd, { cancelled }).reduce((s, c) => s + c.amountCents, 0);
  const due = series + expectedBillRows(ctx, typed, asOf, monthEnd).reduce((s, b) => s + b.amountCents, 0);
  const daysLeft = daysInMonth(month) - Number(asOf.slice(8, 10));
  const usualLeft = Math.max(0, Math.round(everydayPerDay(ctx, month) * daysLeft));
  return { spentCents: spent, billsLeftCents: due, usualLeftCents: usualLeft, forecastCents: spent + due + usualLeft };
}

/**
 * How far the forecast was off on test households, by day of month: 8 % on the 5th, 6 % on the 10th, 2,5 % on the
 * 20th, nothing on the last day. Between the days the error is interpolated; before the 5th the 5th's applies.
 */
function tableError(day: number, monthLength: number): number {
  const points: (readonly [number, number])[] = [[5, 0.08], [10, 0.06], [20, 0.025], [monthLength, 0]];
  if (day <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [d0, e0] = points[i - 1]!;
    const [d1, e1] = points[i]!;
    if (day <= d1) return e0 + ((e1 - e0) * (day - d0)) / (d1 - d0);
  }
  return 0;
}

/**
 * The range around the forecast: plus and minus the median absolute relative error that the same forecast made on
 * the household's own last six complete months, taken with the same number of days left. A month needs a complete month
 * before it to have an everyday level. Under three such months the table of typical errors applies instead.
 */
function forecastRange(ctx: AnalysisContext, asOf: IsoDate, forecast: ForecastParts): Pick<MonthForecast, "lowCents" | "highCents" | "rangeBasis" | "rangeMonths" | "rangePercent"> {
  const month = monthOf(asOf);
  const day = Number(asOf.slice(8, 10));
  // past months are met by the days left in the month: the last day of a short month with the last day of a long one
  const left = daysInMonth(month) - day;
  const stats = monthStats(ctx);
  const errors: number[] = [];
  for (const m of completeMonthsBefore(ctx, month)) {
    const actual = stats.get(monthIndex(m))?.spend ?? 0;
    if (actual <= 0 || !completeMonthsBefore(ctx, m, 1).length) continue;
    const predicted = forecastAsOf(ctx, `${m}-${String(Math.max(1, daysInMonth(m) - left)).padStart(2, "0")}`).forecastCents;
    errors.push(Math.abs(predicted - actual) / actual);
  }
  const own = errors.length >= MIN_COMPARE_MONTHS;
  const error = own ? median(errors) : tableError(day, daysInMonth(month));
  return {
    lowCents: Math.max(forecast.spentCents, Math.round(forecast.forecastCents * (1 - error))),
    highCents: Math.round(forecast.forecastCents * (1 + error)),
    rangeBasis: own ? "own" : "table",
    rangeMonths: own ? errors.length : 0,
    rangePercent: Math.round(error * 1000) / 10,
  };
}

/**
 * Where this month is heading: what has gone so far, the subscriptions and bills still due, and the usual
 * everyday spending for the days left, with the range the forecast's own record gives it. A merchant the
 * household marked as cancelled is not expected, and the bills it typed in count when they are still to pay.
 */
export function monthForecast(ctx: AnalysisContext, inputs: UserInputs = NO_INPUTS): MonthForecast {
  const month = monthOf(ctx.today);
  const parts = forecastAsOf(ctx, ctx.today, cancelledMerchants(inputs), inputs.expectedBills);
  const stats = monthStats(ctx);
  const usualMonths = completeMonthsBefore(ctx, month);
  return {
    month,
    ...parts,
    usualMonthCents: usualCents(usualMonths.map((m) => stats.get(monthIndex(m))?.spend ?? 0)),
    usualMonths,
    ...forecastRange(ctx, ctx.today, parts),
  };
}
