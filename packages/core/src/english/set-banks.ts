/** The English table of set-banks; the Finnish one it must match is in ../messages-set-banks.ts. */
import type { FI_SET_BANKS } from "../messages-set-banks.ts";

export const EN_SET_BANKS: Record<keyof typeof FI_SET_BANKS, string> = {
  "set.banks.one_new_transaction": "{count} new transaction",
  "set.banks.n_new_transactions": "{count} new transactions",
  "set.banks.pick_title": "Choose a bank",
  "set.banks.pick_close": "Close",
  "set.banks.pick_none_admin": "The bank list of your Enable Banking application has no banks that Omatalous supports. Check the application under {link}.",
  "set.banks.pick_app_section": "Enable Banking application",
  "set.banks.pick_none_member": "The bank list of the Enable Banking application has no banks that Omatalous supports. The admin must check the application.",
  "set.banks.pick_search": "Search for a bank",
  "set.banks.pick_connect": "Connect {bank}",
  "set.banks.pick_opening": "Opening…",
  "set.banks.pick_last_used": "Last used",
  "set.banks.pick_no_match": "The search finds no bank.",
  "set.banks.pick_other_banks": "We sort the transactions of banks other than Nordea by the bank's own codes. Check the categories of the first month.",
};
