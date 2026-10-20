import { dayNumber } from "./dates.ts";
import { fold, isCardEnvelopeOnly, UNKNOWN_MERCHANT } from "./merchant.ts";
import { REFUND_WINDOW_DAYS } from "./returns.ts";
import type { Transaction } from "./types.ts";
import { isRefundText } from "./wording.ts";

type Named = Pick<Transaction, "id" | "accountId" | "bookingDate" | "amountCents" | "counterparty" | "description" | "merchant">;

/**
 * The merchants of rows whose text is only a card's currency, country and city ("USD USA SAN FRANCISCO"): the merchant
 * of the same account's row of the same day and sum (a foreign fee, a split line), or, for a refund word, of the latest
 * payment of the opposite sum up to `REFUND_WINDOW_DAYS` before. Row id to merchant; a row with no such row is not in it
 * and keeps its name. `rows` carry the merchant `normalizeMerchant` gave them.
 */
export function fillEnvelopeMerchants(rows: readonly Named[]): Map<string, string> {
  const named = new Map<string, Named[]>();
  const bare: Named[] = [];
  for (const r of rows) {
    if (isCardEnvelopeOnly(r.counterparty, r.description)) {
      bare.push(r);
      continue;
    }
    if (r.merchant === UNKNOWN_MERCHANT) continue;
    const key = `${r.accountId}|${r.amountCents}`;
    const group = named.get(key);
    if (group) group.push(r);
    else named.set(key, [r]);
  }
  const out = new Map<string, string>();
  for (const r of bare) {
    const refund = r.amountCents > 0 && isRefundText(fold([r.counterparty, r.description].filter(Boolean).join(" ")));
    const day = dayNumber(r.bookingDate);
    const donors = (named.get(`${r.accountId}|${refund ? -r.amountCents : r.amountCents}`) ?? []).filter((d) =>
      refund ? d.bookingDate <= r.bookingDate && day - dayNumber(d.bookingDate) <= REFUND_WINDOW_DAYS : d.bookingDate === r.bookingDate,
    );
    const donor = donors.reduce<Named | undefined>((best, d) => (!best || d.bookingDate > best.bookingDate || (d.bookingDate === best.bookingDate && d.id < best.id) ? d : best), undefined);
    if (donor) out.set(r.id, donor.merchant);
  }
  return out;
}
