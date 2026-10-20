import { type CategoryKind, getCategory } from "../categories.ts";
import type { Transaction } from "../types.ts";

/**
 * What one transaction contributes to each money flow, in positive cents
 * ("more of this"). A refund makes `consumption` negative, money taken out
 * of savings makes `saved` negative. Which money in on a spending category
 * is a refund the row alone does not tell: the context asks `moneyIn`, and
 * what is no refund counts as income (`incomeOf`).
 */
export interface Flows {
  /** Spending on goods and services. */
  consumption: number;
  /** Loan repayments, financing, interest. */
  debt: number;
  /** Money set aside: savings categories + transfers into own savings accounts. */
  saved: number;
  income: number;
  /** Credit drawn (Gold "luoton siirto", loan payouts). Cash in, but not income. */
  borrowed: number;
}

const ZERO: Flows = { consumption: 0, debt: 0, saved: 0, income: 0, borrowed: 0 };

/** Money in that is income whatever category the row was put in. */
export const incomeOf = (cents: number): Flows => ({ ...ZERO, income: cents });

export type FlowInput = Pick<Transaction, "accountId" | "amountCents" | "category" | "isTransfer">;

export function flowsOf(t: FlowInput, savingsAccountIds: ReadonlySet<string>, loanAccountIds: ReadonlySet<string> = new Set()): Flows {
  // a loan account's own rows (repayments received, interest booked) mirror payments already counted from checking
  if (loanAccountIds.has(t.accountId)) return ZERO;
  if (t.isTransfer) {
    // a transfer is neutral, except that money landing on a savings account is saved
    return savingsAccountIds.has(t.accountId) ? { ...ZERO, saved: t.amountCents } : ZERO;
  }
  const kind: CategoryKind = getCategory(t.category).kind;
  switch (kind) {
    case "expense":
      return { ...ZERO, consumption: -t.amountCents };
    case "debt":
      return { ...ZERO, debt: -t.amountCents };
    case "savings":
      return { ...ZERO, saved: -t.amountCents };
    case "income":
      return incomeOf(t.amountCents);
    case "transfer":
      return t.category === "credit_draw" ? { ...ZERO, borrowed: t.amountCents } : ZERO;
  }
}

/** Yli jäi of one row: what it adds to income + borrowed − expenses − saved. The sum over rows is `PeriodTotals.leftCents`. */
export const leftOf = (f: Flows): number => f.income + f.borrowed - f.consumption - f.debt - f.saved;

export interface PeriodTotals {
  incomeCents: number;
  consumptionCents: number;
  debtCents: number;
  /** consumption + debt: everything that left for good. */
  expenseCents: number;
  savedCents: number;
  borrowedCents: number;
  /** income − expenses: what was left over (part of it may sit in savings). */
  netCents: number;
  /**
   * Yli jäi: income + borrowed − expenses − saved, what stayed on the accounts (ADR 0014). Negative when the accounts
   * were drawn on. Credit drawn is money in the account without being income, so it is in this sum and in no other.
   */
  leftCents: number;
  /** saved / income, null when there was no income. Negative when savings were drawn on. */
  savingsRate: number | null;
}

export function totalsOf(flows: Iterable<Flows>): PeriodTotals {
  let consumption = 0;
  let debt = 0;
  let saved = 0;
  let income = 0;
  let borrowed = 0;
  let left = 0;
  for (const f of flows) {
    left += leftOf(f);
    consumption += f.consumption;
    debt += f.debt;
    saved += f.saved;
    income += f.income;
    borrowed += f.borrowed;
  }
  const expense = consumption + debt;
  return {
    incomeCents: income,
    consumptionCents: consumption,
    debtCents: debt,
    expenseCents: expense,
    savedCents: saved,
    borrowedCents: borrowed,
    netCents: income - expense,
    leftCents: left,
    savingsRate: income > 0 ? saved / income : null,
  };
}

/**
 * How a period that took more than its income was paid for (ADR 0014). With `PeriodTotals` it is one sum:
 * income + creditDrawn + savingsDrawn + accounts = needed + what stayed (`leftCents` above zero).
 */
export interface GapCover {
  /** What the period took: consumption, debt service, money set aside and `creditRepaidCents`. */
  neededCents: number;
  /** `neededCents` above the income, never below zero. The three figures under it add up to it. */
  gapCents: number;
  /** Katettu luotolla: the gap paid with credit drawn in the period, at most the credit drawn. */
  creditCents: number;
  /** Katettu säästöistä: the gap paid with money taken out of savings, at most what was taken out. */
  savingsCents: number;
  /**
   * Tileiltä tai kortilta: the rest of the gap, and how far `leftCents` is below zero. The accounts and the connected
   * cards fell by it together: money that was on an account went, or more is owed on a card. `PeriodTotals` cannot
   * tell the two apart, so no view may say that money on an account paid.
   */
  accountsCents: number;
  /** Credit drawn in the period, never negative. */
  creditDrawnCents: number;
  /** What `creditCents` leaves of the credit drawn: it covered no gap and stayed on the accounts. */
  creditLeftCents: number;
  /** Money taken out of savings, never negative. */
  savingsDrawnCents: number;
  /** What `savingsCents` leaves of the savings drawn: it covered no gap and stayed on the accounts. */
  savingsLeftCents: number;
  /** Money out under Luotonnostot, which only a category set by hand gives: credit paid back. */
  creditRepaidCents: number;
}

/**
 * Money has no label, so the order is a rule: income pays first, then credit, then savings, then the accounts and the
 * cards. Credit goes before savings so that a month paid with both never shows less borrowing than there was. The
 * remainders of the drawn money are worked out here, so a view never subtracts.
 */
export function coverOf(t: Pick<PeriodTotals, "incomeCents" | "consumptionCents" | "debtCents" | "savedCents" | "borrowedCents">): GapCover {
  const creditDrawn = Math.max(0, t.borrowedCents);
  const creditRepaid = Math.max(0, -t.borrowedCents);
  const savingsDrawn = Math.max(0, -t.savedCents);
  const needed = t.consumptionCents + t.debtCents + Math.max(0, t.savedCents) + creditRepaid;
  const gap = Math.max(0, needed - t.incomeCents);
  const credit = Math.min(gap, creditDrawn);
  const savings = Math.min(gap - credit, savingsDrawn);
  return {
    neededCents: needed,
    gapCents: gap,
    creditCents: credit,
    savingsCents: savings,
    accountsCents: gap - credit - savings,
    creditDrawnCents: creditDrawn,
    creditLeftCents: creditDrawn - credit,
    savingsDrawnCents: savingsDrawn,
    savingsLeftCents: savingsDrawn - savings,
    creditRepaidCents: creditRepaid,
  };
}
