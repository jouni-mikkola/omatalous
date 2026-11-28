/**
 * Decision: on which day before the payday the money on the accounts runs out and which payment takes it there, so the
 * household moves that payment or tops up the accounts before that day.
 *
 * It reads the walk of `lowPoint` (its `line` and `steps`) and adds nothing up: the day is the first corner of the line
 * below zero, the payment the biggest one of that day. The line's lowest corner is `lowPoint`'s figure, so this day
 * is on the way to the figure the first page shows.
 */
import type { IsoDate } from "./types.ts";

export interface MoneyEnds {
  date: IsoDate;
  /** The biggest payment of that day, or null when the spending between the days takes the balance below zero. */
  payee: string | null;
}

export function moneyEnds(
  walk: { line: readonly { date: IsoDate; cents: number }[]; steps: readonly { date: IsoDate; payee: string; cents: number }[] },
  payday: IsoDate,
): MoneyEnds | null {
  const at = walk.line.findIndex((c) => c.date <= payday && c.cents < 0);
  if (at < 0) return null;
  const first = walk.line[at]!;
  // a day's payments lie between its opened corner and its paid corner: they are to blame only when the corner before them, today's or that day's opened one, was still at or above zero
  if (at > 0 && walk.line[at - 1]!.date !== first.date) return { date: first.date, payee: null };
  const biggest = walk.steps.filter((s) => s.date === first.date && s.cents < 0).reduce<{ payee: string; cents: number } | null>((max, s) => (max === null || s.cents < max.cents ? s : max), null);
  return { date: first.date, payee: biggest?.payee ?? null };
}
