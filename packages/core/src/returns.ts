import { getCategory } from "./categories.ts";
import { dayNumber, monthOf } from "./dates.ts";
import { fold, UNKNOWN_MERCHANT } from "./merchant.ts";
import { median } from "./stats.ts";
import { normalizeIban } from "./transfers.ts";
import type { Transaction } from "./types.ts";
import { isRefundText } from "./wording.ts";

/**
 * How long after a purchase the same merchant may pay it back. A shop's return period is a month or two,
 * but a card dispute (chargeback) runs 120 days and a cancelled trip or a complaint can take as long. A
 * longer window costs little: it also needs the same merchant, the same account and a purchase at least
 * as large.
 */
export const REFUND_WINDOW_DAYS = 120;
/** How long after sending money a person may pay it back. Shorter: only an exact amount from the same person is evidence. */
export const PAYBACK_WINDOW_DAYS = 90;
/** How long after a purchase friends may send their shares. */
export const SHARE_WINDOW_DAYS = 10;
/** The most people one bill is split between. */
const MAX_SHARES = 8;

type ReturnInput = Pick<Transaction, "id" | "accountId" | "bookingDate" | "amountCents" | "merchant" | "counterpartyIban" | "category" | "categorySource"> &
  Partial<Pick<Transaction, "counterparty" | "description">>;

/** Refund words in a payment text. An insurance claim (KORVAUS) is income, not a refund. */
const CLAIM_TEXT = /(?<![A-Z0-9])[A-Z]*KORVAUS[A-Z]*(?![A-Z0-9])/;

/** Purchases that a payment back may cancel: spending on goods, services and people. Card bills and cash are not purchases. */
const NOT_A_PURCHASE = new Set(["card_bill", "cash"]);

/**
 * Money that comes back is not income. Finds incoming rows that cancel an
 * earlier payment and returns incoming id → the payment it cancels, so the
 * caller gives the incoming row the payment's category. Three cases:
 *
 * - a refund: the same merchant pays back, in full or in part, up to 120 days
 *   after a purchase on the same account
 * - a person pays back exactly what you sent them (a mistake, a loan repaid), up to 90 days later
 * - friends send their shares of a bill: one person sends the whole amount,
 *   or at least two different people send the same share (the bill divides by
 *   a number up to 8, cent rounding allowed) within 10 days
 *
 * A match is made only when every part fits, because a wrong match hides
 * real income and a missed one only leaves a refund in the income. Only
 * rows nothing else recognised are candidates (default income, a refund
 * word, MobilePay from a person); salary, benefits, claims and rows the user
 * categorised are never touched. A sender that pays about the same amount in
 * three or more months (rent from a lodger, an allowance) is regular income
 * and never matches. Both rows must be on the same account, which also keeps
 * transfers between own accounts out. The result depends on the rows only,
 * not on their order.
 */
export function matchReturns(txs: readonly ReturnInput[], ownIbans: ReadonlySet<string> = new Set(), locked: ReadonlySet<string> = new Set()): Map<string, string> {
  const rows = sortedRows(txs);
  const regular = steadyParties(rows.filter((t) => t.amountCents > 0 && isNamed(t, ownIbans)));

  const incoming: Incoming[] = [];
  for (const t of rows) {
    if (t.amountCents <= 0 || !isNamed(t, ownIbans) || t.categorySource === "user" || locked.has(t.id) || regular.has(partyKey(t))) continue;
    if (t.category === "p2p_in" && t.categorySource === "rule") incoming.push({ t, day: dayNumber(t.bookingDate), person: true, share: true });
    else if (isPlainIncome(t)) incoming.push({ t, day: dayNumber(t.bookingDate), person: false, share: false });
  }
  return pair(rows, incoming, ownIbans);
}

/**
 * The same pairing on finished rows: returning row id → the purchase it
 * cancels. The reports read it through `moneyIn`, which keeps the pairs a
 * person made and tells a shop's refund by its own rule. Every positive row in a spending category counts, a
 * refund that a rule recognised as well as one matchReturns categorised, so a
 * purchase that came back can leave the lists of largest purchases and
 * merchants. It finds the pairs matchReturns made, because a returned row
 * carries its purchase's category and the rest of the evidence is unchanged.
 */
export function pairedReturns(txs: readonly ReturnInput[], ownIbans: ReadonlySet<string> = new Set()): Map<string, string> {
  const rows = sortedRows(txs);
  const incoming: Incoming[] = [];
  for (const t of rows) {
    if (t.amountCents <= 0 || !isNamed(t, ownIbans) || NOT_A_PURCHASE.has(t.category) || getCategory(t.category).kind !== "expense") continue;
    // only a row that matchReturns put there can be a share of a bill: a refund a rule recognised names its shop
    incoming.push({ t, day: dayNumber(t.bookingDate), person: t.category === "p2p", share: t.categorySource === "match" });
  }
  return incoming.length ? pair(rows, incoming, ownIbans) : new Map();
}

/**
 * What returns read from a row's state, as a short key: two states with the same key are treated alike by
 * `matchReturns` (the rest it reads is in the bank's fields). "share" is money from a person that may be one
 * friend's part of a bill, "plain" unrecognised money in or a refund by its own word.
 */
export function returnClassOf(t: ReturnInput, ownIbans: ReadonlySet<string> = new Set(), locked = false): "purchase" | "person" | "share" | "plain" | "none" {
  if (t.amountCents < 0) {
    if (!isNamed(t, ownIbans) || NOT_A_PURCHASE.has(t.category) || getCategory(t.category).kind !== "expense") return "none";
    return t.category === "p2p" ? "person" : "purchase";
  }
  if (t.amountCents === 0 || !isNamed(t, ownIbans) || t.categorySource === "user" || locked) return "none";
  if (t.category === "p2p_in" && t.categorySource === "rule") return "share";
  return isPlainIncome(t) ? "plain" : "none";
}

interface Incoming {
  t: ReturnInput;
  day: number;
  /** MobilePay from a person: cancels only a payment to a person. */
  person: boolean;
  /** May be one friend's share of a bill paid to a business. */
  share: boolean;
}

interface Purchase {
  t: ReturnInput;
  day: number;
  /** Cents of the purchase not yet cancelled. */
  left: number;
}

const sortedRows = (txs: readonly ReturnInput[]) => [...txs].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id));
/** The key of a payer or payee: the account and the merchant. */
export const partyKey = (t: Pick<Transaction, "accountId" | "merchant">) => `${t.accountId}|${t.merchant}`;
/** A named payer or payee that is not one of the user's own accounts. */
export const isNamed = (t: Pick<Transaction, "merchant" | "counterpartyIban">, ownIbans: ReadonlySet<string>) => t.merchant !== UNKNOWN_MERCHANT && !ownIbans.has(normalizeIban(t.counterpartyIban) ?? "");

/** Finds the payment each incoming row cancels. `rows` are sorted by date and id. */
function pair(rows: readonly ReturnInput[], incoming: readonly Incoming[], ownIbans: ReadonlySet<string>): Map<string, string> {
  if (!incoming.length) return new Map();
  const purchases = new Map<string, Purchase[]>();
  const list: Purchase[] = [];
  for (const t of rows) {
    if (t.amountCents >= 0 || !isNamed(t, ownIbans) || NOT_A_PURCHASE.has(t.category) || getCategory(t.category).kind !== "expense") continue;
    const p = { t, day: dayNumber(t.bookingDate), left: -t.amountCents };
    list.push(p);
    const key = partyKey(t);
    const group = purchases.get(key);
    if (group) group.push(p);
    else purchases.set(key, [p]);
  }

  const matches = new Map<string, string>();

  // refunds from the same merchant and people paying back what they were sent
  for (const inc of incoming) {
    const cents = inc.t.amountCents;
    let best: Purchase | undefined;
    for (const p of purchases.get(partyKey(inc.t)) ?? []) {
      // a person is paid back the whole amount or not at all: a partial amount is not evidence
      const person = p.t.category === "p2p";
      if (p.day > inc.day || inc.day - p.day > (person ? PAYBACK_WINDOW_DAYS : REFUND_WINDOW_DAYS) || p.left < cents) continue;
      if (person && p.left !== cents) continue;
      // a MobilePay payer is matched to what was sent to a person, never to a shop's purchase
      if (inc.person && !person) continue;
      if (!best || better(p, best, cents)) best = p;
    }
    if (best) {
      best.left -= cents;
      matches.set(inc.t.id, best.t.id);
    }
  }

  // friends sending their shares of a bill paid to a business
  const people = incoming.filter((i) => i.share && !matches.has(i.t.id));
  if (people.length) {
    for (const p of list) {
      if (p.t.category === "p2p" || p.left <= 0) continue;
      const total = -p.t.amountCents;
      const first = lowerBound(people, p.day);
      const byAmount = new Map<number, Incoming[]>();
      for (let i = first; i < people.length && people[i]!.day <= p.day + SHARE_WINDOW_DAYS; i++) {
        const inc = people[i]!;
        if (matches.has(inc.t.id) || inc.t.accountId !== p.t.accountId) continue;
        const group = byAmount.get(inc.t.amountCents);
        if (group) group.push(inc);
        else byAmount.set(inc.t.amountCents, [inc]);
      }
      for (const [cents, group] of byAmount) {
        const senders = new Set<string>();
        const shares = group.filter((i) => !senders.has(i.t.merchant) && !!senders.add(i.t.merchant));
        const n = Math.round(total / cents);
        const fits = n === 1 ? total === cents : n >= 2 && n <= MAX_SHARES && shares.length >= 2 && Math.abs(total - n * cents) < n;
        if (!fits || p.left < cents) continue;
        for (const share of shares.slice(0, n)) {
          if (p.left < cents) break;
          p.left -= cents;
          matches.set(share.t.id, p.t.id);
        }
      }
    }
  }
  return matches;
}

/** Unrecognised money in, or a refund by its own word. */
function isPlainIncome(t: ReturnInput): boolean {
  if (t.category === "income" && t.categorySource === "default") return true;
  if (t.category !== "reimbursements" || t.categorySource !== "rule") return false;
  const text = fold([t.merchant, t.counterparty, t.description].filter(Boolean).join(" | "));
  return isRefundText(text) && !CLAIM_TEXT.test(text);
}

/** The better of two purchases for a refund of `cents`: the same amount first, then the latest, then the lower id. */
function better(a: { t: ReturnInput; day: number; left: number }, b: { t: ReturnInput; day: number; left: number }, cents: number): boolean {
  const exactA = a.left === cents ? 1 : 0;
  const exactB = b.left === cents ? 1 : 0;
  if (exactA !== exactB) return exactA > exactB;
  if (a.day !== b.day) return a.day > b.day;
  return a.t.id < b.t.id;
}

function lowerBound(items: readonly { day: number }[], day: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid]!.day < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Parties (account and merchant, see `partyKey`) that move about the same amount (within 10 % of their median) in
 * three or more different months, the rows being all of one direction: rent from a lodger or to a landlord, a regular
 * allowance. Money in from one is income, never a refund; money out to one is a steady payee, not a single gift.
 */
export function steadyParties(rows: readonly Pick<Transaction, "accountId" | "merchant" | "amountCents" | "bookingDate">[]): Set<string> {
  const byParty = new Map<string, (typeof rows)[number][]>();
  for (const t of rows) {
    const key = partyKey(t);
    const group = byParty.get(key);
    if (group) group.push(t);
    else byParty.set(key, [t]);
  }
  const out = new Set<string>();
  for (const [key, list] of byParty) {
    if (list.length < 3) continue;
    const typical = median(list.map((t) => t.amountCents));
    const months = new Set(list.filter((t) => Math.abs(t.amountCents - typical) <= Math.abs(typical) * 0.1).map((t) => monthOf(t.bookingDate)));
    if (months.size >= 3) out.add(key);
  }
  return out;
}
