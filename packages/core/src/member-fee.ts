/**
 * The fee of a transfer between two accounts of the household. The bank takes it out of the sending account, so the
 * receiving leg is smaller than the sending one and the two legs do not pair by their amounts. The legs are a transfer
 * and count nothing; the difference is money that left the household, so it is a bank fee.
 *
 * Decision: the household sees what its transfers cost as Pankkikulut, and Tulos agrees with the accounts.
 */
import { memberFeeAllocations } from "./pairing.ts";
import type { Account, Transaction } from "./types.ts";

/**
 * The rows with the fee of every transfer between two accounts of the household split off: the sending leg keeps the
 * part the receiving leg got, and the fee is a row of its own in the category fees (its id is the leg's with `:fee`).
 * Which legs are a pair is `memberFeeAllocations`'s to say (pairing.ts).
 */
export function splitMemberFees(txs: readonly Transaction[], accounts: readonly Account[]): Transaction[] {
  const pairs = memberFeeAllocations(txs.filter((t) => t.isTransfer && t.status === "booked"), accounts);
  if (!pairs.size) return [...txs];
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  return txs.flatMap((t): Transaction[] => {
    const pair = t.amountCents < 0 ? pairs.get(t.id)?.[0] : undefined;
    if (!pair) return [t];
    const fee: Transaction = { ...t, id: `${t.id}:fee`, amountCents: pair.partnerCents - pair.cents, category: "fees", categorySource: "rule", isTransfer: false, counterparty: null, counterpartyIban: null, description: null, merchant: accountName.get(t.accountId) ?? t.merchant };
    return [{ ...t, amountCents: -pair.partnerCents }, fee];
  });
}
