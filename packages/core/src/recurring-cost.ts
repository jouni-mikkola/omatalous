/** What a series costs: whether its price is fixed, its latest price change, its charges a year and its yearly cost (ADR 0004). */
import { dateIn, dayNumber, fromMonthIndex, monthIndex } from "./dates.ts";
import type { IsoDate } from "./types.ts";
import type { CadenceDef } from "./recurring-cadence.ts";
import { amountsDiffer, type Occurrence } from "./recurring-occurrence.ts";
import type { PriceChange, PriceStep, RecurringKind } from "./recurring.ts";
import { sum } from "./stats.ts";

export function latestPriceChange(occ: readonly Occurrence[]): PriceChange | null {
  for (let i = occ.length - 1; i > 0; i--) {
    if (amountsDiffer(occ[i]!.cents, occ[i - 1]!.cents)) {
      return { fromCents: occ[i - 1]!.cents, toCents: occ[i]!.cents, date: occ[i]!.date };
    }
  }
  return null;
}

/** The lengths of the runs of one price, oldest first. */
function priceRuns(occ: readonly Occurrence[]): number[] {
  const runs: number[] = [];
  for (let i = 0; i < occ.length; i++) {
    if (i > 0 && !amountsDiffer(occ[i]!.cents, occ[i - 1]!.cents)) runs[runs.length - 1]!++;
    else runs.push(1);
  }
  return runs;
}

/**
 * Fixed price: no change at all, or a price that moves in steps. The first price repeated at least twice (with only
 * two charges, "one change" is two different purchases, not a subscription), each price between it and the newest
 * held for three charges or more, so a service that rose twice in two years is still one price at a time, while a
 * bill whose sum moves every month or two is not.
 */
export function isFixedAmount(occ: readonly Occurrence[]): boolean {
  const runs = priceRuns(occ);
  if (runs.length === 1) return true;
  if (occ.length < 4) return false;
  return runs[0]! >= 2 && runs.slice(1, -1).every((n) => n >= 3);
}

/**
 * Every price of a fixed-price series, dated: the first charge, then each charge that moved the price, with the move
 * and what it adds to a year of the series' charges (`perYear`, as `priceChangeYearlyCents` counts the last move).
 */
export function priceStepsOf(occ: readonly Occurrence[], perYear: number): PriceStep[] {
  const steps: PriceStep[] = [{ date: occ[0]!.date, cents: occ[0]!.cents }];
  for (let i = 1; i < occ.length; i++) {
    if (!amountsDiffer(occ[i]!.cents, occ[i - 1]!.cents)) continue;
    const deltaCents = occ[i]!.cents - occ[i - 1]!.cents;
    steps.push({ date: occ[i]!.date, cents: occ[i]!.cents, deltaCents, yearlyDeltaCents: Math.round(deltaCents * perYear) });
  }
  return steps;
}

/**
 * Charges a year. A monthly series with a year of history counts its charges
 * in the twelve months up to the last one: day care is free in July and
 * after-school care pauses for the summer, so they cost 11 and 9 charges a
 * year. A late payment moves a charge to the next month and keeps the count.
 * `others` is passed only for a loan instalment (`seriesOfGroup`): the
 * lender's charges on the account that no product of it holds. A month with
 * no instalment still counts when one of them, half to twice the newest
 * instalment, fell within the cadence's tolerance of that month's due day:
 * the lender took a short or extra sum that month. A fee meant to pause
 * (day care in July, a gym in summer) never gets these rows, so a purchase in
 * its paused month fills nothing.
 */
export function chargesPerYear(occ: readonly Occurrence[], cadence: CadenceDef, others: readonly Occurrence[] = []): number {
  const year = lastTwelveMonths(occ, cadence);
  if (!year) return cadence.perYear;
  const last = monthIndex(occ[occ.length - 1]!.date);
  const own = new Set(year.map((o) => monthIndex(o.date)));
  const typical = year[year.length - 1]!.cents;
  const filled = new Set<number>();
  for (const o of others) {
    if (o.cents * 2 < typical || o.cents > typical * 2) continue;
    const m = dueMonth(o.date, year, cadence);
    if (m !== null && m > last - 12 && m < last && !own.has(m)) filled.add(m);
  }
  return Math.min(cadence.perYear, year.length + filled.size);
}

/**
 * The month whose due day `date` falls within the cadence's tolerance of, or null. The due day is the day of month of
 * the series' charge before `date`, clamped to each month's length, so a row on 2 July of a series due on the 30th is
 * June's charge paid late, and one on 1 June of a series due on the 31st is May's, not June's.
 */
function dueMonth(date: IsoDate, year: readonly Occurrence[], cadence: CadenceDef): number | null {
  const before = [...year].reverse().find((o) => o.date < date) ?? year[0]!;
  const day = Number(before.date.slice(8, 10));
  const m = monthIndex(date);
  for (const near of [m, m - 1, m + 1]) {
    if (Math.abs(dayNumber(date) - dayNumber(dateIn(fromMonthIndex(near), day))) <= cadence.tolerance) return near;
  }
  return null;
}

/** A monthly series' charges in the twelve months up to its last one; null with less than a year of history. */
function lastTwelveMonths(occ: readonly Occurrence[], cadence: CadenceDef): Occurrence[] | null {
  if (cadence.months !== 1) return null;
  const last = monthIndex(occ[occ.length - 1]!.date);
  if (last - monthIndex(occ[0]!.date) < 11) return null;
  return occ.filter((o) => monthIndex(o.date) > last - 12);
}

/**
 * What a series costs in a year. A bill that varies with the season
 * (electricity) is what its last twelve charges came to: the latest
 * summer bills times twelve would miss the winter.
 */
export function yearlyCostOf(occ: readonly Occurrence[], cadence: CadenceDef, kind: RecurringKind, typical: number, perYear: number): number {
  const year = kind === "bill" ? lastTwelveMonths(occ, cadence) : null;
  return year && year.length >= perYear ? sum(year.slice(-perYear).map((o) => o.cents)) : Math.round(typical * perYear);
}
