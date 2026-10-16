// Decision: what an account holds on any day, walked from the balance the bank last gave. Saldot and the first page read this one answer.
import { dayNumber, fromDayNumber } from "../dates.ts";
import { balanceDayOf } from "../household-debts.ts";
import type { BalanceInput } from "../types.ts";
import type { AnalysisContext, AnalysisTx } from "./context.ts";

/** The rows a balance is walked over: the account's booked rows (pending rows are left out, as the bank leaves them out of the balance). */
const bookedRows = (ctx: AnalysisContext, accountId: string): AnalysisTx[] => ctx.txs.filter((t) => t.accountId === accountId && t.status === "booked");

/** One account's balance on any day, walked from the balance the bank last gave. */
export interface BalanceWalk {
  accountId: string;
  /** The day the given balance stands for: the day of `balanceAt`, today when it is unknown or in the future. */
  asOfDay: number;
  /** The first day the balance is known: the account's first booked row, or `asOfDay` when it has none. */
  firstDay: number;
  /** The days of the booked rows, ascending (a day repeats per row): the balance changes only on these. */
  days: readonly number[];
  /** The balance at the end of `day` (a day number); null before `firstDay`, and before the newest day of a row in another currency. */
  at: (day: number) => number | null;
  /**
   * Whether `day` is unknown because of a row in another currency: the balance of a day is the given one less the rows after it, and a
   * later row in another currency moved the bank's euro balance by an amount the app does not know. A day before `firstDay` with no
   * such row after it is not blanked (the account was not known yet, which is not a hole).
   */
  blanked: (day: number) => boolean;
}

/**
 * The day walk: the balance at the end of a day is the given balance minus the booked rows after that day, up to the
 * day it was given, plus the ones booked since then (an import newer than the balance). Pending rows are left out,
 * as the bank leaves them out of the balance. A row in another currency is not in `txs`, but the bank's balance may hold its
 * euro value: every day before the newest such row is unknown. Null for an account without a balance.
 */
export function balanceWalk(ctx: AnalysisContext, account: BalanceInput): BalanceWalk | null {
  if (account.balanceCents === null) return null;
  const txs = bookedRows(ctx, account.id);
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
  const foreign = ctx.foreignRows.find((f) => f.accountId === account.id);
  const foreignDay = foreign ? dayNumber(foreign.newestDay) : -Infinity;
  return {
    accountId: account.id, asOfDay, firstDay, days: txs.map((t) => t.day),
    at: (day) => (day < firstDay || day < foreignDay ? null : base + sumUpTo(day)),
    blanked: (day) => day < foreignDay,
  };
}

/**
 * What a balance at the end of `day` adds up: the balance the bank gave, standing for `openingDay`, and the booked rows
 * between that day and `day`, each at the cents it moves the balance (a row after `day` and up to the given day takes
 * its cents off the given balance, a row after the given day adds them). The opening and the cents add up to
 * `balanceWalk(...).at(day)`. Null where the walk has no balance on that day.
 */
export function balanceRows(ctx: AnalysisContext, account: BalanceInput, day: number): { openingCents: number; openingDay: string; rows: { tx: AnalysisTx; cents: number }[] } | null {
  const walk = balanceWalk(ctx, account);
  if (!walk || walk.at(day) === null) return null;
  const rows = bookedRows(ctx, account.id).flatMap((tx) => (day < tx.day && tx.day <= walk.asOfDay ? [{ tx, cents: -tx.amountCents }] : walk.asOfDay < tx.day && tx.day <= day ? [{ tx, cents: tx.amountCents }] : []));
  return { openingCents: account.balanceCents!, openingDay: fromDayNumber(walk.asOfDay), rows };
}
