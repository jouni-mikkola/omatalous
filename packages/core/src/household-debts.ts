/**
 * The debts of the household: the one list behind each debt total (the Lainat report, the accounts less the debts in
 * Saldot, the loan area of Säästövinkit). This file alone decides which debts count and that one debt counts once
 * (ADR 0004). Every figure of a single loan stays in `loans.ts`.
 */
import { creditAccountLoan, type DebtFigure, debtInterestNext12Months, debtTotalOn, loanBalanceOn, loanLastDueDate, loansOf } from "./loans.ts";
import type { Account, IsoDate, Loan, UserInputs } from "./types.ts";

/** The account types whose balance below zero is a debt. A checking account's overdraft stays in the accounts' total. */
export const DEBT_ACCOUNT_TYPES: readonly Account["type"][] = ["credit_card", "loan"];

/** The account a debt of `HouseholdDebts.connected` reads its balance from. */
export interface DebtSource {
  /** The debt's id in `connected`: the saved loan's id for a linked pair, `account:<account id>` otherwise. */
  loanId: string;
  accountId: string;
  /** The debt is a saved loan the household linked to the account (`Loan.accountId`): its terms are the saved loan's. */
  linked: boolean;
  /** The saved loan of a linked pair as it was typed, null with no link: what the pair counts as on a day its account tells nothing. */
  typed: Loan | null;
}

/** A connected account as the debts read it: what `creditAccountLoan` reads, and when the bank gave the balance. */
export type DebtAccount = Parameters<typeof creditAccountLoan>[0] & { balanceAt?: string | null };

/**
 * The day an account's balance stands for: the day of `balanceAt`, and `today` when that is unknown or in the future
 * (a clock error). The day walk of Saldot and the link of a saved loan read the one answer.
 */
export const balanceDayOf = (balanceAt: string | null | undefined, today: IsoDate): IsoDate => {
  const given = balanceAt && /^\d{4}-\d{2}-\d{2}/.test(balanceAt) ? balanceAt.slice(0, 10) : today;
  return given < today ? given : today;
};

export interface HouseholdDebts {
  /** The day the debts are told on. */
  day: IsoDate;
  /**
   * The saved loans that are no connected account's debt, in the order they were saved. The accounts' total does not
   * hold them. A saved loan linked to an account is in `connected` instead.
   */
  saved: readonly Loan[];
  /**
   * The debts a connected account tells, in the accounts' order. Their balances are in the accounts' total. An account
   * no saved loan is linked to counts when it owes something, as the bank tells it (`creditAccountLoan`). A linked pair
   * is the saved loan with the account's balance, dated on the plan's latest due date: one debt, whatever the account
   * owes. A pair whose account's balance is older than the typed one is the saved loan as typed.
   */
  connected: readonly Loan[];
  /** One for each debt of `connected`, in its order: the account behind it, and whether a saved loan is linked to it. */
  sources: readonly DebtSource[];
  /** `saved` then `connected`. */
  loans: readonly Loan[];
  /** What is owed in all on the day: `debtTotalOn` of `loans`. */
  total: DebtFigure;
  /** What the debt costs over the 12 months after the day: `debtInterestNext12Months` of `loans`. */
  interest: DebtFigure;
  /**
   * False when the interest has no figure to tell: a loan is left out for its rate and no loan that owes is counted.
   * Such a sum reads "ei tiedossa", never zero.
   */
  interestKnown: boolean;
}

/**
 * The debts of the household on a day.
 * - A saved loan counts as typed, and a connected card or loan account that owes something counts as the bank tells
 *   it (`creditAccountLoan`).
 * - A saved loan that names such an account (`Loan.accountId`) is that account's debt, and the pair counts once: the
 *   balance is the account's, since the bank knows what is owed today, and the name, kind, rate, plan and last due
 *   date are the saved loan's, so its payment, interest and payoff stay known. The limit is the saved loan's, or the
 *   account's when the loan has none.
 * - The bank's balance is dated on the plan's latest due date on or before the day (`loanLastDueDate`), and on the
 *   loan's own balance date when none has passed: the payments after it fall on the loan's due days, so the payoff
 *   date does not move with the day the debts are read on.
 * - The link holds only for an account that is in `accounts`, is a card or a loan account today (its type can be
 *   changed after the link was made) and has a balance at or below zero. Otherwise both sides count as if no link
 *   was made: a loan account the bank tells with a plus is no debt, and the typed loan is.
 * - An account balance given before the loan's balance date (`balanceDayOf`) is the older word of the two: the pair
 *   keeps the typed balance and still counts once.
 * - No index in the database holds an account to one loan, so this does not trust it: the first saved loan that names
 *   an account takes it, and a later one counts as typed.
 * - Without a link nothing here knows that a saved loan and a connected account are one debt: both count, and the
 *   Lainat report names the pairs that may be (`maybeTwice` in `reports/loans.ts`).
 */
export function householdDebts(accounts: readonly DebtAccount[], inputs: UserInputs, day: IsoDate): HouseholdDebts {
  const typed = loansOf(inputs);
  const holders = new Map<string, Loan>();
  for (const loan of typed) {
    const accountId = loan.accountId ?? null;
    if (accountId !== null && !holders.has(accountId)) holders.set(accountId, loan);
  }
  const linked = new Set<Loan>();
  const connected: Loan[] = [];
  const sources: DebtSource[] = [];
  for (const account of accounts) {
    const told = DEBT_ACCOUNT_TYPES.includes(account.type) ? creditAccountLoan(account, day) : null;
    if (!told) continue;
    const holder = holders.get(account.id);
    if (holder && !linked.has(holder) && (account.balanceCents ?? 0) <= 0) {
      linked.add(holder);
      const pair = { ...holder, limitCents: holder.limitCents ?? told.limitCents };
      const stale = balanceDayOf(account.balanceAt, day) < holder.balanceDate;
      connected.push(stale ? pair : { ...pair, balanceCents: told.balanceCents, balanceDate: loanLastDueDate(holder, day) ?? holder.balanceDate });
      sources.push({ loanId: holder.id, accountId: account.id, linked: true, typed: holder });
    } else if (told.balanceCents > 0) {
      connected.push(told);
      sources.push({ loanId: told.id, accountId: account.id, linked: false, typed: null });
    }
  }
  const saved = typed.filter((loan) => !linked.has(loan));
  const loans = [...saved, ...connected];
  const interest = debtInterestNext12Months(loans, day);
  const out = new Set(interest.unknown.filter((u) => !u.counted).map((u) => u.loanId));
  const interestKnown = out.size === 0 || loans.some((loan) => !out.has(loan.id) && loanBalanceOn(loan, day).cents !== 0);
  return { day, saved, connected, sources, loans, total: debtTotalOn(loans, day), interest, interestKnown };
}

/**
 * The part of the debts the accounts' total does not hold, on a day at or before the debts' own: the saved loans
 * with no account behind them, each at its balance on that day. It is what the accounts less the debts take from the
 * accounts' total. `told` says whether an account has a balance in that total on the day. A linked pair is left out
 * where its account tells it, and counts as the saved loan was typed where the account tells nothing yet (a day
 * before the account's first known one): the debt is in every day once.
 */
export const debtOutsideAccountsOn = (debts: HouseholdDebts, day: IsoDate, told: (accountId: string) => boolean = () => true): DebtFigure =>
  debtTotalOn([...debts.saved, ...debts.sources.flatMap((s) => (s.typed !== null && !told(s.accountId) ? [s.typed] : []))], day);
