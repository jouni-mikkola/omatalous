/** The English table of set-fr; the Finnish one it must match is in ../messages-set-fr.ts. */
import type { FI_SET_FR } from "../messages-set-fr.ts";

export const EN_SET_FR: Record<keyof typeof FI_SET_FR, string> = {
  "set.fr.currency_unknown": "currency unknown",
  "set.fr.newest_transaction": "Newest transaction",
  "set.fr.newest_count_transactions": "Newest {count} transactions",
  "set.fr.one_transaction": "1 transaction",
  "set.fr.n_transactions": "{count} transactions",
  "set.fr.total": "total",
  "set.fr.not_in_euro_totals": "not included in the euro amounts",
};
