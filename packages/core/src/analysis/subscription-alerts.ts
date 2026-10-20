/**
 * The alerts that depend on what the user said about a subscription or an alert (marks): the question about a service
 * that may be forgotten, the warning about a charge after a cancellation, and the dismissed ids. `buildAlerts`
 * (alerts.ts) calls them. Also what a mark on a subscription covers: one series (`series:<key>`), or every series of
 * a merchant for a mark stored before marks named a series (`merchant:<name>`).
 */
import { addDays, addMonths, monthOf } from "../dates.ts";
import { parseSeriesId, type RecurringSeries, seriesId, type SeriesIdParts } from "../recurring.ts";
import type { IsoDate, MarkKind, UserMark } from "../types.ts";
import type { Alert } from "./alerts.ts";
import type { AnalysisTx } from "./context.ts";
import { formatEur, formatFiDate } from "./format.ts";

const ALERT_SUBJECT = "alert:";
const MERCHANT_SUBJECT = "merchant:";
const SERIES_SUBJECT = "series:";

/** The ids of the alerts the user said not to show again (the subject is `alert:<id>`). */
export function dismissedIds(marks: readonly UserMark[]): ReadonlySet<string> {
  return new Set(marks.filter((m) => m.mark === "dismissed" && m.subject.startsWith(ALERT_SUBJECT)).map((m) => m.subject.slice(ALERT_SUBJECT.length)));
}

/** What a mark reads of a series. The page's series, which come without their transaction ids, have all of it. */
export type MarkedSeries = Pick<RecurringSeries, "id" | "merchant" | "kind" | "typicalAmountCents" | "priceChange">;

/**
 * The parts a mark names a series by: those of its id, and for a subscription always its price. The id alone does not
 * last: it carries the price only while the merchant has several series on the account, so `out:<account>:Apple`
 * becomes `out:<account>:Apple#99` the day Apple charges for something else there, and a mark stored under the first
 * would be lost. A bill of varying size, a habit and income have no price to name and keep their id. Null for an id
 * `seriesId` did not make.
 */
function markParts(s: Pick<MarkedSeries, "id" | "kind" | "typicalAmountCents">): SeriesIdParts | null {
  const parts = parseSeriesId(s.id);
  if (!parts || parts.product !== null || s.kind !== "subscription") return parts;
  return { ...parts, product: s.typicalAmountCents };
}

/**
 * The subject of a mark on one series: `series:<direction>:<account>:<merchant>#<cents>`, the format of a series id
 * (ADR 0009). A new charge at the same price keeps it, and so does a second series of the merchant. After a change of
 * price the page would send another subject, and the mark stored under the old one still covers the series (`covers`).
 */
export function seriesMarkSubject(s: Pick<MarkedSeries, "id" | "kind" | "typicalAmountCents">): string {
  const parts = markParts(s);
  return SERIES_SUBJECT + (parts ? seriesId(parts) : s.id);
}

/** The series a mark's subject names, or null for a mark on a merchant or an alert and for a subject no series has. */
export function seriesOfMarkSubject(subject: string): SeriesIdParts | null {
  return subject.startsWith(SERIES_SUBJECT) ? parseSeriesId(subject.slice(SERIES_SUBJECT.length)) : null;
}

/**
 * A mark's subject after merchants got new names (old name to new), or null when it names none of them. A subject
 * follows when it names a merchant, or a series after its prefix: `series:<id>`, and the `loan-proposal:<id>` that
 * loan-detect.ts stores for "Ei laina". An alert's subject stays: its id is not a merchant's name.
 */
export function renamedMarkSubject(subject: string, renames: ReadonlyMap<string, string>): string | null {
  if (subject.startsWith(MERCHANT_SUBJECT)) {
    const to = renames.get(subject.slice(MERCHANT_SUBJECT.length));
    return to === undefined ? null : MERCHANT_SUBJECT + to;
  }
  if (subject.startsWith(ALERT_SUBJECT)) return null;
  const prefix = subject.slice(0, subject.indexOf(":") + 1);
  const parts = parseSeriesId(subject.slice(prefix.length));
  const to = parts ? renames.get(parts.merchant) : undefined;
  return parts && to !== undefined ? prefix + seriesId({ ...parts, merchant: to }) : null;
}

/**
 * Whether two prices can be one product's: within one euro or a tenth of each other, the width `clusterByAmount`
 * (recurring.ts) keeps one product's charges together by. Two series of one merchant on one account are always further
 * apart, so a mark never reaches the next series, and it holds through a currency's drift and a small rise.
 */
const samePrice = (a: number, b: number) => Math.abs(a - b) <= Math.max(100, 0.1 * Math.min(a, b));

/** Whether a mark on a series is on this one: the same merchant, account and direction, and for a price the same price. */
function isOn(mark: SeriesIdParts, s: MarkedSeries): boolean {
  const own = markParts(s);
  if (!own || own.direction !== mark.direction || own.accountId !== mark.accountId || own.merchant !== mark.merchant) return false;
  const price = mark.product;
  if (typeof price !== "number" || typeof own.product !== "number") return price === own.product;
  // the price in its id, the one it charges now and both sides of its last change: a rise does not shake the mark off
  return [own.product, s.typicalAmountCents, s.priceChange?.fromCents, s.priceChange?.toCents].some((cents) => cents !== undefined && samePrice(price, cents));
}

/**
 * The user's marks on subscriptions by what each covers: the merchant's name for a mark on a merchant (every series of
 * it: all marks were such before a mark named one series), the whole subject for a mark on one series. A merchant's
 * name holds no ":" (ADR 0009), so the two never meet. `covers` and `coveringMark` read the keys.
 */
export function marksBySubject(marks: readonly UserMark[]): ReadonlyMap<string, UserMark> {
  const out = new Map<string, UserMark>();
  for (const m of marks) {
    if (m.subject.startsWith(MERCHANT_SUBJECT)) out.set(m.subject.slice(MERCHANT_SUBJECT.length), m);
    else if (seriesOfMarkSubject(m.subject)) out.set(m.subject, m);
  }
  return out;
}

/** Whether the entry under a key of `marksBySubject` covers a series: its merchant's name, or a mark on the series itself. */
export function covers(key: string, s: MarkedSeries): boolean {
  if (key === s.merchant) return true;
  const mark = seriesOfMarkSubject(key);
  return mark !== null && isOn(mark, s);
}

const STRENGTH: Record<MarkKind, number> = { cancelled: 2, in_use: 1, dismissed: 0 };

/**
 * The entry that covers a series in a map keyed as `marksBySubject` keys it. Two can cover one series (its own mark
 * and an old one on its merchant): Lopetettu wins over Käytössä, and of two alike the later one (`at` gives its time).
 * The page offers a mark only on a series nothing covers, so it never stores such a pair itself.
 */
export function coveringMark<T extends { mark: MarkKind }>(byCover: ReadonlyMap<string, T>, s: MarkedSeries, at: (entry: T) => string): T | undefined {
  let best: T | undefined;
  for (const [key, entry] of byCover) {
    if (!covers(key, s)) continue;
    if (!best || STRENGTH[entry.mark] > STRENGTH[best.mark] || (entry.mark === best.mark && at(entry) > at(best))) best = entry;
  }
  return best;
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

/**
 * The mark on a series that counts on `today`: Lopetettu, or Käytössä said within twelve months. One rule for the
 * question on the overview and the rows of the recurring page.
 */
export function countingMark(marks: ReadonlyMap<string, UserMark>, s: MarkedSeries, today: IsoDate): UserMark | null {
  const mark = coveringMark(marks, s, (m) => m.markedAt);
  return mark && (mark.mark === "cancelled" || inUseQuietsQuestion(mark, today)) ? mark : null;
}

const FORGOTTEN_MAX = 2;

/** A price as a single charge shows it: whole euros stay whole, 10,99 keeps its cents. */
const price = (cents: number) => formatEur(cents, cents % 100 !== 0);

/**
 * A small service that has run for months. Not asked about when the user said it is in use (for a year) or cancelled.
 * `markSubject` is what an answer to the question is stored under: this series, not its merchant.
 */
export function forgotten(recurring: readonly RecurringSeries[], inOverlap: ReadonlySet<string>, marks: ReadonlyMap<string, UserMark>, today: IsoDate): (Alert & { markSubject: string })[] {
  return recurring
    .filter((s) => s.review && !inOverlap.has(s.merchant) && !countingMark(marks, s, today))
    .sort((a, b) => b.monthlyCents - a.monthlyCents)
    .slice(0, FORGOTTEN_MAX)
    .map((s) => ({
      id: `forgotten:${s.id}`,
      kind: "forgotten" as const,
      tone: "info" as const,
      title: `${s.merchant} ${price(s.monthlyCents)} kuussa, ${formatEur(s.yearlyCents, false)} vuodessa`,
      detail: `Maksettu ${s.monthsActive} kuukautta.`,
      merchant: s.merchant,
      markSubject: seriesMarkSubject(s),
    }));
}

const CANCELLED_MAX = 2;

/**
 * A card purchase is pending for a day or two before it books. A charge that books this soon after the mark was
 * made before it, so only a booking after these days says the cancellation did not take.
 */
const PENDING_GRACE_DAYS = 3;

/**
 * Whether a charge falls under a mark on one series: it is a charge of a series the mark is on, or it comes from that
 * merchant on that account at the marked price. The price catches a charge the series has not taken in, the series a
 * charge after a rise too large to be the same price. A mark without a price (a bill of varying size) has only the series.
 */
function chargeIsUnder(mark: SeriesIdParts, t: AnalysisTx, series: RecurringSeries | undefined): boolean {
  if (series && isOn(mark, series)) return true;
  return typeof mark.product === "number" && mark.direction === "out" && t.accountId === mark.accountId && t.merchant === mark.merchant && samePrice(mark.product, -t.amountCents);
}

/**
 * A subscription the user marked as cancelled charged again: the cancellation did not take, or the mark was a slip.
 * `charges` are the booked purchases of the period, oldest first, and `marks` come from `marksBySubject`. A mark on a
 * merchant counts every charge of the merchant, a mark on one series only the charges of that series: `recurring`
 * names them, and without it the price alone decides. One warning for each mark.
 */
export function chargedAfterCancelling(charges: readonly AnalysisTx[], marks: ReadonlyMap<string, UserMark>, recurring: readonly RecurringSeries[] = []): Alert[] {
  const onSeries = [...marks.values()].flatMap((m) => {
    const parts = m.mark === "cancelled" ? seriesOfMarkSubject(m.subject) : null;
    return parts ? [{ parts, mark: m }] : [];
  });
  const seriesOf = new Map<string, RecurringSeries>();
  if (onSeries.length) for (const s of recurring) for (const id of s.transactionIds) seriesOf.set(id, s);
  const byMark = new Map<string, AnalysisTx[]>();
  for (const t of charges) {
    const onMerchant = marks.get(t.merchant);
    let mark = onMerchant?.mark === "cancelled" ? onMerchant : undefined;
    // of two marks the later one counts, as in `coveringMark`
    for (const o of onSeries) if (chargeIsUnder(o.parts, t, seriesOf.get(t.id)) && (!mark || o.mark.markedAt > mark.markedAt)) mark = o.mark;
    // a charge the merchant paid back is settled
    if (!mark || t.bookingDate <= addDays(markedDay(mark), PENDING_GRACE_DAYS) || -t.amountCents - t.refunded <= 0) continue;
    const list = byMark.get(mark.subject);
    if (list) list.push(t);
    else byMark.set(mark.subject, [t]);
  }
  return [...byMark.values()]
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
