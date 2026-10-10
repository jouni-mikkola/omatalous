import type { AnalysisContext } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import { dayNumber, daysInMonth, fromMonthIndex } from "../dates.ts";
import type { AccountType } from "../types.ts";
import { monthLabels, rangeMonthIndexes } from "./shared.ts";

export interface BalanceSeries {
  accountId: string;
  name: string;
  type: AccountType;
  /** Balance at the end of each month; null before the account's first transaction. */
  values: (number | null)[];
}

export interface BalanceReport {
  months: string[];
  accounts: BalanceSeries[];
}

export interface BalanceInput {
  id: string;
  name: string;
  type: AccountType;
  balanceCents: number | null;
}

/**
 * Month-end balances reconstructed backwards from today's balance:
 * balance(end of m) = balance now − booked transactions after the end of m.
 */
export function balanceReport(ctx: AnalysisContext, range: DateRange, accounts: readonly BalanceInput[]): BalanceReport {
  const months = rangeMonthIndexes(range);
  const monthEnds = months.map((i) => {
    const m = fromMonthIndex(i);
    return dayNumber(`${m}-${String(daysInMonth(m)).padStart(2, "0")}`);
  });
  const series = accounts
    .filter((a) => a.balanceCents !== null)
    .map((a) => {
      const txs = ctx.txs.filter((t) => t.accountId === a.id && t.status === "booked");
      const firstDay = txs[0]?.day ?? Number.POSITIVE_INFINITY;
      // walk months from newest to oldest, peeling off the transactions after each month end
      const values = new Array<number | null>(monthEnds.length).fill(null);
      let balance = a.balanceCents!;
      let i = txs.length - 1;
      for (let m = monthEnds.length - 1; m >= 0; m--) {
        const end = monthEnds[m]!;
        while (i >= 0 && txs[i]!.day > end) balance -= txs[i--]!.amountCents;
        values[m] = end < firstDay ? null : balance;
      }
      return { accountId: a.id, name: a.name, type: a.type, values };
    });
  return { months: monthLabels(months), accounts: series };
}
