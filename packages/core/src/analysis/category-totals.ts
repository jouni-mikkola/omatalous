import { getCategory } from "../categories.ts";
import { SAME_UNDER_CENTS } from "../thresholds.ts";
import type { AnalysisTx } from "./context.ts";
import { spendingBase } from "./data-quality.ts";

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

/** One bar of the first page's "where the money went": a category's spending so far and the same days of the month before. */
interface TopCategory {
  category: string;
  label: string;
  /** The category's spending in the period, the figure of its row in `categories`. */
  cents: number;
  /** Its share of the bar of the largest category, 0 to 1: the length the page draws. */
  barShare: number;
  /**
   * The same days of the period before; null when the periods cannot be compared, and for a category with a row on an
   * account the earlier period lacks: its bar would be set against a sum of fewer accounts.
   */
  previousCents: number | null;
  /** `cents` less `previousCents`: above zero the category has cost more than by the same day before. */
  changeCents: number | null;
  /** The change as the page words it: under one euro is the same, and a category with nothing before is new. null without a comparison. */
  change: "more" | "less" | "same" | "new" | null;
  /** Where `previousCents` stands on the bar's scale, 0 to 1; null without a comparison. */
  previousShare: number | null;
}


/** The largest categories of the period and the sum of the others, which with the bars add up to the period's spending. */
export interface TopCategories {
  rows: TopCategory[];
  /** How many categories `otherCents` holds. */
  otherCount: number;
  otherCents: number;
  /** Every category's sum: the spending of the period. */
  totalCents: number;
}

/**
 * The `limit` largest categories with spending above zero, largest first, each with the same days of the period before.
 * The scale of the bars is the largest sum drawn, this period's or the earlier one's, so no mark falls off its bar.
 */
export function topCategories(categories: readonly (CategoryTotal & { comparedCents: number })[], comparable: boolean, limit = 5): TopCategories {
  const top = categories.filter((c) => c.cents > 0).slice(0, limit);
  // compared: the whole of the category is on the accounts both periods have, so the bar and the mark are sums of the same accounts
  const compared = (c: (typeof top)[number]) => comparable && c.comparedCents === c.cents;
  const scale = Math.max(1, ...top.map((c) => Math.max(c.cents, compared(c) ? c.previousCents : 0)));
  const totalCents = categories.reduce((sum, c) => sum + c.cents, 0);
  const rows = top.map((c): TopCategory => {
    const base = { category: c.category, label: c.label, cents: c.cents, barShare: c.cents / scale };
    if (!compared(c)) return { ...base, previousCents: null, changeCents: null, change: null, previousShare: null };
    const changeCents = c.cents - c.previousCents;
    const change = c.previousCents <= 0 ? "new" : Math.abs(changeCents) < SAME_UNDER_CENTS ? "same" : changeCents > 0 ? "more" : "less";
    return { ...base, previousCents: c.previousCents, changeCents, change, previousShare: Math.max(0, c.previousCents) / scale };
  });
  return { rows, otherCount: categories.length - top.length, otherCents: totalCents - top.reduce((sum, c) => sum + c.cents, 0), totalCents };
}
