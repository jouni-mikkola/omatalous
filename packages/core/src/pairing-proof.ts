/**
 * What pairing reads of a leg besides its amount and day: a purchase's booking, and the holder names of the accounts.
 * No amounts are compared here; two legs are paired only in pairing.ts.
 */
import { hasTerminalShape } from "./industry.ts";
import { holdersIn, nameOf, samePerson } from "./person-names.ts";
import type { Account, Transaction } from "./types.ts";

type PurchaseRow = Pick<Transaction, "amountCents" | "category" | "categorySource"> & Partial<Pick<Transaction, "counterparty" | "description" | "mcc">>;

/**
 * Money out that the bank booked as a card purchase (a merchant code or a terminal's text) and no rule named: a
 * purchase the categoriser could not place. Pairing never takes it for the other leg of money in from a person. A bank's
 * transaction code decides nothing here: a card's settlement and money loaded with a card carry purchase codes too.
 */
export const isUnplacedCardPurchase = (t: PurchaseRow): boolean =>
  t.amountCents < 0 && t.categorySource === "default" && t.category === "other" && (!!t.mcc || hasTerminalShape({ counterparty: t.counterparty ?? null, description: t.description ?? null }));

/** The row names a holder of the account, by the holder line the bank gives (two words at least, either order). */
export function namesHolder(t: { counterparty?: string | null }, account: Pick<Account, "holder"> | undefined): boolean {
  if (!account || !t.counterparty?.trim()) return false;
  const name = nameOf(t.counterparty);
  return holdersIn(account.holder).some((holder) => samePerson(name, holder.name));
}
