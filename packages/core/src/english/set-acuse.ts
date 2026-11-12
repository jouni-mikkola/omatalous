/** The English table of set-acuse; the Finnish one it must match is in ../messages-set-acuse.ts. */
import type { FI_SET_ACUSE } from "../messages-set-acuse.ts";

export const EN_SET_ACUSE: Record<keyof typeof FI_SET_ACUSE, string> = {
  "set.acuse.me": "Me",
  "set.acuse.saved": "Saved.",
  "set.acuse.reset_to_the_bank_s": "Reset to the bank's data",
  "set.acuse.by_who_has_paid_into": "By who has paid into the account",
  "set.acuse.save": "Save",
  "set.acuse.answers": "Answers",
  "set.acuse.share_account": "Share account",
  "set.acuse.account_users": "Account users",
  "set.acuse.the_users_inferred_from_the": "The users inferred from the bank's data are selected.",
  "set.acuse.saving": "Saving…",
  "set.acuse.user_of_account": "User of account {name}",
  "set.acuse.paid_into_account": "Paid into the account",
  "set.acuse.use_this": "Use this",
  "set.acuse.remove_answer": "Remove: {label}",
  "set.acuse.remove": "Remove",
  "set.acuse.cannot_see_account": "{name} cannot see this account, so the share does not appear in their figures.",
  "set.acuse.user": "User",
};
