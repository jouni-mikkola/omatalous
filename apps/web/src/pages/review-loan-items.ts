import type { InferredLoanTerms, LoanKind, LoanTermsMissing } from "@banking/core";
import type { Base } from "./review-items.ts";

/**
 * One debt of Täydennä lainat, as the server tells it (services/review-loan-terms.ts): a saved loan that lacks a fact
 * (`loan`), a connected card with no rate (`card`), a loan its rows propose (`proposal`), an instalment plan whose end
 * nobody has said (`plan`), or a card whose bills the household pays and has not connected (`card_bill`).
 */
export interface LoanTermsDebt {
  id: string;
  source: "loan" | "card" | "proposal" | "plan" | "card_bill";
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
