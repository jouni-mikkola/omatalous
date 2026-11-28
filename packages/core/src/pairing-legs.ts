/**
 * The variants of pairing that read one leg against a list of others: a transfer's card leg, a loan payment's leg, the
 * money in for a bill, a pool's leg and the moves of the money trace. Each returns `Allocation[]` with a thin adapter
 * for the old shape. The transfers between accounts and the rounds of the member views are in pairing.ts, and the
 * rule of that file's header holds here too.
 */
import { dayNumber } from "./dates.ts";
import { normalizeIban } from "./iban.ts";
import type { TraceRow } from "./money-trace-lots.ts";
import { type Allocation, mayBeTransferLeg, PAIR_WINDOW_DAYS, type TransferInput, wholePair } from "./pairing.ts";
import type { Transaction } from "./types.ts";

/** How far apart in days a payment and the card's own row of the same sum may be. */
const CARD_LEG_DAYS = 3;

/**
 * The card whose own outgoing row is the other leg of a transfer row: the first row of the same sum out of a card
 * within `CARD_LEG_DAYS` days. A row that is no transfer has none. A card row is not used up by a pair and is not
 * checked for `mayBeTransferLeg`, so a sum paid to two cards reads the first.
 */
export function cardLegAllocations<T extends { id: string; accountId: string; amountCents: number; day: number; isTransfer: boolean }>(txs: readonly T[], cardAccounts: ReadonlySet<string>): (t: T) => Allocation[] {
  const cardOut = new Map<number, T[]>();
  for (const t of txs) if (cardAccounts.has(t.accountId) && t.amountCents < 0) cardOut.set(-t.amountCents, [...(cardOut.get(-t.amountCents) ?? []), t]);
  return (t) => {
    const leg = t.isTransfer ? cardOut.get(t.amountCents)?.find((c) => Math.abs(c.day - t.day) <= CARD_LEG_DAYS) : undefined;
    return leg ? [wholePair(t.id, leg.id, t.amountCents)[0]] : [];
  };
}

/** The account of the card that `cardLegAllocations` names, or null: the old shape of the card of a transfer row. */
export function cardLegOf<T extends { id: string; accountId: string; amountCents: number; day: number; isTransfer: boolean }>(txs: readonly T[], cardAccounts: ReadonlySet<string>): (t: T) => string | null {
  const legs = cardLegAllocations(txs, cardAccounts);
  const accountOf = new Map(txs.map((t) => [t.id, t.accountId]));
  return (t) => {
    const [part] = legs(t);
    return part ? (accountOf.get(part.partnerId) ?? null) : null;
  };
}

/** The row on another account that left the money: the opposite amount within the pairing window, the named account first. */
export function loanPaymentAllocations(t: TransferInput, txs: readonly TransferInput[], ibanOf: ReadonlyMap<string, string | null>): Allocation[] {
  const day = dayNumber(t.bookingDate);
  const named = normalizeIban(t.counterpartyIban);
  const found = txs
    .filter((o) => o.accountId !== t.accountId && o.amountCents === -t.amountCents && mayBeTransferLeg(o) && Math.abs(dayNumber(o.bookingDate) - day) <= PAIR_WINDOW_DAYS)
    .sort((a, b) => Number(ibanOf.get(b.accountId) === named) - Number(ibanOf.get(a.accountId) === named) || Math.abs(dayNumber(a.bookingDate) - day) - Math.abs(dayNumber(b.bookingDate) - day));
  return found[0] ? [wholePair(t.id, found[0].id, Math.abs(t.amountCents))[0]] : [];
}

/** The id of the leg `loanPaymentAllocations` names, or null: the old shape. */
export function loanPaymentLeg(t: TransferInput, txs: readonly TransferInput[], ibanOf: ReadonlyMap<string, string | null>): string | null {
  return loanPaymentAllocations(t, txs, ibanOf)[0]?.partnerId ?? null;
}

/**
 * Finds the leg that came in for a leg that left, among booked transfer rows (`moved`), each leg once: the same sum
 * by `billCents` (a leg on a joint account is cut to the viewer's part in a member's own view), on `to` when the
 * leg names its account, the nearest day first, within the pairing window.
 */
export function incomingLegAllocations<T extends { id: string; accountId: string; day: number; amountCents: number }>(moved: readonly T[], billCents: (t: T) => number): (out: T, to: string | null) => Allocation[] {
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
    if (!best) return [];
    used.add(best.id);
    return [wholePair(out.id, best.id, billCents(best))[0]];
  };
}

/** The leg `incomingLegAllocations` names, among `moved`: the old shape. */
export function incomingLegFinder<T extends { id: string; accountId: string; day: number; amountCents: number }>(moved: readonly T[], billCents: (t: T) => number): (out: T, to: string | null) => T | undefined {
  const legs = incomingLegAllocations(moved, billCents);
  const byId = new Map(moved.map((t) => [t.id, t]));
  return (out, to) => {
    const [part] = legs(out, to);
    return part ? byId.get(part.partnerId) : undefined;
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

/** The same, as the allocations of the row: none or one. */
type PoolLegAllocations = (tx: Transaction, dir: 1 | -1) => Allocation[];

/**
 * Finds the leg of a row on another pool, each leg once: `dir` 1 looks from money out to the money in, -1 back from money in.
 * The legs have the same cents, the money out on the same day or up to `days` before the money in, and evidence that
 * the two rows are one movement: one names the other's pool by IBAN, or neither has an IBAN and both may be a transfer.
 * `order` sorts the rows of the other pools, which decides which of equal legs is read first.
 */
export function poolLegAllocations({ pools, ibanOf, self }: PoolBook, others: readonly Transaction[], order: (a: Transaction, b: Transaction) => number, days: number): PoolLegAllocations {
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
    if (!byDay) return [];
    const day = dayNumber(tx.bookingDate);
    const rowIban = normalizeIban(tx.counterpartyIban);
    for (let gap = 0; gap <= days; gap++) {
      for (const leg of byDay.get(day + dir * gap) ?? []) {
        const legIban = normalizeIban(leg.counterpartyIban);
        if (used.has(leg.id) || (rowIban && rowIban !== ibanOf.get(leg.accountId)) || (legIban && legIban !== self)) continue;
        if (!rowIban && !legIban && !(mayBeTransferLeg(tx) && mayBeTransferLeg(leg))) continue;
        used.add(leg.id);
        return [wholePair(tx.id, leg.id, Math.abs(tx.amountCents))[0]];
      }
    }
    return [];
  };
}

/** The row `poolLegAllocations` names, among `others`: the old shape. */
export function poolLegFinder(book: PoolBook, others: readonly Transaction[], order: (a: Transaction, b: Transaction) => number, days: number): PoolLeg {
  const legs = poolLegAllocations(book, others, order, days);
  const byId = new Map(others.map((t) => [t.id, t]));
  return (tx, dir) => {
    const [part] = legs(tx, dir);
    return part ? byId.get(part.partnerId) : undefined;
  };
}

/**
 * The pair of a movement for one person: a money-in row and a money-out row for one person of exactly the same sum,
 * the out on the same day as the in or up to `days` after it, are a pair (the nearest day first, then the content
 * order; a row pairs once, and the in-row must be read before the out-row). The allocations are by the rows' keys,
 * in the order the pairs were found.
 */
export function moveAllocations(order: readonly TraceRow[], days: number): Map<string, Allocation[]> {
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
  const allocations = new Map<string, Allocation[]>();
  for (const r of order) {
    if (r.cents >= 0 || r.unmatched || typeof r.to !== "object") continue;
    const byDay = inIndex.get(-r.cents);
    if (!byDay) continue;
    const at = position.get(r.key)!;
    for (let gap = 0; gap <= days && !allocations.has(r.key); gap++) {
      const hit = (byDay.get(r.day - gap) ?? []).find((c) => !allocations.has(c.key) && position.get(c.key)! < at);
      if (hit) {
        const [inPart, outPart] = wholePair(hit.key, r.key, hit.cents);
        allocations.set(hit.key, [inPart]);
        allocations.set(r.key, [outPart]);
      }
    }
  }
  return allocations;
}

/** The old shape of the moves: the in-row's key to the out-row's, whose lots the in-row makes are kept for. `order` is the rows the allocations came from. */
export function movesOf(allocations: ReadonlyMap<string, readonly Allocation[]>, order: readonly TraceRow[]): Map<string, string> {
  const incoming = new Set(order.filter((r) => r.cents > 0).map((r) => r.key));
  const outOf = new Map<string, string>();
  for (const [key, parts] of allocations) if (incoming.has(key)) outOf.set(key, parts[0]!.partnerId);
  return outOf;
}
