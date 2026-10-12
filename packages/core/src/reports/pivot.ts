// Decision: find the month a category jumped
import { getCategory } from "../categories.ts";
import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { fullMonths, monthLabels, rangeMonthIndexes } from "./shared.ts";

export interface PivotRow {
  category: string;
  label: string;
  group: string;
  values: number[];
  totalCents: number;
  /** Over the complete months of the range; null without one (a running month is not a monthly figure). */
  averageCents: number | null;
}

export interface PivotReport {
  months: string[];
  /** Per month: it has ended, the range covers it from the 1st and the history does too. An incomplete month is "vajaa". */
  complete: boolean[];
  rows: PivotRow[];
  monthTotals: number[];
  totalCents: number;
  /** Total per month over complete months (the average of the total row); null without a complete month. */
  averageCents: number | null;
}

/** Category × month spending matrix (at most 24 months), largest categories first. */
export function pivotReport(ctx: AnalysisContext, range: DateRange): PivotReport {
  const months = rangeMonthIndexes(range, 24, ctx);
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
  const full = fullMonths(ctx, range, months);
  const averaged = full.map((m) => m - first);
  const out = [...rows.entries()]
    .map(([category, { values, total }]) => {
      const c = getCategory(category);
      const averageCents = averaged.length ? Math.round(averaged.reduce((s, i) => s + values[i]!, 0) / averaged.length) : null;
      return { category, label: c.label, group: c.group, values, totalCents: total, averageCents };
    })
    // a category with more refunds than spending stays, below the others with its minus: the totals are then the
    // expense of the cashflow report, and the rows add up to them
    .filter((r) => r.totalCents !== 0 || r.values.some((v) => v !== 0))
    .sort((a, b) => b.totalCents - a.totalCents);
  const monthTotals = months.map((_, i) => out.reduce((s, r) => s + r.values[i]!, 0));
  return {
    months: monthLabels(months),
    complete: months.map((m) => full.includes(m)),
    rows: out,
    monthTotals,
    totalCents: out.reduce((s, r) => s + r.totalCents, 0),
    averageCents: averaged.length ? Math.round(averaged.reduce((s, i) => s + monthTotals[i]!, 0) / averaged.length) : null,
  };
}
