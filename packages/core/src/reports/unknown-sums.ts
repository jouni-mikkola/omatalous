// Decision: which months a bill with no known sum or day leaves without a figure after the bills (a module of its own, so a page that only counts them does not load the calendar)
import { monthOf } from "../dates.ts";
import type { IsoDate } from "../types.ts";

/**
 * A bill, loan payment, saving or pay whose sum or day is not known, so it has no row. `days` are the days it falls on in the
 * window, none when no day is known; `open` says it goes on after them (a loan's payments after the first one with no sum,
 * the pays beyond the ones found), so every later month holds it too.
 */
export interface UnknownSum {
  days: IsoDate[];
  open: boolean;
  kind: "bill" | "income" | "loan" | "saving";
  /** Paid by a card or an account the balance does not count: no sum of the month holds it, as no row of it does. */
  onCard: boolean;
}

/** Whether a sum that is not known is part of the month's sums: one with no day is part of every month, a dated one of the months it falls in and, when it goes on, of the later ones. */
const holdsMonth = (u: UnknownSum, month: string): boolean => !u.onCard && (u.days.length === 0 || (u.open ? month >= monthOf(u.days[0]!) : u.days.some((d) => monthOf(d) === month)));

/** How many of the sums that are not known are part of the month's sums: the ones that leave its `afterCents` null, as the month head of Laskut counts them. */
export const unknownsIn = (unknowns: UnknownSum[], month: string): number => unknowns.filter((u) => holdsMonth(u, month)).length;

/**
 * How many bills and loan payments with no known sum or day are part of any of the months, each counted once: the same rule as
 * `unknownsIn`, less the pays and the savings, which are no bills. A pay that is not known still leaves the month's `afterCents` null.
 */
export const unknownBillsIn = (calendar: { unknowns: UnknownSum[] }, months: string[]): number =>
  calendar.unknowns.filter((u) => u.kind !== "income" && u.kind !== "saving" && months.some((m) => holdsMonth(u, m))).length;
