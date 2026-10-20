/** What a series costs: whether its price is fixed, its latest price change, its charges a year and its yearly cost (ADR 0004). */
import { monthIndex } from "./dates.ts";
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
 */
export function chargesPerYear(occ: readonly Occurrence[], cadence: CadenceDef): number {
  const year = lastTwelveMonths(occ, cadence);
  return year ? Math.min(cadence.perYear, year.length) : cadence.perYear;
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
