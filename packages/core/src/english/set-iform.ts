/** The English table of set-iform; the Finnish one it must match is in ../messages-set-iform.ts. */
import type { FI_SET_IFORM } from "../messages-set-iform.ts";

export const EN_SET_IFORM: Record<keyof typeof FI_SET_IFORM, string> = {
  "set.iform.at_times": "at {times}",
  "set.iform.no_set_times": "no set times",
  "set.iform.enter_the_address_like_https": "Enter the address like https://talous.oma.fi (without a path).",
  "set.iform.enter_the_address": "Enter the address.",
  "set.iform.the_address_is_not_encrypted": "The address is not encrypted (http). If the app can be reached from outside the home network, use an https address.",
  "set.iform.no_automatic_fetches": "No automatic fetches",
  "set.iform.saving": "Saving…",
  "set.iform.saved": "Saved.",
  "set.iform.app_address": "App address",
  "set.iform.fetches_per_day": "Fetches per day",
  "set.iform.fetch_is_made": "The fetch is made {when}.",
  "set.iform.fetched_when_opened": "Transactions are fetched when you open the app.",
  "set.iform.look_up_industry": "Look up the industry of an unknown merchant in the trade register",
  "set.iform.only_the_merchant_name": "Only the merchant's name is sent to the register.",
};
