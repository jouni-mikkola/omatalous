// Decision: is the buffer growing and the debt shrinking
import { type BalanceWalk, balanceWalk } from "../analysis/balance-walk.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import { dayNumber, fromDayNumber, fromMonthIndex, monthEnd } from "../dates.ts";
import { buildHoldings, type Holdings } from "../holdings.ts";
import { debtOutsideAccountsOn, householdDebts } from "../household-debts.ts";
import { type AccountType, type BalanceInput, type IsoDate, NO_INPUTS, type UserInputs } from "../types.ts";
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
  /**
   * The money on the accounts less the debts at each month end: `total` less the saved loans with no account behind
   * them (`debtOutsideAccountsOn`), each at its balance on that day (`loanBalanceOn`). Connected cards and loan
   * accounts are in `total` already, and so is a saved loan linked to one: its account tells it, at every month end
   * the account has a balance for, and at a month end before that the loan counts as typed, like one with no link.
   * No home, no investments and no other property are in it, so it is no net worth.
   * Null where `total` is, and in a month that ends before such a saved loan's balance was told. The same as `total`
   * for a household without saved loans. A saved loan that is also a connected account and is not linked to it is
   * taken twice (`maybeTwice` and `overdraftTwice` of `household-debts.ts` name them, and the Lainat report says them).
   */
  accountsLessDebt: (number | null)[];
  /**
   * What the household owes today, the one debt total (`householdDebts`), and the part of it no account holds, the
   * saved loans that are linked to none: what today's `accountsLessDebt` takes from `total`.
   */
  debt: { day: IsoDate; cents: number; savedCents: number };
  /** What the household has and owes today, laid out for the first page: the same answer as `DashboardData.holdings`. */
  holdings: Holdings;
}

/**
 * The lowest end-of-day balance of the accounts added up, from the end of `fromDay` to the end of `toDay`, and the
 * first day it was reached. A move between the accounts cancels out. Null when an account is not known on `fromDay`:
 * the walk cannot tell what it held before its first row.
 */
export function lowestDayBalance(walks: readonly BalanceWalk[], fromDay: number, toDay: number): { cents: number; day: number } | null {
  if (!walks.length || fromDay > toDay || walks.some((w) => w.firstDay > fromDay)) return null;
  const total = (day: number) => walks.reduce((s, w) => s + w.at(day)!, 0);
  // the sum changes only on a day some account has a row, so those days and the first day are all there is to look at
  const days = [...new Set(walks.flatMap((w) => w.days.filter((d) => d > fromDay && d <= toDay)))].sort((a, b) => a - b);
  let low = { cents: total(fromDay), day: fromDay };
  for (const day of days) {
    const cents = total(day);
    if (cents < low.cents) low = { cents, day };
  }
  return low;
}

/**
 * Month-end balances from the day walk (`balanceWalk`) of each account with a balance, and net worth: the accounts
 * less the loans the user saved (`inputs`), which no account holds.
 */
export function balanceReport(ctx: AnalysisContext, range: DateRange, accounts: readonly BalanceInput[], inputs: UserInputs = NO_INPUTS): BalanceReport {
  const months = rangeMonthIndexes(range);
  const monthEnds = months.map((i) => {
    const m = fromMonthIndex(i);
    return dayNumber(monthEnd(m));
  });
  const walks = new Map<string, BalanceWalk>();
  const series = accounts.flatMap((a): BalanceSeries[] => {
    const walk = balanceWalk(ctx, a);
    if (!walk) return [];
    walks.set(a.id, walk);
    // the month in progress ends today as far as the books go
    const values = monthEnds.map((end) => walk.at(Math.min(end, ctx.todayDay)));
    return [{ accountId: a.id, name: a.name, type: a.type, ownerName: a.ownerName, balanceAt: a.balanceAt, asOf: fromDayNumber(walk.asOfDay), values }];
  });
  const total = monthEnds.map((end, m) => {
    // an account blanked by a row in another currency makes the day's total unknown: a total without it would read as the whole
    if (series.some((s) => walks.get(s.accountId)!.blanked(Math.min(end, ctx.todayDay)))) return null;
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
  const debts = householdDebts(accounts, inputs, ctx.today);
  // a linked loan counts as typed on a day its account has no balance for yet: `total` does not hold it there
  const outside = (day: number) => debtOutsideAccountsOn(debts, fromDayNumber(day), (id) => (walks.get(id)?.at(day) ?? null) !== null);
  const accountsLessDebt = monthEnds.map((end, m) => {
    if (total[m] === null) return null;
    const saved = outside(Math.min(end, ctx.todayDay));
    // a loan that is left out was not told yet on that day: what was owed then is not known
    return saved.unknown.some((u) => !u.counted) ? null : total[m]! - saved.cents;
  });
  const debt = { day: debts.day, cents: debts.total.cents, savedCents: outside(ctx.todayDay).cents };
  return { months: monthLabels(months), accounts: series, total, accountsLessDebt, debt, holdings: buildHoldings(ctx, accounts, inputs) };
}
