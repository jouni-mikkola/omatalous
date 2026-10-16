/**
 * A connected card's payment channel: the payee the household pays that card's bill to from another account. Nothing
 * in such a payment need say "card" (the payee is the bank, the text a reference number), so the channel is learned
 * from the payments that paired with the card's incoming rows. It is worked out on every run and stored nowhere.
 */
import type { WhyCollector } from "./explain/types.ts";
import { type Holders, holdersOf, isUserName } from "./categorize-people.ts";
import { dayNumber } from "./dates.ts";
import { fold, UNKNOWN_MERCHANT } from "./merchant.ts";
import { billsByIssuer, namesCard, normalizeIban, pairable, pairTransfers } from "./transfers.ts";
import type { Account, Transaction } from "./types.ts";
import { isCardIssuerText, isPersonShaped } from "./wording.ts";
import { isLenderShapedName } from "./wording-lenders.ts";

/** A row with the payment's reference number. A stored row has one; the core `Transaction` does not name it. */
type Referenced = Transaction & { reference?: string | null };

/** A card bill pays the purchases of the month before it: a card whose rows began more than this long before a payment holds them. */
const BILLING_MONTH_DAYS = 31;

/** A payment's reference as one token, or "": the spaces a bank groups it with and leading zeros tell nothing apart. */
export function referenceOf(t: Transaction): string {
  return ((t as Referenced).reference ?? "").replace(/\s+/g, "").replace(/^0+/, "").toUpperCase();
}

/**
 * Whom a payment pays, as closely as the row says: the payee's account and the reference, and with no account the
 * payee's name and the reference. A name alone is no key: a bank's name stands on its loans and fees too.
 */
function payeeKey(t: Transaction): string | null {
  const iban = normalizeIban(t.counterpartyIban);
  const reference = referenceOf(t);
  if (iban) return `${iban}|${reference}`;
  const name = fold(t.counterparty ?? "").trim();
  return name && reference ? `${name}|${reference}` : null;
}

/**
 * One pair is enough when the payee is a card issuer, or names this card's bank and is not shaped like a person.
 * Any other payee needs two pairs, because an equal amount within a few days happens once by chance: money sent to a
 * person on the day another bank's payment reached the card, or a shop's invoice of the same sum. A card named after
 * its holder would otherwise make that person a channel.
 */
function teachesAlone(payee: string, card: Account): boolean {
  return isCardIssuerText(payee) || (!isPersonShaped(payee) && namesCard(payee, card));
}

/**
 * The rows whose amount was paid fewer than three times. In a loan's series the instalment repeats, so these are the
 * extra payments and the instalments that changed.
 */
export function varyingRows<T extends { amountCents: number }>(rows: readonly T[]): T[] {
  const counts = new Map<number, number>();
  for (const t of rows) counts.set(t.amountCents, (counts.get(t.amountCents) ?? 0) + 1);
  return rows.filter((t) => counts.get(t.amountCents)! < 3);
}

/** Whether payments are one loan's instalments: an amount paid three times or more makes up at least half of them. */
export function isInstalments(rows: readonly { amountCents: number }[]): boolean {
  return varyingRows(rows).length * 2 <= rows.length;
}

/**
 * Credit paid out to the household, which makes its payer a lender: the payer is named, the row is no leg of an own
 * transfer (`leg`; after transfer detection the row says so itself) and the payer is no person. A person's payout (a
 * card's credit moved to the own account under the holder's name, an advance from a friend) makes nobody a lender: the
 * payer of such money moved it. The one test of it: the issuer fallback below, a lender's other payments
 * (categorize-bank-rows.ts) and the run over one merchant's rows (pipeline.ts) all ask here.
 */
export function isLenderPayout(t: Transaction, holders: Holders, leg: boolean = t.isTransfer): boolean {
  if (t.category !== "credit_draw" || t.amountCents <= 0 || leg || t.merchant === UNKNOWN_MERCHANT) return false;
  const name = fold(t.counterparty ?? "").trim();
  return !name || isLenderShapedName(name) || !(isUserName(name, holders) || isPersonShaped(name));
}

/**
 * Each known channel: the payee key of the payments that paired with a card's incoming rows, and the accounts of the
 * cards it taught. Each card is taught on its own (two pairs, or one that teaches alone): a card that replaced another
 * is paid through the old one's key.
 * A key whose payments are a loan's teaches nothing, whatever paired: an instalment equals a card payment once by
 * chance, and a card paid one fixed sum every month is told from a loan by nothing but the pairs, so it stays unlearned.
 */
function cardChannels(txs: readonly Transaction[], accounts: readonly Account[], pairs: ReadonlyMap<string, string>): Map<string, string[]> {
  const channels = new Map<string, string[]>();
  const cards = new Map(accounts.filter((a) => a.type === "credit_card").map((a) => [a.id, a]));
  if (!cards.size || !pairs.size) return channels;
  const byId = new Map<string, Transaction>();
  const incoming = new Set(pairs.values());
  for (const t of txs) if (pairs.has(t.id) || incoming.has(t.id)) byId.set(t.id, t);
  const seen = new Map<string, { payee: string; byCard: Map<string, number>; payments: Transaction[] }>();
  for (const [outId, inId] of pairs) {
    const out = byId.get(outId)!;
    const cardId = byId.get(inId)!.accountId;
    const key = cards.has(cardId) && !cards.has(out.accountId) ? payeeKey(out) : null;
    if (!key) continue;
    let entry = seen.get(key);
    if (!entry) seen.set(key, (entry = { payee: fold(out.counterparty ?? ""), byCard: new Map(), payments: [] }));
    entry.byCard.set(cardId, (entry.byCard.get(cardId) ?? 0) + 1);
  }
  // all of a key's payments, paired or not
  for (const t of txs) {
    if (t.amountCents >= 0 || cards.has(t.accountId)) continue;
    const key = payeeKey(t);
    if (key) seen.get(key)?.payments.push(t);
  }
  for (const [key, { payee, byCard, payments }] of seen) {
    if (isInstalments(payments)) continue;
    const taught = [...byCard].filter(([cardId, count]) => count >= 2 || teachesAlone(payee, cards.get(cardId)!)).map(([cardId]) => cardId);
    if (taught.length) channels.set(key, taught);
  }
  return channels;
}

/**
 * Transfer detection for one user's own history: the pairs, what they teach about each card's channel, and the issuer
 * fallback bounded by it.
 *
 * A payment to a known channel that paired with nothing is a transfer when the card's own rows cover the time it pays
 * for, since those purchases are counted from the card's rows. An earlier one is a card bill (`cardBills`): the
 * purchases are not in the data, so the bill is the spending. A channel of several cards pays the one whose rows began
 * last before the payment: a new card's first bill pays purchases that are in no data, whatever the old card's rows
 * hold. Only rows that could have paired are decided, so a category the user set, a purchase and a return stay as
 * they are.
 *
 * The issuer fallback spares a lender's contract: the payments to the payee key (`payeeKey`) that paid credit out, as
 * a flexible credit repaid in varying sums is. The key and not the name: a card's own credit moved to the account
 * names the issuer too, and that card's bills are counted from its rows.
 */
export function settleTransfers(txs: readonly Transaction[], accounts: readonly Account[], exclude: ReadonlySet<string>, why?: WhyCollector): { transfers: Set<string>; cardBills: Set<string> } {
  const { transfers, pairs } = pairTransfers(txs, accounts, exclude);
  // what pairing alone decided: an own account's IBAN or a pair. What the channels and the issuer add is a card's payment.
  const own = why ? new Set(transfers) : null;
  const cardBills = new Set<string>();
  const channels = cardChannels(txs, accounts, pairs);
  const channelled = new Set([...channels.values()].flat());
  if (channels.size) {
    const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
    const began = new Map<string, number>();
    for (const t of txs) {
      if (!channelled.has(t.accountId)) continue;
      const day = dayNumber(t.bookingDate);
      if (day < (began.get(t.accountId) ?? Number.POSITIVE_INFINITY)) began.set(t.accountId, day);
    }
    for (const t of txs) {
      if (t.amountCents >= 0 || transfers.has(t.id) || exclude.has(t.id) || !pairable(t)) continue;
      const type = typeOf.get(t.accountId);
      if (type === "credit_card" || type === "loan") continue;
      const key = payeeKey(t);
      const paid = key ? channels.get(key) : undefined;
      if (!paid) continue;
      const day = dayNumber(t.bookingDate);
      const starts = paid.map((card) => began.get(card)!);
      const earlier = starts.filter((start) => start <= day);
      if (day - (earlier.length ? Math.max(...earlier) : Math.min(...starts)) > BILLING_MONTH_DAYS) transfers.add(t.id);
      else {
        cardBills.add(t.id);
        // the card whose rows began last before the payment, as the line above counts it
        if (why) why.add(t.id, { rule: "card.bill", card: paid.find((card) => began.get(card) === (earlier.length ? Math.max(...earlier) : Math.min(...starts))) ?? paid[0]! });
      }
    }
  }
  const holders = holdersOf(accounts);
  const lent = new Set<string>();
  for (const t of txs) {
    const key = isLenderPayout(t, holders, transfers.has(t.id)) ? payeeKey(t) : null;
    if (key) lent.add(key);
  }
  const decided = new Set([...exclude, ...cardBills]);
  if (lent.size) for (const t of txs) if (t.amountCents < 0 && lent.has(payeeKey(t) ?? "")) decided.add(t.id);
  for (const id of billsByIssuer(txs, accounts, transfers, { exclude: decided, channelled })) transfers.add(id);
  if (why) {
    const other = new Map<string, string>();
    for (const [out, into] of pairs) {
      other.set(out, into);
      other.set(into, out);
    }
    for (const id of transfers) why.add(id, !own!.has(id) ? { rule: "transfer.channel" } : other.has(id) ? { rule: "transfer.pair", other: other.get(id)! } : { rule: "transfer.pair" });
  }
  return { transfers, cardBills };
}
