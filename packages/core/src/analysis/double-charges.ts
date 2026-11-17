/**
 * Charges made twice: the same charge on one account and day, and a monthly bill charged again within days. One
 * definition for the alert (alerts.ts) and for Tarkistettavat's money-back question (money-back.ts), so both name the
 * same charges. A charge the merchant has paid back is no finding, and neither is a merchant that does it routinely.
 * Decision: the household asks a merchant for money back when a charge came twice.
 */
import { BILL_DOUBLE_DAYS, DOUBLE_MIN_CENTS } from "../thresholds.ts";
import { UNKNOWN_MERCHANT } from "../merchant.ts";
import type { RecurringSeries } from "../recurring.ts";
import type { IsoDate } from "../types.ts";
import type { AnalysisContext, AnalysisTx } from "./context.ts";
import { type DateRange, toDayRange } from "./period.ts";

/** A booked purchase from a known merchant: money that left and may come back. */
export const isCharge = (t: AnalysisTx) =>
  t.status === "booked" && !t.isTransfer && t.amountCents < 0 && t.kind !== "transfer" && t.merchant !== UNKNOWN_MERCHANT;

/** One charge made `count` times: `dates` is its one day, or the two days of a bill charged again. */
interface DoubleCharge {
  /** Stable for the same data: `double:<id of the last row>`. */
  id: string;
  merchant: string;
  /** What one charge came to, positive. */
  amountCents: number;
  count: number;
  /** The days it was charged on, oldest first: the one day, or the bill's two. */
  dates: IsoDate[];
  rowIds: string[];
}

/**
 * Identical charges on one account and day, and how often each merchant does it.
 * Over the whole history and independent of the range, so the dashboard's
 * several periods share one scan.
 */
const sameDayCache = new WeakMap<AnalysisContext, { groups: AnalysisTx[][]; routine: Map<string, number> }>();

function sameDayCharges(ctx: AnalysisContext) {
  const hit = sameDayCache.get(ctx);
  if (hit) return hit;
  const sameDay = new Map<string, AnalysisTx[]>();
  for (const t of ctx.txs) {
    if (!isCharge(t)) continue;
    const key = `${t.accountId}|${t.merchant}|${t.amountCents}|${t.bookingDate}`;
    const group = sameDay.get(key);
    if (group) group.push(t);
    else sameDay.set(key, [t]);
  }
  // two tickets at the cinema every time: a merchant that does this routinely is not a mistake
  const groups: AnalysisTx[][] = [];
  const routine = new Map<string, number>();
  for (const group of sameDay.values()) {
    if (group.length < 2) continue;
    groups.push(group);
    const key = `${group[0]!.accountId}|${group[0]!.merchant}`;
    routine.set(key, (routine.get(key) ?? 0) + 1);
  }
  const result = { groups, routine };
  sameDayCache.set(ctx, result);
  return result;
}

/** The charges made twice whose last charge falls in `range`, the latest first. `current` is the range's rows. */
export function findDoubleCharges(ctx: AnalysisContext, current: readonly AnalysisTx[], recurring: readonly RecurringSeries[], range: DateRange): DoubleCharge[] {
  const { fromDay, toDay } = toDayRange(range);
  const { groups, routine } = sameDayCharges(ctx);

  const out: DoubleCharge[] = [];
  for (const group of groups) {
    const t = group[group.length - 1]!;
    if (group.length < 2 || t.day < fromDay || t.day > toDay || -t.amountCents < DOUBLE_MIN_CENTS) continue;
    // the merchant has already paid one of them back
    if (group.some((x) => x.refunded >= -x.amountCents)) continue;
    if ((routine.get(`${t.accountId}|${t.merchant}`) ?? 0) - 1 >= 2) continue;
    out.push({ id: `double:${t.id}`, merchant: t.merchant, amountCents: -t.amountCents, count: group.length, dates: [t.bookingDate], rowIds: group.map((x) => x.id) });
  }

  // a monthly bill paid twice a few days apart (an e-invoice and a reminder of it)
  const inRange = new Map(current.map((t) => [t.id, t]));
  const byId = new Map<string, AnalysisTx>();
  for (const s of recurring) {
    if (s.cadence !== "monthly" || (s.kind !== "subscription" && s.kind !== "bill")) continue;
    if (!s.transactionIds.some((id) => inRange.has(id))) continue;
    if (!byId.size) for (const t of ctx.txs) byId.set(t.id, t);
    const rows = s.transactionIds
      .map((id) => byId.get(id))
      .filter((t): t is AnalysisTx => !!t && isCharge(t))
      .sort((a, b) => a.day - b.day);
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1]!, rows[i]!];
      const gap = b.day - a.day;
      if (gap < 1 || gap > BILL_DOUBLE_DAYS || a.amountCents !== b.amountCents || -b.amountCents < DOUBLE_MIN_CENTS || !inRange.has(b.id)) continue;
      // the biller has already paid one of them back
      if (a.refunded >= -a.amountCents || b.refunded >= -b.amountCents) continue;
      out.push({ id: `double:${b.id}`, merchant: b.merchant, amountCents: -b.amountCents, count: 2, dates: [a.bookingDate, b.bookingDate], rowIds: [a.id, b.id] });
    }
  }
  // the latest first
  return out.sort((a, b) => b.dates[b.dates.length - 1]!.localeCompare(a.dates[a.dates.length - 1]!));
}
