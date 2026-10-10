import { getCategory } from "./categories.ts";
import { dayNumber } from "./dates.ts";
import { fold } from "./merchant.ts";
import type { Account, Transaction } from "./types.ts";

/** Max days between the two legs of a transfer between own accounts. */
const PAIR_WINDOW_DAYS = 5;

/** Categories that describe the purpose of a payment rather than a purchase, so they may be one leg of a transfer. */
const PAIRABLE_CATEGORIES = new Set(["card_bill", "credit_draw", "other", "income", "p2p", "p2p_in"]);

/** Words in card account names that say nothing about the issuer. */
const GENERIC_CARD_WORDS = new Set(["KORTTI", "LUOTTOKORTTI", "CREDIT", "DEBIT", "CARD", "VISA", "MASTERCARD", "DEMO", "TILI", "ACCOUNT", "LUOTTO"]);

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
   * An unpaired card bill whose text names the issuer of a connected card
   * account (e.g. "NORDEA GOLD LASKU" with "Nordea Gold" connected) is a
   * transfer. Off for the household view, where the card may be another
   * member's and my own card is not connected.
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

function issuerWords(accounts: readonly Account[]): string[] {
  const words = accounts
    .filter((a) => a.type === "credit_card")
    .flatMap((a) => fold(a.name).split(/[^A-Z0-9]+/))
    .filter((w) => w.length >= 4 && !GENERIC_CARD_WORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)];
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
 * - a card bill without a matching card payment, when it names the issuer
 *   of a connected card (see TransferOptions)
 *
 * Rows already marked as transfers (category source "transfer", e.g. each
 * member's own pairs in the household view) keep their partner and are not
 * paired again. Own-account money that has no matching leg stays in its
 * category, e.g. "säästöön" to an unconnected savings account counts as savings.
 */
export function detectTransfers(txs: readonly TransferInput[], accounts: readonly Account[], options: TransferOptions = {}): Set<string> {
  const transfers = new Set<string>();
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const ownIbans = new Set(accounts.map((a) => normalizeIban(a.iban)).filter((x): x is string => !!x));
  const isCard = (t: TransferInput) => accountById.get(t.accountId)?.type === "credit_card";
  const settled = (t: TransferInput) => t.categorySource === "transfer";
  // a payment to the own mortgage account is debt service, not a transfer (see flowsOf)
  const loanIbans = new Set(accounts.filter((a) => a.type === "loan").map((a) => normalizeIban(a.iban)).filter((x): x is string => !!x));
  const onLoan = (t: TransferInput) => accountById.get(t.accountId)?.type === "loan";
  const toLoan = (t: TransferInput) => loanIbans.has(normalizeIban(t.counterpartyIban) ?? "");

  const skipped = options.exclude ?? new Set<string>();

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
      }
    }
  }

  if (options.issuerFallback !== false) {
    const issuers = issuerWords(accounts);
    if (issuers.length) {
      for (const tx of txs) {
        if (tx.category !== "card_bill" || tx.categorySource === "user" || skipped.has(tx.id) || transfers.has(tx.id) || isCard(tx) || tx.amountCents >= 0) continue;
        const text = fold([tx.merchant, tx.counterparty, tx.description].filter(Boolean).join(" "));
        if (issuers.some((w) => new RegExp(`(?<![A-Z0-9])${w}(?![A-Z0-9])`).test(text))) transfers.add(tx.id);
      }
    }
  }
  return transfers;
}
