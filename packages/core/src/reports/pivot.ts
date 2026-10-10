import { getCategory } from "../categories.ts";
import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { completeMonths, monthLabels, rangeMonthIndexes } from "./shared.ts";

export interface PivotRow {
  category: string;
  label: string;
  group: string;
  values: number[];
  totalCents: number;
  averageCents: number;
}

export interface PivotReport {
  months: string[];
  rows: PivotRow[];
  monthTotals: number[];
  totalCents: number;
  /** Total per month over complete months (Ka/kk of the total row). */
  averageCents: number;
}

/** Category × month spending matrix (at most 24 months), largest categories first. */
export function pivotReport(ctx: AnalysisContext, range: DateRange): PivotReport {
  const months = rangeMonthIndexes(range);
  const first = months[0]!;
  const rows = new Map<string, { values: number[]; total: number }>();
  for (const t of inDays(ctx, toDayRange(range))) {
    if (!t.spend) continue;
    const e = rows.get(t.category) ?? { values: months.map(() => 0), total: 0 };
    // months older than the 24 shown count in the total only, so it equals the dashboard's for a long range
    if (t.month >= first) e.values[t.month - first]! += t.spend;
    e.total += t.spend;
    rows.set(t.category, e);
  }
  const averaged = completeMonths(ctx, range, months).map((m) => m - first);
  const out = [...rows.entries()]
    .map(([category, { values, total }]) => {
      const c = getCategory(category);
      const averageCents = Math.round(averaged.reduce((s, i) => s + values[i]!, 0) / averaged.length);
      return { category, label: c.label, group: c.group, values, totalCents: total, averageCents };
    })
    .filter((r) => r.totalCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents);
  // totals of the rows shown, so the table adds up (a category with more refunds than spending is left out)
  const monthTotals = months.map((_, i) => out.reduce((s, r) => s + r.values[i]!, 0));
  return {
    months: monthLabels(months),
    rows: out,
    monthTotals,
    totalCents: out.reduce((s, r) => s + r.totalCents, 0),
    averageCents: Math.round(averaged.reduce((s, i) => s + monthTotals[i]!, 0) / averaged.length),
  };
}
