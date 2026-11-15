// Decision: is the buffer growing and the debt shrinking
import { type BalanceChange, balanceChange, balanceDays, totalOn } from "../analysis/balance-change.ts";
import { type BalanceWalk, balanceWalk } from "../analysis/balance-walk.ts";
import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { largePurchases } from "../analysis/large.ts";
import { payDays } from "../behaviour/payday.ts";
import type { DateRange } from "../analysis/period.ts";
import { dayNumber, fromDayNumber, fromMonthIndex, monthEnd } from "../dates.ts";
import { buildHoldings, type Holdings } from "../holdings.ts";
import { debtOutsideAccountsOn, householdDebts } from "../household-debts.ts";
import { type AccountType, type BalanceInput, type IsoDate, NO_INPUTS, type UserInputs } from "../types.ts";
import { monthLabels, rangeMonthIndexes } from "./shared.ts";

/** Defined in types.ts, below analysis and reports, because the dashboard reads balances too. */
export type { BalanceInput };

interface BalanceSeries {
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
  /**
   * The account's part of the report's `change`: its end-of-day balance on `change.to` less that on `change.from`, so
   * the accounts' changes add up to the total's. null when the report has no change.
   */
  changeCents: number | null;
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
  /**
   * The accounts added up at the end of each day from `from` to the range's end or today: the line the balance chart
   * draws, so its dips are the days the money went. null on a day an account is not known yet or is blanked.
   */
  daily: { from: IsoDate; cents: (number | null)[] };
  /** The one change of Saldot (`balanceChange`); null when no baseline day is known. */
  change: BalanceChange | null;
  /** The lowest end-of-day total of the range and the first day it was reached (`lowestDayBalance`); null when an account is not known at the start. */
  lowest: { day: IsoDate; cents: number } | null;
  /**
   * The large purchases of the range (`largePurchases`), the events the balance line marks: the eight largest, oldest
   * first. `step` is the total at the end of the day before and of the day itself when the day took at least the
   * purchase from it, so a tick runs from the one to the other; null when other money that day hid it (pay on the same
   * day) or a day is not known: such a purchase is told in the readout, with no tick.
   */
  events: { day: IsoDate; label: string; cents: number; step: { beforeCents: number; afterCents: number } | null }[];
  /**
   * The change at each month end from the month before, over the accounts that have a value at both ends (their own
   * `values[i]` less `values[i - 1]`, added up); null for the first month, where `total` of either month is unknown, or
   * where no account has both.
   */
  monthChange: (number | null)[];
  /**
   * The accounts in view that are in no total, no line and no row above, each with what is known of it: in another
   * currency its balance in that currency (`foreign`, never added to euros), with no balance told `foreign` is null.
   */
  missing: { accountId: string; name: string; type: AccountType; foreign: { currency: string; cents: number } | null }[];
  /** The pay days of `daily`'s days (`payDays`), oldest first: the days the line climbs with the pay. */
  payDays: IsoDate[];
  /** What the household has and owes today, laid out for the first page: the same answer as `DashboardData.holdings`. */
  holdings: Holdings;
}

/**
 * The lowest end-of-day balance of the accounts added up, from the end of `fromDay` to the end of `toDay`, and the
 * first day it was reached. A move between the accounts cancels out. Null when an account is not known on `fromDay`:
 * the walk cannot tell what it held before its first row.
 */
function lowestDayBalance(walks: readonly BalanceWalk[], fromDay: number, toDay: number): { cents: number; day: number } | null {
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
 * The accounts less the debts at the end of `day` (at most today), as `accountsLessDebt` counts a month's end: the
 * accounts with a balance, cards and loan accounts with their sign, less the saved loans no account holds. Null when an
 * account is not known that day or a saved loan's balance was not told yet, so a change between two days never counts
 * an account that starts in between.
 */
export function accountsLessDebtOn(ctx: AnalysisContext, accounts: readonly BalanceInput[], inputs: UserInputs, day: IsoDate): number | null {
  const walks = new Map(accounts.flatMap((a) => {
    const walk = balanceWalk(ctx, a);
    return walk ? [[a.id, walk] as const] : [];
  }));
  const n = Math.min(dayNumber(day), ctx.todayDay);
  const total = walks.size ? totalOn([...walks.values()], n) : null;
  if (total === null) return null;
  const saved = debtOutsideAccountsOn(householdDebts(accounts, inputs, ctx.today), fromDayNumber(n), (id) => (walks.get(id)?.at(n) ?? null) !== null);
  return saved.unknown.some((u) => !u.counted) ? null : total - saved.cents;
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
    return [{ accountId: a.id, name: a.name, type: a.type, ownerName: a.ownerName, balanceAt: a.balanceAt, asOf: fromDayNumber(walk.asOfDay), values, changeCents: null as number | null }];
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
  const fromDay = dayNumber(range.from);
  const toDay = Math.min(dayNumber(range.to), ctx.todayDay);
  const low = lowestDayBalance([...walks.values()], fromDay, toDay);
  const all = [...walks.values()];
  const daily: (number | null)[] = [];
  const { fromDay: dailyFrom } = balanceDays(ctx, range);
  for (let d = dailyFrom; d <= toDay && all.length; d++) daily.push(totalOn(all, d));
  const large = largePurchases(ctx);
  const events = inDays(ctx, { fromDay, toDay })
    .filter((x) => large.has(x.id))
    .sort((a, b) => a.amountCents - b.amountCents || a.day - b.day)
    .slice(0, 8)
    .sort((a, b) => a.day - b.day)
    .map((x) => {
      const before = all.length ? totalOn(all, x.day - 1) : null;
      const after = all.length ? totalOn(all, x.day) : null;
      // the day took at least the purchase: a pay or a refund the same day leaves no step of its size to point at
      const step = before !== null && after !== null && after - before <= x.amountCents ? { beforeCents: before, afterCents: after } : null;
      return { day: x.bookingDate, label: x.counterparty ?? x.description ?? "", cents: x.amountCents, step };
    });
  const pays = payDays(ctx).filter((d) => d >= dailyFrom && d <= toDay).map(fromDayNumber);
  // one definition (critic): the total's change and each account's are over the same two days, so the rows add up to the head
  const moved = balanceChange(all, dailyFrom, toDay);
  const withChange = series.map((s) => ({ ...s, changeCents: moved?.byAccount.get(s.accountId) ?? null }));
  const change = moved && { from: moved.from, to: moved.to, cents: moved.cents, basis: moved.basis };
  // over the accounts with a value at both month ends: one that starts in between would count its whole balance as change, so it is left out
  const comparable = (m: number) => series.filter((s) => s.values[m] !== null && s.values[m - 1] !== null);
  const monthChange = total.map((t, m) => {
    if (t === null || m === 0 || total[m - 1] === null) return null;
    const same = comparable(m);
    return same.length === 0 ? null : same.reduce((sum, s) => sum + (s.values[m]! - s.values[m - 1]!), 0);
  });
  // a connected loan with no balance is still in `accountsLessDebt` as the loan was typed: it is not missing from the picture
  const typedDebt = new Set(debts.sources.filter((s) => s.typed !== null).map((s) => s.accountId));
  const missing = accounts.filter((a) => !walks.has(a.id) && !typedDebt.has(a.id)).map((a) => ({ accountId: a.id, name: a.name, type: a.type, foreign: a.foreign ?? null }));
  return { months: monthLabels(months), accounts: withChange, total, monthChange, missing, accountsLessDebt, debt, daily: { from: fromDayNumber(dailyFrom), cents: daily }, change, lowest: low && { day: fromDayNumber(low.day), cents: low.cents }, events, payDays: pays, holdings: buildHoldings(ctx, accounts, inputs) };
}
