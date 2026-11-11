/**
 * The names a loan goes by: the part of the bank dialect (ADR 0008) that tells the kind of a loan. The words of bank
 * rows are in wording.ts.
 */
import type { LoanKind } from "./types.ts";
import { fold } from "./merchant.ts";
import { alternation } from "./wordlists.ts";
import { isCarFinanceText, words } from "./wording.ts";

/**
 * A home loan and a student loan by their own names, as regex alternations. One list for both readers: the mortgage and
 * student-loan rules of categorize.ts, and `loanKindOfName` for the kind of a loan account.
 */
export const HOME_LOAN_WORDS = alternation("HOME_LOAN_WORDS");
export const STUDENT_LOAN_WORDS = alternation("STUDENT_LOAN_WORDS");

const HOME_LOAN = words(HOME_LOAN_WORDS);
const STUDENT_LOAN = words(STUDENT_LOAN_WORDS);
/**
 * The kind a loan account's name tells (any case), by the words the proposal of a loan from the payments reads (`loan-detect.ts`):
 * a home loan, a student loan, a car loan. "other" where the name says nothing: an account of type loan is never a
 * card or a credit line, whatever its name.
 */
export const loanKindOfName = (name: string): LoanKind => {
  const folded = fold(name);
  return HOME_LOAN.test(folded) ? "mortgage" : STUDENT_LOAN.test(folded) ? "student" : isCarFinanceText(folded) ? "car" : "other";
};
