// Decision: cancel or renegotiate a contract that got dearer
import { getCategory } from "../categories.ts";
import { addMonthsToDate } from "../dates.ts";
import { type AnalysisContext, recurringAt } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import { priceChangeYearlyCents } from "../recurring.ts";
import type { IsoDate } from "../types.ts";

export interface PriceChangeItem {
  merchant: string;
  category: string;
  fromCents: number;
  toCents: number;
  date: IsoDate;
  /** What the change adds to a year of charges (negative for a cut). */
  yearlyEffectCents: number;
}

export interface PriceChangesReport {
  /** Latest first. Prices and loan instalments; a loan's category has kind "debt". */
  items: PriceChangeItem[];
  /** Price changes of goods and services only: a smaller loan instalment is not a cheaper price. */
  totalYearlyEffectCents: number;
  /** Loan instalments that grew or shrank (interest rates), apart from prices. */
  debtYearlyEffectCents: number;
}

/**
 * Price changes of subscriptions still running at the end of the range,
 * dated inside the range or in the 12 months before its end (so a short
 * range still shows this year's rises).
 */
export function priceChangesReport(ctx: AnalysisContext, range: DateRange): PriceChangesReport {
  const yearAgo = addMonthsToDate(range.to, -12);
  const from = range.from < yearAgo ? range.from : yearAgo;
  const items = recurringAt(ctx, range.to)
    .filter((s) => s.active && s.kind === "subscription" && s.priceChange && s.priceChange.date >= from && s.priceChange.date <= range.to)
    .filter((s) => ["expense", "debt"].includes(getCategory(s.category).kind))
    .map((s) => ({
      merchant: s.merchant,
      category: s.category,
      fromCents: s.priceChange!.fromCents,
      toCents: s.priceChange!.toCents,
      date: s.priceChange!.date,
      yearlyEffectCents: priceChangeYearlyCents(s)!,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.yearlyEffectCents - a.yearlyEffectCents);
  const isDebt = (i: PriceChangeItem) => getCategory(i.category).kind === "debt";
  const total = (list: PriceChangeItem[]) => list.reduce((s, i) => s + i.yearlyEffectCents, 0);
  return { items, totalYearlyEffectCents: total(items.filter((i) => !isDebt(i))), debtYearlyEffectCents: total(items.filter(isDebt)) };
}
