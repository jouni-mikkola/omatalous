/**
 * The fee of a transfer between two accounts of the household. The bank takes it out of the sending account, so the
 * receiving leg is smaller than the sending one and the two legs do not pair by their amounts. The legs are a transfer
 * and count nothing; the difference is money that left the household, so it is a bank fee.
 *
 * Decision: the household sees what its transfers cost as Pankkikulut, and Tulos agrees with the accounts.
 */
import { dayNumber } from "./dates.ts";
import { normalizeIban } from "./iban.ts";
import { PAIR_WINDOW_DAYS } from "./pairing.ts";
import type { Account, Transaction } from "./types.ts";

/** The most a transfer's fee may be: a bank's price for a transfer is cents, and a larger difference is some other money. */
export const MAX_TRANSFER_FEE_CENTS = 1000;

/**
 * The rows with the fee of every transfer between two accounts of the household split off: the sending leg keeps the
 * part the receiving leg got, and the fee is a row of its own in the category fees (its id is the leg's with `:fee`).
 * A leg pairs with the leg on the account it names, the other way round, within the pairing window. Legs of the same
 * amount pair first, so a fee is never found between two legs that match; a row the user decided and a row cut to a
 * part (a member's view of a joint account) are left alone.
 */
export function splitMemberFees(txs: readonly Transaction[], accounts: readonly Account[]): Transaction[] {
  const daily = accounts.filter((a) => a.type !== "credit_card" && a.type !== "loan");
  const ibanOf = new Map(daily.map((a) => [a.id, normalizeIban(a.iban)]));
  const accountOfIban = new Map(daily.flatMap((a): [string, Account][] => (normalizeIban(a.iban) ? [[normalizeIban(a.iban)!, a]] : [])));
  const partnerOf = (t: Transaction) => accountOfIban.get(normalizeIban(t.counterpartyIban) ?? "");
  const legs = txs
    .filter((t) => t.isTransfer && t.status === "booked" && t.categorySource !== "user" && t.wholeCents === undefined && !!ibanOf.get(t.accountId) && partnerOf(t) !== undefined && partnerOf(t)!.id !== t.accountId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const outs = legs.filter((t) => t.amountCents < 0);
  const ins = legs.filter((t) => t.amountCents > 0);
  const named = (out: Transaction, into: Transaction) =>
    partnerOf(out)?.id === into.accountId &&
    partnerOf(into)?.id === out.accountId &&
    out.currency === into.currency &&
    Math.abs(dayNumber(out.bookingDate) - dayNumber(into.bookingDate)) <= PAIR_WINDOW_DAYS;

  const used = new Set<string>();
  const exact = outs.filter((out) => {
    const mate = ins.find((into) => !used.has(into.id) && into.amountCents === -out.amountCents && named(out, into));
    if (mate) used.add(mate.id);
    return !mate;
  });
  const fees = new Map<string, { fee: number; sent: number }>();
  for (const out of exact) {
    const fits = ins
      .filter((into) => !used.has(into.id) && named(out, into) && into.amountCents < -out.amountCents && -out.amountCents - into.amountCents <= MAX_TRANSFER_FEE_CENTS)
      .sort((a, b) => b.amountCents - a.amountCents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const into = fits[0];
    if (!into) continue;
    used.add(into.id);
    fees.set(out.id, { fee: -out.amountCents - into.amountCents, sent: into.amountCents });
  }
  if (!fees.size) return [...txs];

  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  return txs.flatMap((t): Transaction[] => {
    const found = fees.get(t.id);
    if (!found) return [t];
    const fee: Transaction = { ...t, id: `${t.id}:fee`, amountCents: -found.fee, category: "fees", categorySource: "rule", isTransfer: false, counterparty: null, counterpartyIban: null, description: null, merchant: nameOf.get(t.accountId) ?? t.merchant };
    return [{ ...t, amountCents: -found.sent }, fee];
  });
}
