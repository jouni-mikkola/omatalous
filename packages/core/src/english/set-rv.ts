/** The English table of set-rv; the Finnish one it must match is in ../messages-set-rv.ts. */
import type { FI_SET_RV } from "../messages-set-rv.ts";

export const EN_SET_RV: Record<keyof typeof FI_SET_RV, string> = {
  "set.rv.this_batch_of_questions_is": "This batch of questions is done",
  "set.rv.the_rest_are_waiting": "The rest are waiting",
  "set.rv.nothing_to_review_yet": "Nothing to review yet",
  "set.rv.questions_appear_here_once_a": "Questions appear here once a bank is connected and transactions are fetched. The app asks only what it cannot work out itself.",
  "set.rv.nothing_to_ask": "Nothing to ask",
  "set.rv.new_questions_come_when_the": "New questions come when the bank sends transactions the app cannot read.",
  "set.rv.go_to_summary": "Go to summary",
  "set.rv.latest_transactions_name": "Latest transactions: {name}",
  "set.rv.the_answer_also_covers_earlier": "The answer also covers earlier months, but not payments that differ clearly from the usual.",
  "set.rv.do_not_ask_about_this": "Do not ask about this again",
  "set.rv.skip_ask_later": "Skip",
  "set.rv.newest_of": "The newest {shown} of {total} transactions",
  "set.rv.connect_bank": "Connect a bank",
  "set.rv.hide_rows": "Hide transactions: {name}",
  "set.rv.show_rows": "Show transactions: {name}",
};
