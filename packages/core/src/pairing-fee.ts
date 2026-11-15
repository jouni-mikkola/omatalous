/**
 * The days of a window between two legs, and the one pair that is not of equal sums: a payment to a household member's
 * account that arrived a fee short. Only pairing.ts calls these; it owns what is paired and keeps the allocations.
 */
import { dayNumber, fromDayNumber, weekdayOf } from "./dates.ts";
import { normalizeIban } from "./iban.ts";
import { isBankingDay } from "./pay-day.ts";
import type { TransferInput } from "./pairing.ts";
import { isUnplacedCardPurchase } from "./pairing-proof.ts";

/** The share of the payment a fee may be, in percent, and the most it may be in cents. A bank's fee between two accounts is small. */
const FEE_MAX_PERCENT = 2;
const FEE_MAX_CENTS = 500;

/** A weekday the banks settle nothing (Good Friday, Christmas): a leg can wait over it, so it is not counted in the window. */
export const closedWeekday = (day: number): boolean => {
  const date = fromDayNumber(day);
  return weekdayOf(date) < 5 && !isBankingDay(date);
};

/** Days between two legs, a closed weekday between them not counted: what the window of a pair is measured in. */
function windowGap(a: number, b: number): number {
  const [low, high] = a < b ? [a, b] : [b, a];
  let closed = 0;
  for (let day = low + 1; day < high; day++) if (closedWeekday(day)) closed++;
  return high - low - closed;
}

/**
 * The fee-short pairs among `rows`: a payment that named a declared account of the household (`landingOf`, by IBAN) and
 * arrived a fee short is paired with the money in that landed on exactly that account, within the window, for less than
 * was paid by at most 2 % and 5 euro. The IBAN is the proof; the name on the money in is not read, but an account it
 * names must be the sender's. Every possible pair is ranked by the difference of the sums, then the gap of days, then
 * the ids, and the pairs are taken from the top, so the result does not depend on the order of the rows. The
 * difference is no part of the pair: it stays the sender's, as the payer's bank fee (`feeOfPairs`).
 */
export function feeShortPairs<T extends TransferInput>(rows: readonly T[], landingOf: ReadonlyMap<string, string>, ibanOf: (accountId: string) => string | null, taken: ReadonlySet<string>, windowDays: number): [T, T][] {
  const arrivals = new Map<string, T[]>();
  for (const leg of rows) if (leg.amountCents > 0 && !taken.has(leg.id)) (arrivals.get(leg.accountId) ?? arrivals.set(leg.accountId, []).get(leg.accountId)!).push(leg);
  const ranked: { out: T; leg: T; fee: number; gap: number }[] = [];
  for (const out of rows) {
    const landing = landingOf.get(normalizeIban(out.counterpartyIban) ?? "");
    if (out.amountCents >= 0 || landing === undefined || landing === out.accountId || taken.has(out.id)) continue;
    const paid = -out.amountCents;
    const day = dayNumber(out.bookingDate);
    const sender = ibanOf(out.accountId);
    for (const leg of arrivals.get(landing) ?? []) {
      const fee = paid - leg.amountCents;
      if (fee <= 0 || fee > FEE_MAX_CENTS || fee * 100 > FEE_MAX_PERCENT * paid) continue;
      const named = normalizeIban(leg.counterpartyIban);
      if (named && named !== sender) continue;
      // money in from a person is never what a purchase the rules could not place was paid back with
      if (leg.category === "p2p_in" && isUnplacedCardPurchase(out)) continue;
      const gap = windowGap(day, dayNumber(leg.bookingDate));
      if (gap <= windowDays) ranked.push({ out, leg, fee, gap });
    }
  }
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  ranked.sort((a, b) => a.fee - b.fee || a.gap - b.gap || order(a.out.id, b.out.id) || order(a.leg.id, b.leg.id));
  const used = new Set<string>();
  const pairs: [T, T][] = [];
  for (const { out, leg } of ranked) {
    if (used.has(out.id) || used.has(leg.id)) continue;
    used.add(out.id).add(leg.id);
    pairs.push([out, leg]);
  }
  return pairs;
}

/**
 * The fee of each pair that arrived short, by the id of the payment: what was paid less what the pair counts
 * (`Allocation.cents`). Derived from the pairs on every run and stored nowhere (ADR 0015), so a pair that forms later or
 * a row that goes changes it on the next run. A payment with no pair, or with one that arrived whole, has none.
 */
export function feeOfPairs<T extends { id: string; amountCents: number }>(rows: readonly T[], allocations: ReadonlyMap<string, readonly { cents: number }[]>): Map<string, number> {
  const fees = new Map<string, number>();
  for (const t of rows) {
    const counted = allocations.get(t.id)?.reduce((s, a) => s + a.cents, 0);
    if (t.amountCents < 0 && counted !== undefined && counted < -t.amountCents) fees.set(t.id, -t.amountCents - counted);
  }
  return fees;
}
