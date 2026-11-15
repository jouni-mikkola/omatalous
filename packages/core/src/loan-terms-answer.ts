/**
 * The question of Tarkistettavat about a saved loan whose payments cannot be placed: which fact the loan lacks, and the
 * mark that sets the question aside. The loan's own form is the answer that settles it; the mark `dismissed` only puts
 * the question away, one subject per loan: `question:loan-terms:<loan id>`.
 */
import { planOf } from "./loan-plan.ts";
import { isRevolving, type Loan, type UserMark } from "./types.ts";

/** The facts of a plan a loan can lack, named as the loan form names its fields. */
export type LoanTermsMissing = "repayment" | "interval" | "payment" | "rate" | "end_date";

/**
 * The one fact a loan still owing lacks before its payments can be placed, null when none is lacking. A card or a credit
 * line has no plan to ask for, and a loan with nothing owed needs none.
 */
export function loanTermsMissing(loan: Loan): LoanTermsMissing | null {
  if (isRevolving(loan.kind) || loan.balanceCents <= 0) return null;
  const plan = planOf(loan);
  if (!("missing" in plan)) return null;
  const { missing } = plan;
  return missing === "repayment" || missing === "interval" || missing === "payment" || missing === "rate" || missing === "end_date" ? missing : null;
}

const LOAN_TERMS = "question:loan-terms:";
const SUBJECT = /^question:loan-terms:([^:,\p{Cc}]{1,64})$/u;

/** The subject of the dismissal for one saved loan. */
export const loanTermsSubject = (loanId: string): string => `${LOAN_TERMS}${loanId}`;

/** The loan id a dismissal subject names, or null for any other subject. */
export const parseLoanTermsSubject = (subject: string): string | null => SUBJECT.exec(subject)?.[1] ?? null;

/** Whether the loan's question is set aside. */
export const loanTermsDismissed = (marks: readonly Pick<UserMark, "subject" | "mark">[], loanId: string): boolean => marks.some((m) => m.mark === "dismissed" && m.subject === loanTermsSubject(loanId));
