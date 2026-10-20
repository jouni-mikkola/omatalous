import type { IsoDate } from "./types.ts";

/*
 * Dates are ISO strings ("2026-10-09") everywhere: they sort correctly as
 * strings and survive JSON and SQL unchanged. Arithmetic goes through a day
 * number (days since 1970-01-01, UTC) parsed by hand, which is much cheaper
 * than constructing Date objects from strings in hot loops.
 */

const DAY_MS = 86_400_000;

/** "2026-10-09" → days since the Unix epoch. */
export function dayNumber(s: IsoDate): number {
  const y = (s.charCodeAt(0) - 48) * 1000 + (s.charCodeAt(1) - 48) * 100 + (s.charCodeAt(2) - 48) * 10 + (s.charCodeAt(3) - 48);
  const m = (s.charCodeAt(5) - 48) * 10 + (s.charCodeAt(6) - 48);
  const d = (s.charCodeAt(8) - 48) * 10 + (s.charCodeAt(9) - 48);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromDayNumber(n: number): IsoDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(s: IsoDate, days: number): IsoDate {
  return fromDayNumber(dayNumber(s) + days);
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return dayNumber(b) - dayNumber(a);
}

/** "2026-03" */
export function monthOf(s: IsoDate): string {
  return s.slice(0, 7);
}

/** Months since year 0, for cheap month arithmetic and array indexing. */
export function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

export function fromMonthIndex(i: number): string {
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

export function addMonths(month: string, n: number): string {
  return fromMonthIndex(monthIndex(month) + n);
}

/** Inclusive list of months, e.g. ("2026-01", "2026-03") → 3 months. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = monthIndex(from), end = monthIndex(to); i <= end; i++) out.push(fromMonthIndex(i));
  return out;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Day `day` of `month`, clamped to the month's length: ("2026-02", 31) → "2026-02-28". */
export function dateIn(month: string, day: number): IsoDate {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
}

/** The last day of the month: "2026-02" → "2026-02-28". */
export const monthEnd = (month: string): IsoDate => dateIn(month, 31);

/** The same day `n` months later, clamped to the month's length (31.1. + 1 is 28.2., 29.2. − 12 is 28.2.). */
export function addMonthsToDate(date: IsoDate, n: number): IsoDate {
  return dateIn(addMonths(monthOf(date), n), Number(date.slice(8, 10)));
}

/** The mean month in days: a span of days as months. The one copy of this number. */
export const DAYS_PER_MONTH = 30.44;

/** 0 = Monday … 6 = Sunday (1970-01-01 was a Thursday). */
export function weekdayOf(s: IsoDate): number {
  return (dayNumber(s) + 3) % 7;
}
