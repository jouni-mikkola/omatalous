import { type AnalysisContext, inDays, isPurchase } from "../analysis/context.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { dayNumber } from "../dates.ts";
import type { IsoDate } from "../types.ts";

/** A shop first seen three months after the history starts is new; before that, a usual place may not have come up yet. */
const NEW_AFTER_DAYS = 90;

export interface LargePurchase {
  id: string;
  date: IsoDate;
  merchant: string;
  category: string;
  cents: number;
  description: string | null;
}

export interface NewMerchant {
  merchant: string;
  category: string;
  firstDate: IsoDate;
  count: number;
  totalCents: number;
}


export interface HighlightsReport {
  largest: LargePurchase[];
  newMerchants: NewMerchant[];
}

/** Largest one-off purchases and the shops seen for the first time. */
export function highlightsReport(ctx: AnalysisContext, range: DateRange): HighlightsReport {
  const days = toDayRange(range);
  const purchases = inDays(ctx, days).filter((t) => t.flows.consumption > 0);

  // fixed costs (rent, subscriptions) are known already: surface the one-off big purchases
  const largest = purchases
    .filter((t) => !ctx.fixedIds.has(t.id) && isPurchase(t))
    .sort((a, b) => b.flows.consumption - a.flows.consumption)
    .slice(0, 15)
    .map((t) => ({ id: t.id, date: t.bookingDate, merchant: t.merchant, category: t.category, cents: t.flows.consumption, description: t.description }));

  const firstSeen = new Map<string, number>();
  for (const t of ctx.txs) if (t.flows.consumption > 0 && !firstSeen.has(t.merchant)) firstSeen.set(t.merchant, t.day);

  const byMerchant = new Map<string, { category: string; first: IsoDate; count: number; total: number }>();
  // payments to people and cash withdrawals are not new places to shop
  for (const t of purchases) {
    if (t.category === "p2p" || t.category === "cash") continue;
    const e = byMerchant.get(t.merchant) ?? { category: t.category, first: t.bookingDate, count: 0, total: 0 };
    e.count += 1;
    e.total += t.flows.consumption;
    byMerchant.set(t.merchant, e);
  }
  const entries = [...byMerchant.entries()];
  const historyStart = ctx.dataFrom ? dayNumber(ctx.dataFrom) : days.fromDay;
  return {
    largest,
    newMerchants: entries
      // near the start of the history every shop is new
      .filter(([m]) => (firstSeen.get(m) ?? 0) >= days.fromDay && (firstSeen.get(m) ?? 0) >= historyStart + NEW_AFTER_DAYS)
      .map(([merchant, e]) => ({ merchant, category: e.category, firstDate: e.first, count: e.count, totalCents: e.total }))
      .sort((a, b) => b.totalCents - a.totalCents)
      .slice(0, 15),
  };
}
