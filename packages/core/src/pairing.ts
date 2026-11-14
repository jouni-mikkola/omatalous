/**
 * The one owner of pairing: which two rows are the two legs of one movement of money. Every place that forms a pair
 * from amounts and days lives here, each as a named variant of the rule it had before the move (the same pairs, the
 * same windows), so a change of the rule is a change of this file.
 *
 * `pairTransfers` is the engine of the transfers between own accounts. Its `allocations` are the contract the readers
 * will move to: per leg, the parts that match a partner. Today every pair is one allocation on each leg, the whole
 * amount, so `cents` and `partnerCents` are equal and the sum of a leg's `cents` is its amount.
 *
 * The variants below are still separate rules and are the places that PR 8 of the money flow plan replaces by the
 * allocations: `loanPaymentLeg`, `incomingLegFinder`, `cardLegOf`, `poolLegFinder` and `pairMoves`.
 */
import { getCategory } from "./categories.ts";
import { dayNumber, fromDayNumber, weekdayOf } from "./dates.ts";
import { normalizeIban } from "./iban.ts";
import { isBankingDay } from "./pay-day.ts";
import type { TraceRow } from "./money-trace-lots.ts";
import type { Account, Transaction } from "./types.ts";

/**
 * Max days between the two legs of a transfer between own accounts, in either order. A weekday the banks are closed
 * between the legs does not count: money sent the Wednesday before Easter lands the Tuesday after it. The trace's
 * `TRACE_PAIR_DAYS` is a second, narrower window for another job.
 */
export const PAIR_WINDOW_DAYS = 5;

/** A weekday the banks settle nothing (Good Friday, Christmas): a leg can wait over it, so it is not counted in the window. */
const closedWeekday = (day: number): boolean => {
  const date = fromDayNumber(day);
  return weekdayOf(date) < 5 && !isBankingDay(date);
};

/**
 * Everyday spending on an account the bank typed as a loan: this many purchases out make it a current account (a joint
 * account the bank listed as a loan), and money into it is then a transfer like money into any own account. A loan
 * account takes instalments and books interest; it pays no shop.
 */
const DEPOSIT_PURCHASES = 3;

/** Categories that describe the purpose of a payment rather than a purchase, so they may be one leg of a transfer. */
const PAIRABLE_CATEGORIES = new Set(["card_bill", "credit_draw", "other", "income", "p2p", "p2p_in"]);

export type TransferInput = Pick<
  Transaction,
  "id" | "accountId" | "bookingDate" | "amountCents" | "counterpartyIban" | "category" | "categorySource"
> &
  Partial<Pick<Transaction, "merchant" | "counterparty" | "description">>;

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

/** A purchase: money out in a spending category the rules chose, not the default nor a bank's fee. */
const isPurchase = (t: TransferInput): boolean =>
  t.categorySource !== "default" && t.category !== "other" && t.category !== "fees" && getCategory(t.category).kind === "expense";

/** How a pair was formed. Today's pairs have one way, the amount on the days of the window; the links of the plan come with the readers' move. */
export type PairLink = "amount-day";

/** How far the pair is proved. Today every pair decides its rows. */
export type PairTier = "decided";

/**
 * The part of one leg that matches a partner leg. `cents` is that part of this leg's amount, in this leg's currency,
 * absolute; `partnerCents` is the same part on the partner's side. A leg's `cents` add up to at most its amount, and
 * if A's allocation to B is `{cents: c, partnerCents: p}`, B's to A is `{cents: p, partnerCents: c}`.
 */
export interface Allocation {
  partnerId: string;
  cents: number;
  partnerCents: number;
  link: PairLink;
  tier: PairTier;
}

interface Pairing {
  /** Rows that only move money between own accounts. */
  transfers: Set<string>;
  /** The pairs found by amount and day: the outgoing row's id and its incoming row's. */
  pairs: Map<string, string>;
  /** The same pairs per leg, as the parts that match a partner. */
  allocations: Map<string, Allocation[]>;
}

/** Everything `detectTransfers` finds before the issuer fallback, with the pairs: what a pair teaches is read from them (card-channel.ts). */
export function pairTransfers(txs: readonly TransferInput[], accounts: readonly Account[], exclude?: ReadonlySet<string>): Pairing {
  const transfers = new Set<string>();
  const pairs = new Map<string, string>();
  const allocations = new Map<string, Allocation[]>();
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const ownIbans = new Set(accounts.map((a) => normalizeIban(a.iban)).filter((x): x is string => !!x));
  const isCard = (t: TransferInput) => accountById.get(t.accountId)?.type === "credit_card";
  const settled = (t: TransferInput) => t.categorySource === "transfer";
  // a payment to the own mortgage account is debt service, not a transfer (see flowsOf); the type alone does not make a
  // loan of an account that pays shops
  const purchases = new Map<string, number>();
  for (const t of txs) if (t.amountCents < 0 && accountById.get(t.accountId)?.type === "loan" && isPurchase(t)) purchases.set(t.accountId, (purchases.get(t.accountId) ?? 0) + 1);
  const loanAccounts = accounts.filter((a) => a.type === "loan" && (purchases.get(a.id) ?? 0) < DEPOSIT_PURCHASES);
  const loanIds = new Set(loanAccounts.map((a) => a.id));
  const loanIbans = new Set(loanAccounts.map((a) => normalizeIban(a.iban)).filter((x): x is string => !!x));
  const onLoan = (t: TransferInput) => loanIds.has(t.accountId);
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
      // the nearest day first; on equal distance the leg that came first in the input. Each side counts the closed
      // weekdays between the legs, which the window does not
      let best: TransferInput | undefined;
      let closedBefore = 0;
      let closedAfter = 0;
      for (let gap = 0; !best; gap++) {
        if (gap > 1) {
          if (closedWeekday(day - gap + 1)) closedBefore++;
          if (closedWeekday(day + gap - 1)) closedAfter++;
        }
        if (gap - closedBefore > PAIR_WINDOW_DAYS && gap - closedAfter > PAIR_WINDOW_DAYS) break;
        const before = gap - closedBefore <= PAIR_WINDOW_DAYS ? firstOn(days, day - gap, out) : undefined;
        const after = gap === 0 || gap - closedAfter > PAIR_WINDOW_DAYS ? undefined : firstOn(days, day + gap, out);
        best = (before && after ? (before.seq < after.seq ? before : after) : (before ?? after))?.t;
      }
      if (best) {
        used.add(best.id);
        transfers.add(out.id);
        transfers.add(best.id);
        pairs.set(out.id, best.id);
        const cents = best.amountCents;
        allocations.set(out.id, [{ partnerId: best.id, cents, partnerCents: cents, link: "amount-day", tier: "decided" }]);
        allocations.set(best.id, [{ partnerId: out.id, cents, partnerCents: cents, link: "amount-day", tier: "decided" }]);
      }
    }
  }
  return { transfers, pairs, allocations };
}

/** How far apart in days a payment and the card's own row of the same sum may be. */
const CARD_LEG_DAYS = 3;

/**
 * The card whose own outgoing row is the other leg of a transfer row: the first row of the same sum out of a card
 * within `CARD_LEG_DAYS` days. A row that is no transfer has none. A card row is not used up by a pair and is not
 * checked for `pairable`, so a sum paid to two cards reads the first.
 */
export function cardLegOf<T extends { accountId: string; amountCents: number; day: number; isTransfer: boolean }>(txs: readonly T[], cardAccounts: ReadonlySet<string>): (t: T) => string | null {
  const cardOut = new Map<number, T[]>();
  for (const t of txs) if (cardAccounts.has(t.accountId) && t.amountCents < 0) cardOut.set(-t.amountCents, [...(cardOut.get(-t.amountCents) ?? []), t]);
  return (t) => (t.isTransfer ? (cardOut.get(t.amountCents)?.find((c) => Math.abs(c.day - t.day) <= CARD_LEG_DAYS)?.accountId ?? null) : null);
}

/** The row on another account that left the money: the opposite amount within the pairing window, the named account first. */
export function loanPaymentLeg(t: TransferInput, txs: readonly TransferInput[], ibanOf: ReadonlyMap<string, string | null>): string | null {
  const day = dayNumber(t.bookingDate);
  const named = normalizeIban(t.counterpartyIban);
  const found = txs
    .filter((o) => o.accountId !== t.accountId && o.amountCents === -t.amountCents && pairable(o) && Math.abs(dayNumber(o.bookingDate) - day) <= PAIR_WINDOW_DAYS)
    .sort((a, b) => Number(ibanOf.get(b.accountId) === named) - Number(ibanOf.get(a.accountId) === named) || Math.abs(dayNumber(a.bookingDate) - day) - Math.abs(dayNumber(b.bookingDate) - day));
  return found[0]?.id ?? null;
}

/**
 * Finds the leg that came in for a leg that left, among booked transfer rows (`moved`), each leg once: the same sum
 * by `billCents` (a leg on a joint account is cut to the viewer's part in a member's own view), on `to` when the
 * leg names its account, the nearest day first, within the pairing window.
 */
export function incomingLegFinder<T extends { id: string; accountId: string; day: number; amountCents: number }>(moved: readonly T[], billCents: (t: T) => number): (out: T, to: string | null) => T | undefined {
  const cameIn = new Map<number, T[]>();
  for (const t of moved) {
    if (t.amountCents <= 0) continue;
    const legs = cameIn.get(billCents(t));
    if (legs) legs.push(t);
    else cameIn.set(billCents(t), [t]);
  }
  const used = new Set<string>();
  return (out, to) => {
    let best: T | undefined;
    for (const t of cameIn.get(-billCents(out)) ?? []) {
      const gap = Math.abs(t.day - out.day);
      if (t.accountId === out.accountId || used.has(t.id) || gap > PAIR_WINDOW_DAYS || (to !== null && t.accountId !== to)) continue;
      if (!best || gap < Math.abs(best.day - out.day)) best = t;
    }
    if (best) used.add(best.id);
    return best;
  };
}

/** What `poolLegFinder` needs to know of a pool that is traced. */
interface PoolBook {
  /** The IBANs of the pools. */
  pools: ReadonlySet<string>;
  /** Account to its IBAN (normalised). */
  ibanOf: ReadonlyMap<string, string | null>;
  /** The IBAN of the pool that is read. */
  self: string | null;
}

export type PoolLeg = (tx: Transaction, dir: 1 | -1) => Transaction | undefined;

/**
 * Finds the leg of a row on another pool, each leg once: `dir` 1 looks from money out to the money in, -1 back from money in.
 * The legs have the same cents, the money out on the same day or up to `days` before the money in, and evidence that
 * the two rows are one movement: one names the other's pool by IBAN, or neither has an IBAN and both may be a transfer.
 * `order` sorts the rows of the other pools, which decides which of equal legs is read first.
 */
export function poolLegFinder({ pools, ibanOf, self }: PoolBook, others: readonly Transaction[], order: (a: Transaction, b: Transaction) => number, days: number): PoolLeg {
  const onPool = (t: Transaction): boolean => {
    const iban = ibanOf.get(t.accountId);
    return !!iban && iban !== self && pools.has(iban);
  };
  const legIndex = new Map<number, Map<number, Transaction[]>>();
  for (const t of [...others].sort(order)) {
    if (!onPool(t) || t.status === "pending") continue;
    let byDay = legIndex.get(t.amountCents);
    if (!byDay) legIndex.set(t.amountCents, (byDay = new Map()));
    const day = dayNumber(t.bookingDate);
    const list = byDay.get(day);
    if (list) list.push(t);
    else byDay.set(day, [t]);
  }
  const used = new Set<string>();
  return (tx, dir) => {
    const byDay = legIndex.get(-tx.amountCents);
    if (!byDay) return undefined;
    const day = dayNumber(tx.bookingDate);
    const rowIban = normalizeIban(tx.counterpartyIban);
    for (let gap = 0; gap <= days; gap++) {
      for (const leg of byDay.get(day + dir * gap) ?? []) {
        const legIban = normalizeIban(leg.counterpartyIban);
        if (used.has(leg.id) || (rowIban && rowIban !== ibanOf.get(leg.accountId)) || (legIban && legIban !== self)) continue;
        if (!rowIban && !legIban && !(pairable(tx) && pairable(leg))) continue;
        used.add(leg.id);
        return leg;
      }
    }
    return undefined;
  };
}

/**
 * The pair of a movement for one person: a money-in row and a money-out row for one person of exactly the same sum,
 * the out on the same day as the in or up to `days` after it, are a pair (the nearest day first, then the content
 * order; a row pairs once, and the in-row must be read before the out-row). The result maps the in-row's key to the
 * out-row's: the lots the in-row makes are kept for that out-row.
 */
export function pairMoves(order: readonly TraceRow[], days: number): Map<string, string> {
  const position = new Map(order.map((r, i) => [r.key, i]));
  const inIndex = new Map<number, Map<number, TraceRow[]>>();
  for (const r of order) {
    if (r.cents <= 0 || r.unmatched) continue;
    let byDay = inIndex.get(r.cents);
    if (!byDay) inIndex.set(r.cents, (byDay = new Map()));
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  }
  const outOf = new Map<string, string>();
  const paired = new Set<string>();
  for (const r of order) {
    if (r.cents >= 0 || r.unmatched || typeof r.to !== "object") continue;
    const byDay = inIndex.get(-r.cents);
    if (!byDay) continue;
    const at = position.get(r.key)!;
    for (let gap = 0; gap <= days && !paired.has(r.key); gap++) {
      const hit = (byDay.get(r.day - gap) ?? []).find((c) => !outOf.has(c.key) && position.get(c.key)! < at);
      if (hit) {
        outOf.set(hit.key, r.key);
        paired.add(r.key);
      }
    }
  }
  return outOf;
}
