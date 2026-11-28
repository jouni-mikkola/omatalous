import type { InferredLoanTerms, LoanKind, LoanTermsMissing } from "@banking/core";
import { t } from "../text.ts";
import type { Base } from "./review-items.ts";

/**
 * One debt of Täydennä lainat, as the server tells it (services/review-loan-terms.ts): a saved loan that lacks a fact
 * (`loan`), a connected card with no rate (`card`), a loan its rows propose (`proposal`), an instalment plan whose end
 * nobody has said (`plan`), a card whose bills the household pays and has not connected (`card_bill`), or a card whose
 * purchases are missing (`card_gap`), or payments to a lender that stopped inside the twelve months and may be a
 * credit that is paid off or still owed (`ended`).
 */
export interface LoanTermsDebt {
  id: string;
  source: "loan" | "card" | "proposal" | "plan" | "card_bill" | "card_gap" | "ended";
  name: string;
  /** The saved loan, null for none. */
  loanId: string | null;
  /** The connected card, null for none. */
  accountId: string | null;
  /** The series a loan saved from the rows is linked by, null for a saved loan or a connected card. */
  key: string | null;
  kind: LoanKind;
  /** Whether the kind is known; one the rows only suggest is asked. */
  placed: boolean;
  /** A credit whose kind the rows do not tell: the row asks card, credit line or consumer credit, with no guess. */
  kindUnknown?: true;
  /** A month of payments, null when the rows tell no monthly payment. */
  monthlyCents: number | null;
  /** The latest payment as the bank took it, null when the rows tell no monthly one. */
  latestCents: number | null;
  /** The day of the latest payment the rows show. */
  lastDate: string | null;
  /** What the debt owes and the day that balance is of, null while it is not known. */
  owedCents: number | null;
  balanceDate: string | null;
  /** The facts a saved loan or a connected card lacks. */
  gaps: LoanTermsMissing[];
  /** The mark "Älä muistuta tästä enää" goes on, for a saved loan. */
  subject: string | null;
  terms: InferredLoanTerms | null;
  /** The loans saved with no link that the debt may be: card loans for a card that is not connected, card, credit line and consumer credit loans for a credit of unknown kind. */
  savedCards: { id: string; name: string }[];
  /** A card whose purchases are missing: the sum of its bills that pay them (null: none) and the day a connected card's rows begin (null: before the twelve months). */
  missing?: { cents: number | null; since: string | null };
}

/**
 * Täydennä lainat: every debt that lacks a balance, a rate or a payment, one row each, the largest payments first.
 * `debtsCents` is what the household owes as the first page tells it, null while a debt's balance is unknown, and
 * `noBalance` how many debts of the list have none.
 */
export interface LoanTermsListItem extends Base {
  kind: "loan_terms_list";
  debts: LoanTermsDebt[];
  debtsCents: number | null;
  noBalance: number;
  /** How many debts waiting in all are filled from rows: with more than one, no form takes a connected loan account by itself. */
  fromRows: number;
}

/**
 * A payment of a saved loan that its plan did not expect: the bank took `paidCents` where the plan said `expectedCents`.
 * The loan's form opens with `newPaymentCents` and, for a loan on a reference rate, `reviewDate` filled in; saving the
 * loan answers it.
 */
export interface LoanDriftItem extends Base {
  kind: "loan_drift";
  loanId: string;
  name: string;
  date: string;
  paidCents: number;
  expectedCents: number;
  newPaymentCents: number;
  reviewDate: string | null;
}

/**
 * The item that asks the balances of two or more loans the rows show in one form (services/review-loan-terms.ts); every
 * other list item asks one debt.
 */
export const isBalancesItem = (item: { kind: string; id: string }): boolean => item.kind === "loan_terms_list" && item.id === "loan-terms:balances";

/** What the answer to a debt's question gives: the question's heading. A list with no debt (none is sent) says the old heading. */
export function loanGain(debt: LoanTermsDebt | undefined): string {
  if (!debt) return t("set.ri.complete_the_loans");
  switch (debt.source) {
    case "proposal":
      return t("set.ri.gain_loan_balance");
    case "ended":
      return t("set.ri.gain_credit_ended");
    case "plan":
      return t("set.ri.gain_plan_end");
    case "card_bill":
    case "card_gap":
      return t("set.ri.gain_card_debt");
    case "loan":
      return debt.gaps.includes("rate") ? t("set.ri.gain_loan_rate") : t("set.ri.gain_loan_terms");
    case "card":
      return debt.gaps.includes("rate") ? t("set.ri.gain_card_rate") : t("set.ri.gain_loan_terms");
  }
}
