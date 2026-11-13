/**
 * The mark that says a loan proposal is no loan (`loan-proposal:<key>`, see loan-detect.ts). Kept apart from the
 * detection, which the web entry would otherwise load whole for the one function the page's own code calls.
 */
import type { LoanProposal } from "./loan-detect.ts";
import type { UserMark } from "./types.ts";

export const NOT_LOAN_SUBJECT = "loan-proposal:";

/** The mark that says a proposal is no loan: the series stays out of `loanProposals` until the mark is taken away. */
export function notLoanMark(proposal: Pick<LoanProposal, "key">): Pick<UserMark, "subject" | "mark"> {
  return { subject: NOT_LOAN_SUBJECT + proposal.key, mark: "dismissed" };
}
