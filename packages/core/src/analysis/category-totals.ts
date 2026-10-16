import { getCategory } from "../categories.ts";
import type { AnalysisTx } from "./context.ts";
import { spendingBase } from "./data-quality.ts";

/** The categories the first page names one by one, in the table and in the waterfall; the rest are one row, "Muut (n)". */
export const NAMED_CATEGORIES = 9;

export interface CategoryTotal {
  category: string;
  label: string;
  group: string;
  kind: string;
  cents: number;
  count: number;
  share: number;
  previousCents: number;
}

/**
 * Spending (consumption + debt) per category, with the previous period alongside. Both are the rows of `spendRows`. The rows add up to the spending of
 * `current`: a category that nets below zero (a refund that came a month after its payment, or money in the user put
 * on it by hand) is a row with its minus.
 */
export function categoryTotals(current: readonly AnalysisTx[], previous: readonly AnalysisTx[] = []): CategoryTotal[] {
  const totals = new Map<string, { cents: number; count: number }>();
  for (const t of current) {
    if (!t.spend) continue;
    const e = totals.get(t.category) ?? { cents: 0, count: 0 };
    e.cents += t.spend;
    e.count += 1;
    totals.set(t.category, e);
  }
  const prev = new Map<string, number>();
  for (const t of previous) if (t.spend) prev.set(t.category, (prev.get(t.category) ?? 0) + t.spend);
  const all = spendingBase(current);
  return [...totals.entries()]
    .filter(([, e]) => e.cents !== 0)
    .map(([category, e]) => {
      const c = getCategory(category);
      return { category, label: c.label, group: c.group, kind: c.kind, cents: e.cents, count: e.count, share: all ? e.cents / all : 0, previousCents: prev.get(category) ?? 0 };
    })
    .sort((a, b) => b.cents - a.cents);
}
