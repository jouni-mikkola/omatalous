/**
 * Tarkistettavat's question of a saved loan whose payments cannot be placed: the member's own loan that still owes and
 * whose plan lacks one fact (core `loanTermsMissing`, from `planOf`). The loan's form answers it (PUT /api/loans/:id) and
 * the item goes when the plan resolves. "Älä muistuta tästä enää" is the mark `dismissed` on `subject`. The loan stakes
 * no money of the queue's order, so `cents` is 0 as the home loan question's is.
 */
import { loanTermsDismissed, loanTermsMissing, type LoanTermsMissing, loanTermsSubject } from "@banking/core";
import type { Services } from "./context.ts";

export interface LoanTermsItem {
  kind: "loan_terms";
  id: string;
  cents: number;
  loanId: string;
  name: string;
  /** What the loan owes, and the day that balance is of. */
  owedCents: number;
  balanceDate: string;
  missing: LoanTermsMissing;
  subject: string;
  /** The queue's own fields of every item: a loan has no rows. */
  rows?: { id: string; date: string; cents: number; name: string; text: string }[];
  rowCount?: number;
}

/** `listLoans` reads the member's own loans only, so another member's loan is never asked. */
export const loanTermsItems = async (s: Services, userId: string): Promise<LoanTermsItem[]> => {
  const repo = s.finance(userId);
  const [saved, marks] = await Promise.all([repo.listLoans(), repo.listMarks()]);
  return saved.flatMap((loan): LoanTermsItem[] => {
    const missing = loanTermsMissing(loan);
    if (missing === null || loanTermsDismissed(marks, loan.id)) return [];
    return [{ kind: "loan_terms", id: `loan_terms:${loan.id}`, cents: 0, loanId: loan.id, name: loan.name, owedCents: loan.balanceCents, balanceDate: loan.balanceDate, missing, subject: loanTermsSubject(loan.id) }];
  });
};
