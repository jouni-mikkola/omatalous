/** The cadences a series can have, and the fit of a run of charges to one: the cadence table (ADR 0004) and its dates. */
import { addDays, daysBetween, daysInMonth, monthIndex } from "./dates.ts";
import { amountsDiffer, type Occurrence } from "./recurring-occurrence.ts";
import { median } from "./stats.ts";
import type { IsoDate } from "./types.ts";

export type Cadence = "weekly" | "biweekly" | "semimonthly" | "monthly" | "bimonthly" | "quarterly" | "semiannual" | "yearly";

export interface CadenceDef {
  id: Cadence;
  days: number;
  tolerance: number;
  minOccurrences: number;
  perYear: number;
  /** Calendar months per step for month-based cadences (the next charge keeps the day of month), 0 otherwise. */
  months: number;
}

export const CADENCES: readonly CadenceDef[] = [
  { id: "weekly", days: 7, tolerance: 2, minOccurrences: 4, perYear: 365.25 / 7, months: 0 },
  { id: "biweekly", days: 14, tolerance: 3, minOccurrences: 4, perYear: 365.25 / 14, months: 0 },
  { id: "monthly", days: 30.44, tolerance: 5, minOccurrences: 3, perYear: 12, months: 1 },
  { id: "bimonthly", days: 60.88, tolerance: 8, minOccurrences: 3, perYear: 6, months: 2 },
  { id: "quarterly", days: 91.31, tolerance: 12, minOccurrences: 3, perYear: 4, months: 3 },
  { id: "semiannual", days: 182.62, tolerance: 20, minOccurrences: 2, perYear: 2, months: 6 },
  { id: "yearly", days: 365.25, tolerance: 25, minOccurrences: 2, perYear: 1, months: 12 },
];

/** The calendar months between two charges of the month-based cadence that an interval of `gapDays` matches, or null. */
export function cadenceMonths(gapDays: number): number | null {
  return CADENCES.find((c) => c.months > 0 && Math.abs(gapDays - c.days) <= c.tolerance)?.months ?? null;
}

/** Two charges a month on fixed days (salary on the 15th and the last day): looks biweekly by gaps alone. */
export const SEMIMONTHLY: CadenceDef = { id: "semimonthly", days: 365.25 / 24, tolerance: 3, minOccurrences: 4, perYear: 24, months: 0 };

const MIN_REGULARITY = 0.7;

/** Two charges far apart only count as recurring when they are nearly the same amount. */
function enoughEvidence(occ: readonly Occurrence[], cadence: CadenceDef): boolean {
  if (occ.length >= 3 || cadence.days < 180) return true;
  const [a, b] = [occ[0]!.cents, occ[1]!.cents];
  return Math.abs(a - b) <= 0.15 * Math.max(a, b);
}

const dayOfMonth = (d: IsoDate) => Number(d.slice(8, 10));

/**
 * Full months between the first and the last have two charges, and the
 * first and second charge of a month each stay on about the same day.
 * Biweekly charges drift through the month by two to three days a month,
 * so they fail the second test. One odd month in six (holiday pay as a
 * third payment) is allowed.
 */
function isSemimonthly(occ: readonly Occurrence[]): boolean {
  const perMonth = new Map<number, IsoDate[]>();
  for (const o of occ) {
    const m = monthIndex(o.date);
    const dates = perMonth.get(m);
    if (dates) dates.push(o.date);
    else perMonth.set(m, [o.date]);
  }
  const first = monthIndex(occ[0]!.date);
  const last = monthIndex(occ[occ.length - 1]!.date);
  if (last - first < 2) return false;
  const firsts: number[] = [];
  const seconds: number[] = [];
  let odd = 0;
  for (let m = first; m <= last; m++) {
    const dates = perMonth.get(m) ?? [];
    const inner = m !== first && m !== last;
    if (dates.length > 2 || (inner && dates.length !== 2)) odd += 1;
    else if (dates.length === 2) {
      firsts.push(dayOfMonth(dates[0]!));
      seconds.push(dayOfMonth(dates[1]!));
    }
  }
  if (odd > Math.max(1, Math.floor((last - first + 1) / 6))) return false;
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  // weekend shifts and month lengths move a day by a few days, not more
  return firsts.length >= 2 && spread(firsts) <= 6 && spread(seconds) <= 6;
}

/**
 * A subscriptions-category service bills one price every month, so a new one makes its series on the second charge,
 * and the household sees it among its fixed costs a month sooner. Other monthly charges wait for a third: two equal
 * shop visits or course fees a month apart happen by chance, and a service paid from another account before has
 * moved, so its first two charges here are no new subscription.
 */
const secondChargeWillDo = (occ: readonly Occurrence[], cadence: CadenceDef, newService: boolean) =>
  newService && occ.length === 2 && cadence.id === "monthly" && !amountsDiffer(occ[0]!.cents, occ[1]!.cents);

/** Fits a fixed cadence to the occurrences, or returns null when they are not regular. */
export function fitCadence(occ: readonly Occurrence[], newService = false): { cadence: CadenceDef; regularity: number } | null {
  if (occ.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < occ.length; i++) intervals.push(daysBetween(occ[i - 1]!.date, occ[i]!.date));
  const m = median(intervals);
  let cadence = CADENCES.find((c) => Math.abs(m - c.days) <= c.tolerance);
  if (cadence?.id === "biweekly" && m >= 13 && m <= 17 && isSemimonthly(occ)) cadence = SEMIMONTHLY;
  if (!cadence || (occ.length < cadence.minOccurrences && !secondChargeWillDo(occ, cadence, newService))) return null;
  let score = 0;
  for (const iv of intervals) {
    if (Math.abs(iv - cadence.days) <= cadence.tolerance * 1.5) score += 1;
    // one missed charge (e.g. a skipped month) still counts half
    else if (Math.abs(iv - 2 * cadence.days) <= cadence.tolerance * 2) score += 0.5;
  }
  const regularity = score / intervals.length;
  return regularity >= MIN_REGULARITY && enoughEvidence(occ, cadence) ? { cadence, regularity } : null;
}

/** Same day of month `n` months later, clamped to the month's length (31.1. + 1 → 28.2.). */
export function addMonthsKeepDay(date: IsoDate, n: number): IsoDate {
  const i = monthIndex(date) + n;
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  const month = `${y}-${String(m).padStart(2, "0")}`;
  const day = Math.min(dayOfMonth(date), daysInMonth(month));
  return `${month}-${String(day).padStart(2, "0")}`;
}

/**
 * Month-based cadences land on the day of month of the last charge (rent on
 * the 1st → the 1st), semimonthly on the day of the charge before it.
 */
export function nextDateOf(occ: readonly Occurrence[], cadence: CadenceDef): IsoDate {
  const last = occ[occ.length - 1]!.date;
  if (cadence.months) return addMonthsKeepDay(last, cadence.months);
  if (cadence.id === "semimonthly" && occ.length >= 2) {
    const next = addMonthsKeepDay(occ[occ.length - 2]!.date, 1);
    return next > last ? next : addMonthsKeepDay(last, 1);
  }
  return addDays(last, Math.round(cadence.days));
}
