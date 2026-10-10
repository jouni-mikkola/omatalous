import { addDays, addMonths, dayNumber, daysBetween, daysInMonth, monthOf } from "../dates.ts";
import type { IsoDate } from "../types.ts";

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

/** Day-number bounds for fast range checks. */
export interface DayRange {
  fromDay: number;
  toDay: number;
}

export function toDayRange(r: DateRange): DayRange {
  return { fromDay: dayNumber(r.from), toDay: dayNumber(r.to) };
}

export function rangeLength(r: DateRange): number {
  return daysBetween(r.from, r.to) + 1;
}

/** Months the range spans, in fractional months (minimum 1). */
export function rangeMonths(r: DateRange): number {
  return Math.max(1, rangeLength(r) / 30.44);
}

/**
 * The period to compare against. Month-aligned ranges compare to the same
 * days of the previous month(s): 1.–9.10. against 1.–9.9., not 22.–30.9.
 * The year so far compares to the same dates a year earlier, since the
 * months right before it are other seasons. Other ranges compare to the
 * same number of days right before.
 */
export function previousRange(from: IsoDate, to: IsoDate): [IsoDate, IsoDate] {
  if (from.endsWith("-01-01") && to.slice(0, 4) === from.slice(0, 4)) {
    const year = Number(from.slice(0, 4)) - 1;
    const month = `${year}-${to.slice(5, 7)}`;
    const day = Math.min(Number(to.slice(8, 10)), daysInMonth(month));
    return [`${year}-01-01`, `${month}-${String(day).padStart(2, "0")}`];
  }
  if (!from.endsWith("-01")) {
    const length = daysBetween(from, to) + 1;
    const previousTo = addDays(from, -1);
    return [addDays(previousTo, -(length - 1)), previousTo];
  }
  const fromMonth = monthOf(from);
  const toMonth = monthOf(to);
  const [fy, fm] = fromMonth.split("-").map(Number) as [number, number];
  const [ty, tm] = toMonth.split("-").map(Number) as [number, number];
  const span = (ty - fy) * 12 + (tm - fm) + 1;
  const prevToMonth = addMonths(toMonth, -span);
  const toDay = Number(to.slice(8, 10));
  const lastDay = daysInMonth(prevToMonth);
  const day = toDay === daysInMonth(toMonth) ? lastDay : Math.min(toDay, lastDay);
  return [`${addMonths(fromMonth, -span)}-01`, `${prevToMonth}-${String(day).padStart(2, "0")}`];
}
