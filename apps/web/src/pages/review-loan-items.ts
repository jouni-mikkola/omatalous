import type { LoanTermsMissing } from "@banking/core";
import type { Base } from "./review-items.ts";

/**
 * A debt whose payments cannot be placed for want of one fact (`missing`): a saved loan (`loanId`), answered by its form,
 * or a connected card no saved loan is linked to (`accountId`), answered by the form of a loan linked to the card. Älä
 * muistuta tästä enää is the mark on `subject`.
 */
export interface LoanTermsItem extends Base {
  kind: "loan_terms";
  loanId: string | null;
  accountId: string | null;
  name: string;
  owedCents: number;
  balanceDate: string;
  missing: LoanTermsMissing;
  subject: string;
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
