/** The English table of set-loans; the Finnish one it must match is in ../messages-set-loans.ts. */
import type { FI_SET_LOANS } from "../messages-set-loans.ts";

export const EN_SET_LOANS: Record<keyof typeof FI_SET_LOANS, string> = {
  "set.loans.edit_loan": "Edit loan",
  "set.loans.cancel": "Cancel",
  "set.loans.the_loan_can_no_longer": "The loan can no longer be found.",
  "set.loans.loan_removed": "Loan removed.",
  "set.loans.loans": "Loans",
  "set.loans.loan": "Loan",
  "set.loans.linked_to_account_name": "Linked to account {name}",
  "set.loans.lender": "Lender",
  "set.loans.remaining": "Remaining",
  "set.loans.rate": "Rate",
  "set.loans.payment": "Payment",
  "set.loans.last_due_date": "Last due date",
  "set.loans.actions": "Actions",
  "set.loans.edit_loan_name": "Edit loan {name}",
  "set.loans.edit": "Edit",
  "set.loans.remove_loan_name": "Remove loan {name}",
  "set.loans.remove": "Remove",
  "set.loans.no_loans": "No loans.",
  "set.loans.remove_name": "Remove {name}?",
  "set.loans.remove_loan": "Remove loan",
  "set.loans.the_loan_is_removed_from": "The loan is removed from the figures. Transactions stay as they are.",
  "set.loans.plus_interest": " + interest",
  "set.loans.recorded": "recorded {date}",
};
