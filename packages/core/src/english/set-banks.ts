/** The English table of set-banks; the Finnish one it must match is in ../messages-set-banks.ts. */
import type { FI_SET_BANKS } from "../messages-set-banks.ts";

export const EN_SET_BANKS: Record<keyof typeof FI_SET_BANKS, string> = {
  "set.banks.one_new_transaction": "{count} new transaction",
  "set.banks.n_new_transactions": "{count} new transactions",
};
