import { type CategoryKind, getCategory } from "../categories.ts";
import type { Transaction } from "../types.ts";

/**
 * What one transaction contributes to each money flow, in positive cents
 * ("more of this"). A refund makes `consumption` negative, money taken out
 * of savings makes `saved` negative.
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
      return { ...ZERO, income: t.amountCents };
    case "transfer":
      return t.category === "credit_draw" ? { ...ZERO, borrowed: t.amountCents } : ZERO;
  }
}

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
  /** income − expenses − saved: what stayed on the accounts. Negative when the accounts were drawn on. */
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
  for (const f of flows) {
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
    leftCents: income - expense - saved,
    savingsRate: income > 0 ? saved / income : null,
  };
}
