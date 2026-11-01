/**
 * Whether Enable Banking has shown the app a bank yet. The setup checklist of the shared application ticks its last step,
 * "Tilit lisätty Enable Bankingiin", once a link or a fetch has seen something of some bank.
 */
import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { BankCapability } from "../../types.ts";

/** True once a link or a fetch has seen something of the bank: a bank list alone says nothing of the accounts. */
export function bankSeen(b: BankCapability): boolean {
  return b.cardAccounts || b.pending || b.balanceTypes.length > 0 || b.historyDays !== null;
}

/** True when some bank has been seen, read again when `reload` changes; false while nothing was read. */
export function useBankSeen(reload: unknown): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ banks: BankCapability[] }>("/api/admin/bank-app/capabilities")
      .then((r) => live && setSeen(r.banks.some(bankSeen)))
      .catch(() => live && setSeen(false));
    return () => {
      live = false;
    };
  }, [reload]);
  return seen;
}
