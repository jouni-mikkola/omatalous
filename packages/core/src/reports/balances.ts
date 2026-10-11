// Decision: is the buffer growing and the debt shrinking
import type { AnalysisContext } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import { dayNumber, daysInMonth, fromDayNumber, fromMonthIndex } from "../dates.ts";
import type { AccountType, BalanceInput, IsoDate } from "../types.ts";
import { monthLabels, rangeMonthIndexes } from "./shared.ts";

/** Defined in types.ts, below analysis and reports, because the dashboard reads balances too. */
export type { BalanceInput };

export interface BalanceSeries {
  accountId: string;
  /** With the owner's name in brackets when the account is shared with the viewer: two "Käyttötili" must be told apart. */
  name: string;
  type: AccountType;
  /** Whose account it is when a household member shared it with the viewer; null for the viewer's own. */
  ownerName: string | null;
  /** When the balance this series is counted from was given (an ISO timestamp), null when unknown. */
  balanceAt: string | null;
  /** The day that balance stands for, where the walk back and forward starts: the day of `balanceAt`, or today when unknown. */
  asOf: IsoDate;
  /**
   * Balance at the end of each month, today's balance for the month in progress; null before the account's first
   * transaction (or, with no transactions, before `asOf`).
   */
  values: (number | null)[];
}

export interface BalanceReport {
  months: string[];
  accounts: BalanceSeries[];
  /**
   * The accounts added up at each month end, cards and loans with the sign the bank reports them (a card in debt takes
   * from it). An account that has not started yet adds nothing, so early months are an estimate; null when no account
   * has a value yet.
   */
  total: (number | null)[];
}

/**
 * Month-end balances reconstructed from the balance the bank last gave: the balance at a day is the given balance
 * minus the booked transactions after that day, up to the day it was given, and plus the ones booked since then
 * (an import that is newer than the balance).
 */
export function balanceReport(ctx: AnalysisContext, range: DateRange, accounts: readonly BalanceInput[]): BalanceReport {
  const months = rangeMonthIndexes(range);
  const monthEnds = months.map((i) => {
    const m = fromMonthIndex(i);
    return dayNumber(`${m}-${String(daysInMonth(m)).padStart(2, "0")}`);
  });
  const series = accounts
    .filter((a) => a.balanceCents !== null)
    .map((a): BalanceSeries => {
      const txs = ctx.txs.filter((t) => t.accountId === a.id && t.status === "booked");
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
      const given = a.balanceAt && /^\d{4}-\d{2}-\d{2}/.test(a.balanceAt) ? dayNumber(a.balanceAt.slice(0, 10)) : ctx.todayDay;
      const asOfDay = Math.min(given, ctx.todayDay);
      const base = a.balanceCents! - sumUpTo(asOfDay);
      // an account with no transactions is known from the day its balance was given
      const firstDay = txs[0]?.day ?? asOfDay;
      const values = monthEnds.map((end) => {
        // the month in progress ends today as far as the books go
        const day = Math.min(end, ctx.todayDay);
        return day < firstDay ? null : base + sumUpTo(day);
      });
      return { accountId: a.id, name: a.name, type: a.type, ownerName: a.ownerName, balanceAt: a.balanceAt, asOf: fromDayNumber(asOfDay), values };
    });
  const total = monthEnds.map((_, m) => {
    let sum = 0;
    let any = false;
    for (const s of series) {
      const v = s.values[m]!;
      if (v === null) continue;
      sum += v;
      any = true;
    }
    return any ? sum : null;
  });
  return { months: monthLabels(months), accounts: series, total };
}
