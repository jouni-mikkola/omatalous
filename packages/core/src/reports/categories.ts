import { CATEGORY_GROUPS, getCategory } from "../categories.ts";
import { type AnalysisContext, historyCovers, inDays } from "../analysis/context.ts";
import { type DateRange, previousRange, toDayRange } from "../analysis/period.ts";
import { median } from "../stats.ts";
import { completeMonths, rangeMonthIndexes } from "./shared.ts";

export interface CategoryStat {
  category: string;
  label: string;
  group: string;
  kind: string;
  totalCents: number;
  share: number;
  count: number;
  avgTxCents: number;
  monthlyAvgCents: number;
  medianMonthCents: number;
  minMonthCents: number;
  maxMonthCents: number;
  monthsActive: number;
  previousCents: number;
  /** Last 3 months vs the 3 before them, as a fraction; null when there is no base. */
  trend: number | null;
}

export interface GroupStat {
  group: string;
  totalCents: number;
  share: number;
  previousCents: number;
  categories: CategoryStat[];
}

export interface CategoryReport {
  /** False when the history does not cover the previous period: previous numbers are 0 then. */
  comparable: boolean;
  totalCents: number;
  groups: GroupStat[];
}

/** Spending (consumption + debt) per group and category with monthly statistics. */
export function categoryReport(ctx: AnalysisContext, range: DateRange): CategoryReport {
  const months = rangeMonthIndexes(range, 120);
  const firstMonth = months[0]!;
  const current = inDays(ctx, toDayRange(range));
  // a running period is compared with the same days of the previous one
  const [pf, pt] = previousRange(range.from, range.from <= ctx.today && ctx.today <= range.to ? ctx.today : range.to);
  const comparable = historyCovers(ctx, pf);
  // a previous period before the history starts would show every category as new
  const previous = comparable ? inDays(ctx, toDayRange({ from: pf, to: pt })) : [];

  const perCategory = new Map<string, { monthly: number[]; total: number; count: number }>();
  for (const t of current) {
    if (!t.spend) continue;
    const e = perCategory.get(t.category) ?? { monthly: months.map(() => 0), total: 0, count: 0 };
    // months before the shown ones (ranges over ten years) count in the total only
    if (t.month >= firstMonth) e.monthly[t.month - firstMonth]! += t.spend;
    e.total += t.spend;
    e.count += 1;
    perCategory.set(t.category, e);
  }
  const prev = new Map<string, number>();
  for (const t of previous) if (t.spend) prev.set(t.category, (prev.get(t.category) ?? 0) + t.spend);
  const averaged = completeMonths(ctx, range, months);
  const averagedAt = averaged.map((m) => m - firstMonth);
  // trend: the last three complete months against the three before them
  const trendEnd = averaged[averaged.length - 1]!;
  const trendSums = new Map<string, [number, number]>();
  for (const t of ctx.txs) {
    if (!t.spend || t.month > trendEnd || t.month <= trendEnd - 6) continue;
    const e = trendSums.get(t.category) ?? [0, 0];
    e[t.month > trendEnd - 3 ? 0 : 1] += t.spend;
    trendSums.set(t.category, e);
  }

  let total = 0;
  for (const e of perCategory.values()) if (e.total > 0) total += e.total;

  const stats: CategoryStat[] = [...perCategory.entries()]
    .filter(([, e]) => e.total > 0)
    .map(([category, e]) => {
      const c = getCategory(category);
      const [recent, before] = trendSums.get(category) ?? [0, 0];
      return {
        category,
        label: c.label,
        group: c.group,
        kind: c.kind,
        totalCents: e.total,
        share: total ? e.total / total : 0,
        count: e.count,
        avgTxCents: Math.round(e.total / e.count),
        monthlyAvgCents: Math.round(averagedAt.reduce((sum, i) => sum + e.monthly[i]!, 0) / averagedAt.length),
        // whole cents: the middle two months may average to half a cent
        medianMonthCents: Math.round(median(averagedAt.map((i) => e.monthly[i]!))),
        minMonthCents: Math.min(...averagedAt.map((i) => e.monthly[i]!)),
        maxMonthCents: Math.max(...averagedAt.map((i) => e.monthly[i]!)),
        monthsActive: e.monthly.filter((v) => v > 0).length,
        previousCents: prev.get(category) ?? 0,
        trend: before > 0 ? (recent - before) / before : null,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);

  const groups = CATEGORY_GROUPS.map((group) => {
    const categories = stats.filter((s) => s.group === group);
    const groupTotal = categories.reduce((s, c) => s + c.totalCents, 0);
    return {
      group,
      totalCents: groupTotal,
      share: total ? groupTotal / total : 0,
      previousCents: categories.reduce((s, c) => s + c.previousCents, 0),
      categories,
    };
  })
    .filter((g) => g.categories.length)
    .sort((a, b) => b.totalCents - a.totalCents);

  return { comparable, totalCents: total, groups };
}
