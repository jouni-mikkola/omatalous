/**
 * The alerts that depend on what the user said about a subscription or an alert (marks): the question about a service
 * that may be forgotten, the warning about a charge after a cancellation, and the dismissed ids. `buildAlerts`
 * (alerts.ts) calls them.
 */
import { addDays, addMonths, monthOf } from "../dates.ts";
import type { RecurringSeries } from "../recurring.ts";
import type { IsoDate, UserMark } from "../types.ts";
import type { Alert } from "./alerts.ts";
import type { AnalysisTx } from "./context.ts";
import { formatEur, formatFiDate } from "./format.ts";

const ALERT_SUBJECT = "alert:";
const MERCHANT_SUBJECT = "merchant:";

/** The ids of the alerts the user said not to show again (the subject is `alert:<id>`). */
export function dismissedIds(marks: readonly UserMark[]): ReadonlySet<string> {
  return new Set(marks.filter((m) => m.mark === "dismissed" && m.subject.startsWith(ALERT_SUBJECT)).map((m) => m.subject.slice(ALERT_SUBJECT.length)));
}

/** The user's marks on merchants, by merchant name. */
export function marksByMerchant(marks: readonly UserMark[]): ReadonlyMap<string, UserMark> {
  const out = new Map<string, UserMark>();
  for (const m of marks) if (m.subject.startsWith(MERCHANT_SUBJECT)) out.set(m.subject.slice(MERCHANT_SUBJECT.length), m);
  return out;
}

/** The day a mark was made. The server writes the timestamp in the instance's time zone, so its date part is the local day. */
const markedDay = (m: Pick<UserMark, "markedAt">): IsoDate => m.markedAt.slice(0, 10);

/**
 * Whether "in use" still answers the question about a subscription on `today`: for twelve months after it was said,
 * then the question comes back (a service can be forgotten later). The recurring page uses the same rule.
 */
export function inUseQuietsQuestion(mark: Pick<UserMark, "mark" | "markedAt">, today: IsoDate): boolean {
  return mark.mark === "in_use" && markedDay(mark) >= `${addMonths(monthOf(today), -12)}-${today.slice(8, 10)}`;
}

const FORGOTTEN_MAX = 2;

/** A price as a single charge shows it: whole euros stay whole, 10,99 keeps its cents. */
const price = (cents: number) => formatEur(cents, cents % 100 !== 0);

/** A small service that has run for months. Not asked about when the user said it is in use (for a year) or cancelled. */
export function forgotten(recurring: readonly RecurringSeries[], inOverlap: ReadonlySet<string>, marks: ReadonlyMap<string, UserMark>, today: IsoDate): Alert[] {
  return recurring
    .filter((s) => {
      const mark = marks.get(s.merchant);
      return s.review && !inOverlap.has(s.merchant) && mark?.mark !== "cancelled" && !(mark && inUseQuietsQuestion(mark, today));
    })
    .sort((a, b) => b.monthlyCents - a.monthlyCents)
    .slice(0, FORGOTTEN_MAX)
    .map((s) => ({
      id: `forgotten:${s.id}`,
      kind: "forgotten" as const,
      tone: "info" as const,
      title: `${s.merchant} ${price(s.monthlyCents)}/kk, ${formatEur(s.yearlyCents, false)} vuodessa`,
      detail: `Maksettu ${s.monthsActive} kuukautta.`,
      merchant: s.merchant,
    }));
}

const CANCELLED_MAX = 2;

/**
 * A card purchase is pending for a day or two before it books. A charge that books this soon after the mark was
 * made before it, so only a booking after these days says the cancellation did not take.
 */
const PENDING_GRACE_DAYS = 3;

/**
 * A merchant the user marked as cancelled charged again: the cancellation did not take, or the mark was a slip.
 * `charges` are the booked purchases of the period, oldest first.
 */
export function chargedAfterCancelling(charges: readonly AnalysisTx[], marks: ReadonlyMap<string, UserMark>): Alert[] {
  const byMerchant = new Map<string, AnalysisTx[]>();
  for (const t of charges) {
    const mark = marks.get(t.merchant);
    // a charge the merchant paid back is settled
    if (mark?.mark !== "cancelled" || t.bookingDate <= addDays(markedDay(mark), PENDING_GRACE_DAYS) || -t.amountCents - t.refunded <= 0) continue;
    const list = byMerchant.get(t.merchant);
    if (list) list.push(t);
    else byMerchant.set(t.merchant, [t]);
  }
  return [...byMerchant.values()]
    .sort((a, b) => b[b.length - 1]!.day - a[a.length - 1]!.day)
    .slice(0, CANCELLED_MAX)
    .map((list) => {
      const last = list[list.length - 1]!;
      const total = list.reduce((sum, t) => sum - t.amountCents - t.refunded, 0);
      return {
        id: `cancelled:${last.id}`,
        kind: "cancelled" as const,
        tone: "warning" as const,
        title: `${last.merchant} veloitti ${formatFiDate(last.bookingDate)}, vaikka merkitsit sen lopetetuksi.`,
        detail: list.length === 1 ? formatEur(total) : `${list.length} veloitusta, yhteensä ${formatEur(total)}`,
        merchant: last.merchant,
      };
    });
}
