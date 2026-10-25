/**
 * How the running month is going: the pace curve, its spending so far against the usual month and the month before on
 * the same days, and the rest of the month as the usual months spent it.
 */
import { billCents } from "../account-use.ts";
import { expectedDates } from "../commitments.ts";
import { addDays, addMonths, addMonthsToDate, dayNumber, daysInMonth, monthEnd, monthOf } from "../dates.ts";
import { fold } from "../merchant.ts";
import { projectDates, type RecurringSeries } from "../recurring.ts";
import { normalizeReference, PAID_EARLY_DAYS } from "../recurring-settled.ts";
import { median } from "../stats.ts";
import { normalizeIban } from "../transfers.ts";
import type { ExpectedBill, IsoDate } from "../types.ts";
import { earnedOf, earnedSelect } from "./counted.ts";
import { type AnalysisContext, type AnalysisTx, inDays, spendRows, standingOf } from "./context.ts";
import { cardsBreakUsual, completeMonthsBefore, itemisedMonthsBefore, MIN_COMPARE_MONTHS, spendingThrough, usualIncome, usualSpendingOver } from "./usual.ts";

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
  /**
   * The household's usual month, day by day: at index d − 1 the usual spending on days 1 to d (`usualSpending`, the
   * median of the complete months before), with the lower and the upper quartile of the same months as its band. null
   * under three complete months.
   */
  usual: {
    curve: number[];
    low: number[];
    high: number[];
    /** How many complete months it is read from. */
    months: number;
    /** `curve` on today's day of the month: "tavallisesti tähän päivään mennessä". 0 before the 1st. */
    toToday: number;
    /** `currentTotal` less `toToday`: above zero the month has cost more than usual so far. */
    diffCents: number;
  } | null;
  /** The months to compare lack the purchases of a linked card (`cardsBreakUsual`): `usual` is null for that reason, not for lack of months. */
  cardGap: boolean;
  /**
   * The rest of a running month as the usual months spent it: on each day from today's to the last, `currentTotal` plus
   * what the lower and the upper quartile months of `usual` added after today's day; `low` and `high` start at today.
   * An estimate. null for a month that has ended or has not begun, and without `usual`.
   */
  projection: { fromDay: number; low: number[]; high: number[] } | null;
  /** The month's largest purchase so far that is in no recurring series (the rent says nothing), the line's one event besides pay. null with none. */
  largest: { day: number; name: string; cents: number } | null;
  /** The days of the month so far that brought earned income of at least a quarter of the usual month's: the pay days the line marks. */
  payDays: number[];
}

/**
 * A month's cumulative spending on each of its days, of the rows the waterfall and the month table count (`spendRows`):
 * a card statement puts a purchase on its own day and lowers the bill, so the curve ends at the waterfall's Menot.
 */
function spendingCurve(ctx: AnalysisContext, month: string): number[] {
  const first = dayNumber(`${month}-01`);
  const daily = new Array<number>(daysInMonth(month)).fill(0);
  for (const t of spendRows(ctx, { fromDay: first, toDay: dayNumber(monthEnd(month)) })) daily[t.day - first]! += t.spend;
  let sum = 0;
  return daily.map((cents) => (sum += cents));
}

/** The history has a row in the month, of any kind: a month it does not reach has nothing to be set against. */
function hasRows(ctx: AnalysisContext, month: string): boolean {
  return inDays(ctx, { fromDay: dayNumber(`${month}-01`), toDay: dayNumber(monthEnd(month)) }).length > 0;
}

/**
 * What the month has cost so far, day by day, and what the month before had cost by the same day: both are sums of
 * the rows the waterfall counts (`spendRows`), nothing is estimated, so the figure and the waterfall's Menot agree.
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
    ...usualPace(ctx, month, lastDay, lastDay ? cur[lastDay - 1]! : 0),
    largest: largestOneOff(ctx, month, lastDay),
    payDays: payDaysOf(ctx, month, lastDay),
  };
}

/** The value at share `q` of sorted values, between the two nearest by linear interpolation, in whole cents. */
function quantile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo));
}

/** The usual month and the projection of the rest of this one (`MonthPace.usual`, `MonthPace.projection`). */
function usualPace(ctx: AnalysisContext, month: string, lastDay: number, total: number): Pick<MonthPace, "usual" | "projection" | "cardGap"> {
  const days = daysInMonth(month);
  const months = itemisedMonthsBefore(ctx, month);
  if (months.length < MIN_COMPARE_MONTHS) return { usual: null, projection: null, cardGap: cardsBreakUsual(ctx, month) };
  const curve: number[] = [];
  const low: number[] = [];
  const high: number[] = [];
  for (let d = 1; d <= days; d++) {
    const values = months.map((m) => spendingThrough(ctx, m, d)).sort((a, b) => a - b);
    curve.push(usualSpendingOver(ctx, months, d)!);
    low.push(quantile(values, 0.25));
    high.push(quantile(values, 0.75));
  }
  const toToday = lastDay ? curve[lastDay - 1]! : 0;
  const usual = { curve, low, high, months: months.length, toToday, diffCents: total - toToday };
  if (!lastDay || lastDay >= days) return { usual, projection: null, cardGap: false };
  const at = lastDay - 1;
  const projection = { fromDay: lastDay, low: [] as number[], high: [] as number[] };
  for (let d = at; d < days; d++) {
    // the lower quartile month can add more after today than the upper one did: the band is the two, lower edge first
    const a = total + low[d]! - low[at]!;
    const b = total + high[d]! - high[at]!;
    projection.low.push(Math.min(a, b));
    projection.high.push(Math.max(a, b));
  }
  return { usual, projection, cardGap: false };
}

/** The month's largest purchase on its days 1 to `lastDay` that belongs to no recurring series. */
function largestOneOff(ctx: AnalysisContext, month: string, lastDay: number): MonthPace["largest"] {
  if (!lastDay) return null;
  const first = dayNumber(`${month}-01`);
  const inSeries = new Set(standingOf(ctx).recurring.flatMap((s) => s.transactionIds));
  const top = spendRows(ctx, { fromDay: first, toDay: first + lastDay - 1 }).reduce<AnalysisTx | null>((best, t) => (!inSeries.has(t.id) && t.spend > (best?.spend ?? 0) ? t : best), null);
  return top ? { day: top.day - first + 1, name: top.merchant, cents: top.spend } : null;
}

/** The days of the month to `lastDay` whose earned income is at least a quarter of the usual month's; none without a usual income. */
function payDaysOf(ctx: AnalysisContext, month: string, lastDay: number): number[] {
  const usual = usualIncome(ctx, month);
  if (!lastDay || !usual) return [];
  const first = dayNumber(`${month}-01`);
  const byDay = new Map<number, number>();
  for (const t of earnedSelect(ctx, { fromDay: first, toDay: first + lastDay - 1 }).counted) byDay.set(t.day - first + 1, (byDay.get(t.day - first + 1) ?? 0) + earnedOf(t));
  return [...byDay].filter(([, cents]) => cents * 4 >= usual).map(([d]) => d).sort((a, b) => a - b);
}

/** The usual day is read from this many whole weeks at most, the latest ones. */
const USUAL_WEEKS = 13;
/** Fewer whole weeks than this say nothing of a usual day. */
const MIN_USUAL_WEEKS = 8;

/**
 * The usual everyday spending of a day for the month, in cents and fractional: the median week by seven. Everyday is
 * what is in no subscription or bill series. The weeks are spans of seven days, the last one ending on the last day of
 * the last complete month before `month`, thirteen at most, and each wholly inside the history. One large purchase
 * moves one week of thirteen and leaves the median where it was. 0 under eight such weeks. With `accounts`, what those
 * accounts paid themselves: the payday window passes the accounts whose balance it counts.
 */
export function everydayPerDay(ctx: AnalysisContext, month: string, accounts?: ReadonlySet<string>): number {
  const [last] = completeMonthsBefore(ctx, month, 1);
  if (!last) return 0;
  const end = dayNumber(monthEnd(last));
  // a complete month has a first row behind it
  const whole = Math.min(USUAL_WEEKS, Math.floor((end - dayNumber(ctx.dataFrom!) + 1) / 7));
  if (whole < MIN_USUAL_WEEKS) return 0;
  const weeks = new Array<number>(whole).fill(0);
  for (const t of inDays(standingOf(ctx), { fromDay: end - 7 * whole + 1, toDay: end })) {
    if (ctx.fixedIds.has(t.id) || (accounts && !accounts.has(t.accountId))) continue;
    weeks[Math.floor((end - t.day) / 7)]! += t.spend;
  }
  return median(weeks) / 7;
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

/** The months from one date of a recurring typed-in bill to the next. */
const STEP_MONTHS = { quarterly: 3, semiannual: 6, yearly: 12 } as const;

/** The shortest name that pays a bill as the first words of a longer one: "Oy" alone names no payee. */
const MIN_NAME_PREFIX = 4;

/** Whether a payee and a bill name the same party: equal when folded, or the shorter is the first whole words of the longer. */
function namesBillParty(payee: string, name: string): boolean {
  if (payee === name) return true;
  const [short, long] = payee.length < name.length ? [payee, name] : [name, payee];
  return short.length >= MIN_NAME_PREFIX && long.startsWith(`${short} `);
}

/** A series' latest charge as the bank booked it, positive: on a joint account in a member's own view the series' own sums are that member's part. */
function lastCharge(ctx: AnalysisContext, s: RecurringSeries): number {
  const ids = new Set(s.transactionIds);
  const day = dayNumber(s.lastDate);
  return inDays(standingOf(ctx), { fromDay: day, toDay: day }).reduce((sum, t) => (ids.has(t.id) ? sum + Math.abs(billCents(t)) : sum), 0);
}

/**
 * The dates of the typed-in bills from `from` to `until` that are still to pay. A typed-in bill is the whole bill, so
 * it is set against the bank's amount of a row (`billCents`). A date is left out for two reasons only:
 *
 * - It was paid: a row of money out, booked in the date's cycle up to today, that is no transfer and belongs to no
 *   series of its own and pays no other date, and that has the bill's name as its payee or, when the bill has them,
 *   its reference or its payee's IBAN.
 *   Size alone pays nothing: a grocery row of 79,50 does not pay an electricity bill of 80. The cycle starts 31 days
 *   before the date, and for a recurring bill no earlier than halfway from the date before, so the payment of one date
 *   never pays the next. The rent does not pay a one-off bill of the landlord's, and a phone bill does not pay the dentist's.
 * - A series carries it: a subscription or bill of the bill's name that is expected (active, not late), whose latest
 *   charge is about the bill's size and that has a charge, booked or coming, within 31 days of the date. Counting
 *   both would count one bill twice.
 */
export function expectedBillRows(ctx: AnalysisContext, bills: readonly ExpectedBill[], from: IsoDate, until: IsoDate): ExpectedBillRow[] {
  const out: ExpectedBillRow[] = [];
  if (!bills.length) return out;
  const inSeries = new Set(ctx.recurring.flatMap((s) => s.transactionIds));
  // a payment pays one date of one bill
  const used = new Set<string>();
  for (const b of bills) {
    const name = fold(b.name);
    const near = (cents: number) => Math.abs(cents - b.amountCents) * 100 <= b.amountCents * PAID_TOLERANCE_PERCENT;
    const carriers = ctx.recurring.filter((s) => (s.kind === "subscription" || s.kind === "bill") && s.active && !s.overdue && fold(s.merchant) === name && near(lastCharge(ctx, s)));
    const reference = normalizeReference(b.reference);
    const iban = normalizeIban(b.payeeIban);
    for (const date of expectedDates(b, from, until)) {
      const early = addDays(date, -PAID_EARLY_DAYS);
      if (carriers.some((s) => [s.lastDate, ...projectDates(s, addDays(date, PAID_EARLY_DAYS))].some((d) => d >= early))) continue;
      const day = dayNumber(date);
      const before = b.cadence === "once" ? null : dayNumber(addMonthsToDate(date, -STEP_MONTHS[b.cadence]));
      // the first day nearer this date than the one before
      const fromDay = Math.max(day - PAID_EARLY_DAYS, before === null ? -Infinity : Math.floor((before + day) / 2) + 1);
      const payment = inDays(standingOf(ctx), { fromDay, toDay: ctx.todayDay }).find(
        (t) =>
          t.amountCents < 0 && !t.isTransfer && !inSeries.has(t.id) && !used.has(t.id) &&
          (namesBillParty(fold(t.merchant), name) || (!!reference && normalizeReference(t.reference) === reference) || (!!iban && normalizeIban(t.counterpartyIban) === iban)),
      );
      if (payment) used.add(payment.id);
      else out.push({ date, name: b.name, category: b.category, amountCents: b.amountCents });
    }
  }
  return out;
}
