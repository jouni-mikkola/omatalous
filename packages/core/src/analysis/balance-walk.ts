// Decision: what an account holds on any day, walked from the balance the bank last gave. Saldot and the first page read this one answer.
import { dayNumber } from "../dates.ts";
import { balanceDayOf } from "../household-debts.ts";
import type { BalanceInput } from "../types.ts";
import type { AnalysisContext } from "./context.ts";

/** One account's balance on any day, walked from the balance the bank last gave. */
export interface BalanceWalk {
  accountId: string;
  /** The day the given balance stands for: the day of `balanceAt`, today when it is unknown or in the future. */
  asOfDay: number;
  /** The first day the balance is known: the account's first booked row, or `asOfDay` when it has none. */
  firstDay: number;
  /** The days of the booked rows, ascending (a day repeats per row): the balance changes only on these. */
  days: readonly number[];
  /** The balance at the end of `day` (a day number); null before `firstDay`. */
  at: (day: number) => number | null;
}

/**
 * The day walk: the balance at the end of a day is the given balance minus the booked rows after that day, up to the
 * day it was given, plus the ones booked since then (an import newer than the balance). Pending rows are left out,
 * as the bank leaves them out of the balance. Null for an account without a balance.
 */
export function balanceWalk(ctx: AnalysisContext, account: BalanceInput): BalanceWalk | null {
  if (account.balanceCents === null) return null;
  const txs = ctx.txs.filter((t) => t.accountId === account.id && t.status === "booked");
  // running sums by position: cumulative[k] is what the first k transactions add up to
  const cumulative = [0];
  for (const t of txs) cumulative.push(cumulative[cumulative.length - 1]! + t.amountCents);
  const sumUpTo = (day: number) => {
    let lo = 0;
    let hi = txs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (txs[mid]!.day <= day) lo = mid + 1;
      else hi = mid;
    }
    return cumulative[lo]!;
  };
  // a balance dated in the future is a clock error: it stands for today at most
  const asOfDay = dayNumber(balanceDayOf(account.balanceAt, ctx.today));
  const base = account.balanceCents - sumUpTo(asOfDay);
  // an account with no transactions is known from the day its balance was given
  const firstDay = txs[0]?.day ?? asOfDay;
  return { accountId: account.id, asOfDay, firstDay, days: txs.map((t) => t.day), at: (day) => (day < firstDay ? null : base + sumUpTo(day)) };
}
