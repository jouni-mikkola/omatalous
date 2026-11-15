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
export function windowGap(a: number, b: number): number {
  const [low, high] = a < b ? [a, b] : [b, a];
  let closed = 0;
  for (let day = low + 1; day < high; day++) if (closedWeekday(day)) closed++;
  return high - low - closed;
}

/**
 * The money in that is the other leg of a payment which named a declared account of the household and arrived a fee
 * short. The payment's IBAN is the proof: the money in lands on exactly that account (`landing`), within the window,
 * for less than was paid by at most 2 % and 5 euro. The name on the money in is not read, but an account it names
 * must be the sender's. The nearest sum wins, then the nearest day, then the first in the input. The difference is no
 * part of the pair: it stays the sender's.
 */
export function feeShortPartner<T extends TransferInput>(out: T, landing: string, legs: readonly T[], taken: ReadonlySet<string>, senderIban: string | null, windowDays: number): T | undefined {
  const paid = Math.abs(out.amountCents);
  const day = dayNumber(out.bookingDate);
  let best: { leg: T; fee: number; gap: number } | undefined;
  for (const leg of legs) {
    if (leg.amountCents <= 0 || leg.accountId !== landing || leg.accountId === out.accountId || taken.has(leg.id)) continue;
    const fee = paid - leg.amountCents;
    if (fee <= 0 || fee > FEE_MAX_CENTS || fee * 100 > FEE_MAX_PERCENT * paid) continue;
    const named = normalizeIban(leg.counterpartyIban);
    if (named && named !== senderIban) continue;
    // money in from a person is never what a purchase the rules could not place was paid back with
    if (leg.category === "p2p_in" && isUnplacedCardPurchase(out)) continue;
    const gap = windowGap(day, dayNumber(leg.bookingDate));
    if (gap > windowDays) continue;
    if (!best || fee < best.fee || (fee === best.fee && gap < best.gap)) best = { leg, fee, gap };
  }
  return best?.leg;
}
