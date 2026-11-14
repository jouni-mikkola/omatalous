import { dayNumber } from "./dates.ts";
import { fold } from "./merchant.ts";
import { type TransferInput, pairTransfers } from "./pairing.ts";
import type { Account } from "./types.ts";
import { companyForms } from "./wording.ts";

export { normalizeIban } from "./iban.ts";

/** The forms that make a payee a company. */
const PAYEE_FORMS = companyForms("payee");

/** Words in card account names that name neither the issuer nor the product. */
const GENERIC_CARD_WORDS = new Set(["KORTTI", "LUOTTOKORTTI", "CREDIT", "DEBIT", "CARD", "VISA", "MASTERCARD", "DEMO", "TILI", "ACCOUNT", "LUOTTO", "PANKKI", "BANK"]);

/** The kinds of bank that many banks carry in their names, each with a word of its own beside it. */
const BANK_KINDS = new Set(["SAASTOPANKKI", "OSUUSPANKKI", "SPARBANK", "ANDELSBANK"]);

export interface TransferOptions {
  /**
   * An unpaired card bill whose text names a connected card account
   * ("NORDEA GOLD LASKU" or a bare "NORDEA RAHOITUS" with "Nordea Gold"
   * connected, not "NORDEA PLATINUM LASKU") is a transfer. Off for the
   * household view, where the card may be another member's and my own card
   * is not connected.
   */
  issuerFallback?: boolean;
  /** Rows that are returns of a payment (see matchReturns): never a transfer leg, so a refund on a card is not taken for a card payment. */
  exclude?: ReadonlySet<string>;
}

/**
 * Words that tell one card of an issuer from another. VISA and MASTERCARD are left out: one card is both a Gold
 * and a Mastercard.
 */
const CARD_PRODUCT_WORDS = ["GOLD", "PLATINUM", "CREDIT"];

/** Whole words, and a hyphenated name such as S-PANKKI also as one word, so its short part still names the bank. */
const wordsOf = (text: string): string[] =>
  text.split(/[^A-Z0-9-]+/).flatMap((t) => (/^[A-Z0-9]+(-[A-Z0-9]+)+$/.test(t) ? [t, ...t.split("-")] : t.split("-"))).filter(Boolean);

interface CardName {
  /** The card's account. */
  id: string;
  /** What names the card: the issuer and the product, as whole words (a short issuer name such as OP is a word of its own). */
  words: Set<string>;
  /** Every word of the account name, to tell which product it is. */
  all: Set<string>;
}

/** The words of a name that say whose it is: neither a generic card word nor a number. */
const namingWords = (words: readonly string[]) => words.filter((w) => w.length >= 2 && !GENERIC_CARD_WORDS.has(w) && !/^\d+$/.test(w));

function cardNames(accounts: readonly Account[]): CardName[] {
  return accounts
    .filter((a) => a.type === "credit_card")
    .map((a) => {
      const all = wordsOf(fold(a.bankName ?? a.name));
      return { id: a.id, all: new Set(all), words: new Set(namingWords(all)) };
    })
    .filter((c) => c.words.size > 0);
}

/**
 * A bill is the card's when its text names the card, and not another product of the issuer: "NORDEA GOLD" and a
 * bare "NORDEA RAHOITUS SUOMI OY" belong to "Nordea Gold", "NORDEA PLATINUM" does not.
 */
function billOfCard(text: ReadonlySet<string>, card: CardName): boolean {
  // the issuer names the card; a product word alone ("AMERICAN EXPRESS GOLD" next to "Nordea Gold") names any issuer's
  const issuer = [...card.words].filter((w) => !CARD_PRODUCT_WORDS.includes(w));
  if (!(issuer.length ? issuer : [...card.words]).some((w) => text.has(w))) return false;
  return !CARD_PRODUCT_WORDS.some((w) => text.has(w) && !card.all.has(w));
}

/**
 * Whether a payee's name names this card: its issuer by the card's own name (see billOfCard), or the bank the card's
 * connection was made with. "ESIMERKKIPANKKI OYJ" names "Esimerkkipankki Gold".
 */
export function namesCard(payee: string, card: Account): boolean {
  const [byName] = cardNames([card]);
  return (!!byName && billOfCard(new Set(wordsOf(fold(payee))), byName)) || namesBank(payee, card);
}

/** The words of an account's bank that name it: not a generic word, a number nor the form of a company. */
const bankNaming = (account: Pick<Account, "bank">) => namingWords(wordsOf(fold(account.bank ?? ""))).filter((w) => !PAYEE_FORMS.has(w));

/**
 * Whether a payee's name names the bank an account's connection was made with ("Esimerkkipankki Oyj" is named by
 * "ESIMERKKIPANKKI OYJ"). The company form in the bank's name names nobody: any other Oyj would be the bank. Nor does
 * the kind of bank, when the name has another word: "TOISEN SAASTOPANKKI OY" is not "Esimerkin Säästöpankki". A bank
 * whose whole name is its kind is named by it.
 */
export function namesBank(payee: string, account: Pick<Account, "bank">): boolean {
  const text = new Set(wordsOf(fold(payee)));
  const naming = bankNaming(account);
  const own = naming.filter((w) => !BANK_KINDS.has(w));
  return (own.length ? own : naming).some((w) => text.has(w));
}

/**
 * Whether a payee's name is the bank's own and nobody else's: it names the bank (see namesBank) and holds no word that
 * names anything but the bank. "ESIMERKKIPANKKI OYJ" is "Esimerkkipankki Oyj" itself; "ESIMERKKIPANKKI KIINTEISTOT OY"
 * and a stranger who shares the bank's one word ("OMA TUPA OY" beside "Oma Säästöpankki Oyj") only share a word with it.
 */
export function isBankName(payee: string, account: Pick<Account, "bank">): boolean {
  const naming = bankNaming(account);
  return namesBank(payee, account) && namingWords(wordsOf(fold(payee))).every((w) => PAYEE_FORMS.has(w) || naming.includes(w));
}

/**
 * Finds transactions that only move money between the user's own connected
 * accounts, so they count as neither income nor spending:
 *
 * - the counterparty IBAN is another own account
 * - money into a credit card account (bill payment, prepaying the Gold card)
 * - −X on one own account and +X on another within a few days: savings
 *   transfers, a credit line drawn to checking, the card bill paid from
 *   checking (its purchases are already counted on the card account)
 * - a card bill without a matching card payment, when it names a
 *   connected card (see TransferOptions)
 *
 * Rows already marked as transfers (category source "transfer", e.g. each
 * member's own pairs in the household view) keep their partner and are not
 * paired again. Own-account money that has no matching leg stays in its
 * category, e.g. "säästöön" to an unconnected savings account counts as savings.
 * The pairing itself is pairing.ts.
 */
export function detectTransfers(txs: readonly TransferInput[], accounts: readonly Account[], options: TransferOptions = {}): Set<string> {
  const { transfers } = pairTransfers(txs, accounts, options.exclude);
  if (options.issuerFallback !== false) for (const id of billsByIssuer(txs, accounts, transfers, { exclude: options.exclude })) transfers.add(id);
  return transfers;
}

/** What is known against taking a row for a connected card's bill by its text alone. */
interface IssuerEvidence {
  /** Rows that are never a transfer leg (see TransferOptions), and the payments of a lender's contract (card-channel.ts). */
  exclude?: ReadonlySet<string>;
  /** Cards whose payment channel is known (card-channel.ts): only a payment to that channel is their bill. */
  channelled?: ReadonlySet<string>;
}

/** A card bill pays the purchases of the month before it: a card whose rows began more than this long before a payment holds them. */
export const BILLING_MONTH_DAYS = 31;

/**
 * The issuer fallback: card bills that paired with nothing (`settled` holds what did) and whose text names a connected
 * card. The text is weak evidence, since a finance company shares its bank's name, so anything known about this card
 * or this payee goes first. A bill from before the card's first row, or within a billing month after it, pays purchases
 * that are in no row: it stays a card bill, as a channel's payment does (card-channel.ts). A card with no row at all says
 * nothing of its start.
 */
export function billsByIssuer(txs: readonly TransferInput[], accounts: readonly Account[], settled: ReadonlySet<string>, known: IssuerEvidence = {}): string[] {
  const cards = cardNames(accounts).filter((card) => !known.channelled?.has(card.id));
  if (!cards.length) return [];
  const cardIds = new Set(accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const began = new Map<string, number>();
  for (const tx of txs) {
    if (!cardIds.has(tx.accountId)) continue;
    const day = dayNumber(tx.bookingDate);
    if (day < (began.get(tx.accountId) ?? Number.POSITIVE_INFINITY)) began.set(tx.accountId, day);
  }
  const holds = (cardId: string, day: number) => !began.has(cardId) || day - began.get(cardId)! > BILLING_MONTH_DAYS;
  const bills: string[] = [];
  for (const tx of txs) {
    if (tx.category !== "card_bill" || tx.categorySource === "user" || known.exclude?.has(tx.id) || settled.has(tx.id) || cardIds.has(tx.accountId) || tx.amountCents >= 0) continue;
    const text = new Set(wordsOf(fold([tx.merchant, tx.counterparty, tx.description].filter(Boolean).join(" "))));
    const day = dayNumber(tx.bookingDate);
    if (cards.some((card) => billOfCard(text, card) && holds(card.id, day))) bills.push(tx.id);
  }
  return bills;
}
