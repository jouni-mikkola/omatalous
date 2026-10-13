// Decision: does the account cover what is due before the next pay (the line of days over the payments' table)
import { addDays, daysBetween } from "@banking/core";
import { dayHeading, money } from "../format.ts";
import { type Ahead, arrivals, isEstimate, paymentRows, rowName, windowPayday } from "./next-days.ts";

/** A day of the line's axis. */
interface Axis {
  iso: string;
  /** "ma" */
  weekday: string;
  /** The day of the month. */
  day: number;
  /** The day the window ends before: the pay is expected on it. */
  payday: boolean;
  /** Saturday or Sunday: the line draws a band behind the column. */
  weekend: boolean;
}

/** A payment of the window: row `row` of the payments' table. */
interface Bill {
  row: number;
  /** The index in the axis. */
  column: number;
  name: string;
  /** Positive. */
  cents: number;
  /** The app estimates its day and sum: its dot is hollow and its name says so. */
  estimate: boolean;
  /** What a reader without eyes gets for the dot: the payee, the sum, the day. */
  label: string;
  /** The day and the sum, for the line under the name in the tooltip. */
  when: string;
  /** What is left of the balance after the payments of its day, null without a balance. */
  leftCents: number | null;
}

/** A pay of the window: row `row` of the table of what is to arrive. */
interface Pay {
  row: number;
  column: number;
  name: string;
  cents: number;
  label: string;
  when: string;
}

export interface BillLine {
  axis: Axis[];
  bills: Bill[];
  pays: Pay[];
  /** What the counted accounts hold today, null without a balance: the line of steps starts at it. */
  startCents: number | null;
}

/** Whether a day of the calendar is a Saturday or a Sunday. */
export function isWeekend(iso: string): boolean {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** The weekday as `dayHeading` writes it, the first two letters of "ma 12.10.". */
const weekdayOf = (iso: string, today: string) => dayHeading(iso, today).slice(0, 2);

/**
 * The days from today to the day the window ends before (a payday), or to its last day without one, and on them the
 * payments of the window one by one, its pays, and the balance walked down. Null when no payment is due: the block is
 * then its figures and its tables, with no axis of empty days. A pay that is behind its day stands on a day gone by, so
 * it is no mark; its row is in the table.
 */
export function billLine(ahead: Ahead): BillLine | null {
  const rows = paymentRows(ahead);
  if (rows.length === 0) return null;
  const { from, to, balance } = ahead;
  const payday = windowPayday(ahead);
  const last = payday && payday > to ? payday : to;
  const columns = Math.max(1, daysBetween(from, last) + 1);
  const columnOf = (iso: string) => Math.min(columns - 1, Math.max(0, daysBetween(from, iso)));
  const axis = Array.from({ length: columns }, (_, k): Axis => {
    const iso = addDays(from, k);
    return { iso, weekday: weekdayOf(iso, from), day: Number(iso.slice(8, 10)), payday: iso === payday, weekend: isWeekend(iso) };
  });
  const start = balance ? balance.startCents : null;
  const bills = rows.map((r, row): Bill => {
    const cents = Math.abs(r.cents);
    const estimate = isEstimate(r);
    const day = dayHeading(r.date, from);
    const sum = money(cents);
    const column = columnOf(r.date);
    const paid = rows.filter((p) => columnOf(p.date) <= column).reduce((s, p) => s + Math.abs(p.cents), 0);
    return {
      row,
      column,
      name: rowName(r),
      cents,
      estimate,
      label: `${rowName(r)}, ${estimate ? "arvio, " : ""}${sum}, ${day}`,
      when: `${day} · ${sum}${estimate ? " · arvio" : ""}`,
      leftCents: start === null ? null : start - paid,
    };
  });
  const pays = arrivals(ahead).flatMap((a, row): Pay[] => {
    if (a.date < from || a.date > last) return [];
    const day = dayHeading(a.date, from);
    return [{ row, column: daysBetween(from, a.date), name: a.name, cents: a.cents, label: `Saapuva maksu, ${a.name}, ${money(a.cents)}, ${day}`, when: `${day} · ${money(a.cents)}` }];
  });
  return { axis, bills, pays, startCents: start };
}

/** What the balance is after the last payment of the line, the value its last step is drawn from; null without a balance. */
export function endCents({ startCents, bills }: BillLine): number | null {
  return startCents === null ? null : startCents - bills.reduce((sum, b) => sum + b.cents, 0);
}

/**
 * The height of zero among the steps, from the two heights the scale gives its start and its end: the scale is a straight
 * line, so zero stands where it crosses. Null unless a step is below zero (start or end under it), start and end differ
 * and zero lies inside the field of `height` pixels.
 */
export function zeroY(startCents: number, endCents: number, yStart: number, yEnd: number, height: number): number | null {
  if (startCents === endCents || Math.min(startCents, endCents) >= 0) return null;
  const y = yStart + ((yEnd - yStart) * startCents) / (startCents - endCents);
  return y >= 0 && y <= height ? y : null;
}
