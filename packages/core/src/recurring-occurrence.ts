/** A merchant's charges folded to one occurrence a day: what the cadence fit and the cost of recurring.ts read. */
import type { IsoDate, Transaction } from "./types.ts";

export type SeriesInput = Pick<Transaction, "id" | "accountId" | "bookingDate" | "amountCents" | "merchant" | "category" | "isTransfer" | "status">;

export interface Occurrence {
  date: IsoDate;
  cents: number; // positive
  ids: string[];
}

/** Two charges differ when they are at least 50 cents and 3 % apart. */
export function amountsDiffer(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff >= 50 && diff >= 0.03 * Math.max(a, b);
}

export function toOccurrences(txs: readonly SeriesInput[]): Occurrence[] {
  const byDate = new Map<IsoDate, Occurrence>();
  for (const t of txs) {
    const o = byDate.get(t.bookingDate) ?? { date: t.bookingDate, cents: 0, ids: [] };
    o.cents += Math.abs(t.amountCents);
    o.ids.push(t.id);
    byDate.set(t.bookingDate, o);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
