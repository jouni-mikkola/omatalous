// Decision: which days and weekdays the money goes on, and whether a big day was a one-off
import type { AnalysisContext } from "../analysis/context.ts";
import { spendOf, spendSelect, sumOf } from "../analysis/counted.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { addDays, dayNumber, fromDayNumber, weekdayOf } from "../dates.ts";
import { heatLevels } from "../analysis/heat.ts";
import { MIN_T } from "../analysis/signal.ts";
import { paydayEffect } from "../behaviour/payday.ts";
import { mean } from "../stats.ts";

/** Covered weeks a weekday is judged on at least: fewer give each weekday a handful of days. */
const LEAD_MIN_WEEKS = 8;
/** The weekday's mean must be this many times the mean of the other days, beside standing out of the noise. */
const LEAD_SHARE = 1.5;

/** Weeks the calendar holds at most: half a year reads at a glance and fits a phone in two rows of months. */
const DAYS_WEEKS = 26;

interface DaySpend {
  date: string;
  /** Spending of the day as the month's spending counts it (`spendOf`), less the rows of a recurring bill or subscription; a refund day can be below zero. */
  cents: number;
  count: number;
  /** The shade of the day against the usual spending day, 0 (plain) to 4 (`dayHeat`). */
  heat: number;
}

interface DaysReport {
  /** Monday of the first week shown; null with no history in the range. */
  from: string | null;
  to: string | null;
  /** Every day from `from` to `to`, a day with no row at 0. */
  days: DaySpend[];
  totalCents: number;
  /** Spending of the same days in recurring bills and subscriptions (rent, electricity, loan payments), left out: their day is set by the payee, not by the household. */
  recurringCents: number;
  /** Spending of each week from `from`, Monday to Sunday, the days outside the range at 0: the strip under the calendar. */
  weeks: { from: string; cents: number }[];
  /** The three days with the most spending, largest first, each with the payee of its largest row. */
  top: (DaySpend & { merchant: string; merchantCents: number })[];
  /** Mean spending per weekday (0 = Monday) over the days shown, in whole cents; null for a weekday with no day shown. */
  weekdayAvgCents: (number | null)[];
  /** The usual spending day the shades are against (`dayHeat`); null with no ended day of spending. */
  usualDayCents: number | null;
  /** The weekday that stands out of the household's weeks (`weekdayLead`); null when none does. */
  weekdayLead: WeekdayLead | null;
  /** The days after pay against the week before, as the payday insight tells it (`paydayEffect`); null when it is not told or the range ended before today. */
  payday: { ratio: number; extraCents: number } | null;
}

interface WeekdayLead {
  /** 0 = Monday. */
  weekday: number;
  /** Mean spending of that weekday over the weeks judged. */
  cents: number;
  /** Mean spending of the other six days of the same weeks. */
  restCents: number;
  weeks: number;
}

/**
 * The weekday that takes more than the rest of the week, decided here so the page never names a day chance made. One
 * of seven means is always the highest, so the top weekday is picked after looking: each whole ended week gives that
 * day minus the mean of its other six, and the mean of those differences must stand MIN_T standard errors above zero
 * (not 2) and the day's mean 1,5 times the rest's. Null under eight whole weeks.
 */
function weekdayLead(days: readonly { date: string; cents: number }[], today: string): WeekdayLead | null {
  const weeks: number[][] = [];
  for (let i = days.findIndex((d) => weekdayOf(d.date) === 0); i >= 0 && i + 7 <= days.length; i += 7) {
    const week = days.slice(i, i + 7);
    if (week[6]!.date >= today) break;
    weeks.push(week.map((d) => d.cents));
  }
  if (weeks.length < LEAD_MIN_WEEKS) return null;
  const means = [0, 1, 2, 3, 4, 5, 6].map((w) => mean(weeks.map((wk) => wk[w]!)));
  const top = means.indexOf(Math.max(...means));
  const rest = (wk: readonly number[]) => (wk.reduce((s, v) => s + v, 0) - wk[top]!) / 6;
  const diffs = weeks.map((wk) => wk[top]! - rest(wk));
  const d = mean(diffs);
  const sd = Math.sqrt(diffs.reduce((s, v) => s + (v - d) ** 2, 0) / (diffs.length - 1));
  const restCents = mean(weeks.map(rest));
  const clear = sd > 0 ? d / (sd / Math.sqrt(diffs.length)) >= MIN_T : d > 0;
  if (!clear || means[top]! < LEAD_SHARE * restCents || means[top]! <= 0) return null;
  return { weekday: top, cents: Math.round(means[top]!), restCents: Math.round(restCents), weeks: weeks.length };
}

/**
 * The usual spending day of a run of days and each day's shade against it, by `heatLevels` (the shade of the month
 * heat map): the mean of the ended days that had spending, since a day with nothing is not a cheap day but a day off.
 * Today is not ended, so it is plain and stays out of the mean. Any day series can be shaded with it: the calendar of
 * Raportit, the rows a filter of Tapahtumat leaves.
 */
export function dayHeat(days: readonly { date: string; cents: number }[], today: string): { usualCents: number | null; heat: number[] } {
  const complete = days.map((d) => d.date < today);
  const spent = days.filter((d, i) => complete[i] && d.cents > 0);
  const usualCents = spent.length ? Math.round(sumOf(spent, (d) => d.cents) / spent.length) : null;
  return { usualCents, heat: heatLevels(days.map((d) => d.cents), complete, usualCents) };
}

/** Spending day by day over the last weeks of the range, for the calendar of Raportit. */
export function daysReport(ctx: AnalysisContext, range: DateRange): DaysReport {
  const to = range.to < ctx.today ? range.to : ctx.today;
  const earliest = [range.from, ctx.dataFrom ?? to].sort().at(-1)!;
  // the grid starts on a Monday so each column is a week; days before the range stay out of `days`
  const back = addDays(to, -(DAYS_WEEKS * 7 - 1));
  const start = back > earliest ? back : earliest;
  if (start > to) return { from: null, to: null, days: [], totalCents: 0, recurringCents: 0, weeks: [], top: [], weekdayAvgCents: Array(7).fill(null), usualDayCents: null, weekdayLead: null, payday: null };
  // a habit (the weekly shop) is the household's own day and stays; a bill or a subscription is the payee's
  const inSeries = new Set(ctx.recurring.filter((s) => s.kind === "bill" || s.kind === "subscription").flatMap((s) => s.transactionIds));
  const all = spendSelect(ctx, toDayRange({ from: start, to })).counted;
  const counted = all.filter((t) => !inSeries.has(t.id));
  const byDay = new Map<number, typeof counted>();
  for (const t of counted) byDay.set(t.day, [...(byDay.get(t.day) ?? []), t]);
  const sums: Omit<DaySpend, "heat">[] = [];
  for (let n = dayNumber(start); n <= dayNumber(to); n++) {
    const rows = byDay.get(n) ?? [];
    sums.push({ date: fromDayNumber(n), cents: sumOf(rows, spendOf), count: rows.length });
  }
  const shade = dayHeat(sums, ctx.today);
  const days: DaySpend[] = sums.map((d, i) => ({ ...d, heat: shade.heat[i]! }));
  const top = [...days]
    .filter((d) => d.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.date.localeCompare(b.date))
    .slice(0, 3)
    .map((d) => {
      const largest = [...(byDay.get(dayNumber(d.date)) ?? [])].sort((a, b) => spendOf(b) - spendOf(a))[0]!;
      return { ...d, merchant: largest.merchant, merchantCents: spendOf(largest) };
    });
  const weekdayAvgCents = [0, 1, 2, 3, 4, 5, 6].map((w) => {
    const of = days.filter((d) => weekdayOf(d.date) === w);
    return of.length ? Math.round(sumOf(of, (d) => d.cents) / of.length) : null;
  });
  const monday = addDays(start, -weekdayOf(start));
  const weeks: DaysReport["weeks"] = [];
  for (let w = monday; w <= to; w = addDays(w, 7)) {
    const end = addDays(w, 6);
    weeks.push({ from: w, cents: sumOf(days.filter((d) => d.date >= w && d.date <= end), (d) => d.cents) });
  }
  // D6 judges on today, as the payday insight does: a period that ended before it gets no payday line
  const effect = to === ctx.today ? paydayEffect(ctx) : null;
  const payday = effect?.told && effect.ratio && effect.extraCents ? { ratio: effect.ratio.value, extraCents: effect.extraCents.value } : null;
  return {
    from: monday,
    to,
    weeks,
    days,
    totalCents: sumOf(days, (d) => d.cents),
    recurringCents: sumOf(all, spendOf) - sumOf(counted, spendOf),
    top,
    weekdayAvgCents,
    usualDayCents: shade.usualCents,
    weekdayLead: weekdayLead(days, ctx.today),
    payday,
  };
}
