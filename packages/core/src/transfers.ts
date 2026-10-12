import { getCategory } from "./categories.ts";
import { dayNumber } from "./dates.ts";
import { fold } from "./merchant.ts";
import type { Account, Transaction } from "./types.ts";
import { companyForms } from "./wording.ts";

/** The forms that make a payee a company. */
const PAYEE_FORMS = companyForms("payee");

/** Max days between the two legs of a transfer between own accounts. */
const PAIR_WINDOW_DAYS = 5;

/** Categories that describe the purpose of a payment rather than a purchase, so they may be one leg of a transfer. */
const PAIRABLE_CATEGORIES = new Set(["card_bill", "credit_draw", "other", "income", "p2p", "p2p_in"]);

/** Words in card account names that name neither the issuer nor the product. */
const GENERIC_CARD_WORDS = new Set(["KORTTI", "LUOTTOKORTTI", "CREDIT", "DEBIT", "CARD", "VISA", "MASTERCARD", "DEMO", "TILI", "ACCOUNT", "LUOTTO", "PANKKI", "BANK"]);

/** The kinds of bank that many banks carry in their names, each with a word of its own beside it. */
const BANK_KINDS = new Set(["SAASTOPANKKI", "OSUUSPANKKI", "SPARBANK", "ANDELSBANK"]);

export function normalizeIban(iban: string | null | undefined): string | null {
  const s = iban?.replace(/\s+/g, "").toUpperCase();
  return s ? s : null;
}

type TransferInput = Pick<
  Transaction,
  "id" | "accountId" | "bookingDate" | "amountCents" | "counterpartyIban" | "category" | "categorySource"
> &
  Partial<Pick<Transaction, "merchant" | "counterparty" | "description">>;

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
 * True when a transaction may be money moving between own accounts: nothing
 * recognised it as a purchase. Merchant refunds stay out, so a refund that
 * happens to equal a purchase on another account is not swallowed.
 */
export function pairable(t: TransferInput): boolean {
  if (t.categorySource === "user") return false;
  if (t.categorySource === "default") return true;
  const kind = getCategory(t.category).kind;
  return PAIRABLE_CATEGORIES.has(t.category) || kind === "savings" || kind === "debt" || kind === "transfer";
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

interface Pairing {
  /** Rows that only move money between own accounts. */
  transfers: Set<string>;
  /** The pairs found by amount and day: the outgoing row's id and its incoming row's. */
  pairs: Map<string, string>;
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
 */
export function detectTransfers(txs: readonly TransferInput[], accounts: readonly Account[], options: TransferOptions = {}): Set<string> {
  const { transfers } = pairTransfers(txs, accounts, options.exclude);
  if (options.issuerFallback !== false) for (const id of billsByIssuer(txs, accounts, transfers, { exclude: options.exclude })) transfers.add(id);
  return transfers;
}

/** Everything `detectTransfers` finds before the issuer fallback, with the pairs: what a pair teaches is read from them (card-channel.ts). */
export function pairTransfers(txs: readonly TransferInput[], accounts: readonly Account[], exclude?: ReadonlySet<string>): Pairing {
  const transfers = new Set<string>();
  const pairs = new Map<string, string>();
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const ownIbans = new Set(accounts.map((a) => normalizeIban(a.iban)).filter((x): x is string => !!x));
  const isCard = (t: TransferInput) => accountById.get(t.accountId)?.type === "credit_card";
  const settled = (t: TransferInput) => t.categorySource === "transfer";
  // a payment to the own mortgage account is debt service, not a transfer (see flowsOf)
  const loanIbans = new Set(accounts.filter((a) => a.type === "loan").map((a) => normalizeIban(a.iban)).filter((x): x is string => !!x));
  const onLoan = (t: TransferInput) => accountById.get(t.accountId)?.type === "loan";
  const toLoan = (t: TransferInput) => loanIbans.has(normalizeIban(t.counterpartyIban) ?? "");

  const skipped = exclude ?? new Set<string>();

  for (const tx of txs) {
    if (tx.categorySource === "user" || skipped.has(tx.id) || onLoan(tx) || toLoan(tx)) continue;
    if (settled(tx)) {
      transfers.add(tx.id);
      continue;
    }
    const cpIban = normalizeIban(tx.counterpartyIban);
    if (cpIban && ownIbans.has(cpIban) && cpIban !== normalizeIban(accountById.get(tx.accountId)?.iban)) {
      transfers.add(tx.id);
    } else if (isCard(tx) && tx.amountCents > 0 && pairable(tx)) {
      transfers.add(tx.id);
    }
  }

  if (accounts.length > 1) {
    // legs marked above can still be the partner of an unmarked leg (e.g. the card's "MAKSU, KIITOS"
    // pairs with the e-invoice that paid it); legs settled earlier never are
    const candidates = txs.filter((t) => t.categorySource !== "user" && !skipped.has(t.id) && !settled(t) && !onLoan(t) && !toLoan(t) && (transfers.has(t.id) || pairable(t)));
    // partners have the opposite amount, so only legs of that amount are compared. Per amount the legs are kept
    // per day in input order, so an outgoing leg looks at the eleven days of its window and not at every leg
    // of that amount (a fixed sum moved every week made this quadratic)
    const incoming = new Map<number, Map<number, { t: TransferInput; seq: number }[]>>();
    let seq = 0;
    for (const t of candidates) {
      if (t.amountCents <= 0) continue;
      let days = incoming.get(t.amountCents);
      if (!days) incoming.set(t.amountCents, (days = new Map()));
      const day = dayNumber(t.bookingDate);
      const list = days.get(day);
      if (list) list.push({ t, seq: seq++ });
      else days.set(day, [{ t, seq: seq++ }]);
    }
    const used = new Set<string>();

    /** Whether two opposite legs can be one movement between own accounts. */
    const compatible = (out: TransferInput, inc: TransferInput): boolean => {
      if (inc.accountId === out.accountId || inc.amountCents !== -out.amountCents) return false;
      const outIban = normalizeIban(out.counterpartyIban);
      const incIban = normalizeIban(inc.counterpartyIban);
      // a leg that names an own account pairs only with that account
      if (outIban && ownIbans.has(outIban) && normalizeIban(accountById.get(inc.accountId)?.iban) !== outIban) return false;
      if (incIban && ownIbans.has(incIban) && normalizeIban(accountById.get(out.accountId)?.iban) !== incIban) return false;
      // a leg paid to or from an outside IBAN is someone else's money, unless the card issuer is in between
      const external = (iban: string | null) => !!iban && !ownIbans.has(iban);
      if ((external(outIban) || external(incIban)) && !isCard(out) && !isCard(inc)) return false;
      return true;
    };

    /** The first unused leg of a day that can pair with `out`, with its place in the input order. */
    const firstOn = (days: Map<number, { t: TransferInput; seq: number }[]>, day: number, out: TransferInput) => {
      for (const leg of days.get(day) ?? []) if (!used.has(leg.t.id) && compatible(out, leg.t)) return leg;
      return undefined;
    };

    for (const out of candidates) {
      if (out.amountCents >= 0) continue;
      const days = incoming.get(-out.amountCents);
      if (!days) continue;
      const day = dayNumber(out.bookingDate);
      // the nearest day first; on equal distance the leg that came first in the input
      let best: TransferInput | undefined;
      for (let gap = 0; gap <= PAIR_WINDOW_DAYS && !best; gap++) {
        const before = firstOn(days, day - gap, out);
        const after = gap === 0 ? undefined : firstOn(days, day + gap, out);
        best = (before && after ? (before.seq < after.seq ? before : after) : (before ?? after))?.t;
      }
      if (best) {
        used.add(best.id);
        transfers.add(out.id);
        transfers.add(best.id);
        pairs.set(out.id, best.id);
      }
    }
  }
  return { transfers, pairs };
}

/** What is known against taking a row for a connected card's bill by its text alone. */
interface IssuerEvidence {
  /** Rows that are never a transfer leg (see TransferOptions), and the payments of a lender's contract (card-channel.ts). */
  exclude?: ReadonlySet<string>;
  /** Cards whose payment channel is known (card-channel.ts): only a payment to that channel is their bill. */
  channelled?: ReadonlySet<string>;
}

/**
 * The issuer fallback: card bills that paired with nothing (`settled` holds what did) and whose text names a connected
 * card. The text is weak evidence, since a finance company shares its bank's name, so anything known about this card
 * or this payee goes first.
 */
export function billsByIssuer(txs: readonly TransferInput[], accounts: readonly Account[], settled: ReadonlySet<string>, known: IssuerEvidence = {}): string[] {
  const cards = cardNames(accounts).filter((card) => !known.channelled?.has(card.id));
  if (!cards.length) return [];
  const cardIds = new Set(accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const bills: string[] = [];
  for (const tx of txs) {
    if (tx.category !== "card_bill" || tx.categorySource === "user" || known.exclude?.has(tx.id) || settled.has(tx.id) || cardIds.has(tx.accountId) || tx.amountCents >= 0) continue;
    const text = new Set(wordsOf(fold([tx.merchant, tx.counterparty, tx.description].filter(Boolean).join(" "))));
    if (cards.some((card) => billOfCard(text, card))) bills.push(tx.id);
  }
  return bills;
}
