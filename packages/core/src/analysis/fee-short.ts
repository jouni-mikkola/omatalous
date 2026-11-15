import { billCents } from "../account-use.ts";
import { feeOfPairs } from "../pairing-fee.ts";
import { transferAllocations } from "../pairing.ts";
import type { Account, Transaction } from "../types.ts";

/**
 * The bank fee of a payment between two accounts of the view that arrived short, by the id of the payment. The legs the
 * view holds as transfers are paired again, so a fee shows only where both legs are in the view: a view with one leg
 * has none, and the leg counts as it does without a pair. A row cut to a part of the bank's amount (a joint account's)
 * is left out: its cents are a share, and a share of two legs can differ by a rounded cent that is no fee. Derived on
 * every run, stored nowhere (ADR 0015).
 */
export function shortFees(transactions: readonly Transaction[], accounts: readonly Account[]): Map<string, number> {
  if (accounts.length < 2) return new Map();
  const legs = transactions.filter((t) => t.isTransfer && t.status === "booked" && t.categorySource !== "user" && billCents(t) === t.amountCents).map((t) => ({ ...t, categorySource: "default" as const }));
  return legs.length < 2 ? new Map() : feeOfPairs(legs, transferAllocations(legs, accounts).allocations);
}
