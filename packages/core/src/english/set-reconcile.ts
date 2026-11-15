/** The English table of set-reconcile; the Finnish one it must match is in ../messages-set-reconcile.ts. */
import type { FI_SET_RECONCILE } from "../messages-set-reconcile.ts";

export const EN_SET_RECONCILE: Record<keyof typeof FI_SET_RECONCILE, string> = {
  "set.rec.only_the_available_balance": "only the available balance",
  "set.rec.the_bank_has_not_given": "the bank has not given a balance for this day",
  "set.rec.the_type_changed": "the type changed",
  "set.rec.too_few_balances": "too few balances",
  "set.rec.the_transactions_start_later": "the transactions start later",
  "set.rec.some_of_the_transactions_are": "some of the transactions are in another currency",
  "set.rec.there_are_too_few_balances": "there are too few balances",
  "set.rec.the_bank_gives_only_the": "the bank gives only the available balance",
  "set.rec.the_type_of_the_balance": "the type of the balance changed",
  "set.rec.matches": "matches",
  "set.rec.does_not_match": "does not match",
  "set.rec.matches_the_bank_s_balance": "Matches the bank's balance",
  "set.rec.does_not_match_the_bank": "Does not match the bank's balance",
  "set.rec.there_is_not_enough_data": "there is not enough data yet",
  "set.rec.day_one": "{count} day",
  "set.rec.day_many": "{count} days",
  "set.rec.difference": "difference {amount}",
};
