// Decision: where to cut
import { CATEGORY_GROUPS, getCategory } from "../categories.ts";
import { type AnalysisContext, historyCovers, spendRows } from "../analysis/context.ts";
import { spendingBase } from "../analysis/data-quality.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { fromMonthIndex } from "../dates.ts";
import { totalsOf } from "../analysis/flows.ts";
import { type DateRange, previousRange, toDayRange } from "../analysis/period.ts";
import { median } from "../stats.ts";
import { fullMonths, rangeMonthIndexes } from "./shared.ts";

export interface CategoryStat {
  category: string;
  label: string;
  group: string;
  kind: string;
  totalCents: number;
  /** Of the spending of the range. */
  share: number;
  /** Of the income of the range; null when there was none. */
  incomeShare: number | null;
  count: number;
  avgTxCents: number;
  /** The four month figures are null without a complete month in the range: a running month is not a monthly figure. */
  monthlyAvgCents: number | null;
  medianMonthCents: number | null;
  minMonthCents: number | null;
  maxMonthCents: number | null;
  monthsActive: number;
  previousCents: number;
  /** Last 3 months vs the 3 before them, as a fraction; null when there is no base. */
  trend: number | null;
}

export interface GroupStat {
  group: string;
  totalCents: number;
  /** Of the spending of the range. */
  share: number;
  /** Of the income of the range; null when there was none. */
  incomeShare: number | null;
  previousCents: number;
  categories: CategoryStat[];
}

export interface CategoryReport {
  /** False when the history does not cover the previous period: previous numbers are 0 then. */
  comparable: boolean;
  totalCents: number;
  /**
   * Spending of the previous period, the sum of the rows' `previousCents`: a category with spending in either period
   * is a row, so the changes of the rows add up to `totalCents - previousTotalCents`. 0 when not comparable.
   */
  previousTotalCents: number;
  /** Income of the range, the base of `incomeShare`. */
  incomeCents: number;
  groups: GroupStat[];
}

/** Spending (consumption + debt) per group and category with monthly statistics. */
export function categoryReport(ctx: AnalysisContext, range: DateRange): CategoryReport {
  const months = rangeMonthIndexes(range, 120, ctx);
  const firstMonth = months[0]!;
  const current = spendRows(ctx, toDayRange(range));
  // a running period is compared with the same days of the previous one
  const [pf, pt] = previousRange(range.from, range.from <= ctx.today && ctx.today <= range.to ? ctx.today : range.to);
  const comparable = historyCovers(ctx, pf);
  // a previous period before the history starts would show every category as new
  const previous = comparable ? spendRows(ctx, toDayRange({ from: pf, to: pt })) : [];

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
  const averaged = fullMonths(ctx, range, months);
  const averagedAt = averaged.map((m) => m - firstMonth);
  // trend: the last three complete months against the three before them, so six complete months or none
  const trendEnd = averaged.length ? averaged[averaged.length - 1]! : null;
  const trendSums = new Map<string, [number, number]>();
  if (trendEnd !== null && isCompleteMonth(ctx, fromMonthIndex(trendEnd - 5))) {
    for (const t of ctx.txs) {
      if (!t.spend || t.month > trendEnd || t.month <= trendEnd - 6) continue;
      const e = trendSums.get(t.category) ?? [0, 0];
      e[t.month > trendEnd - 3 ? 0 : 1] += t.spend;
      trendSums.set(t.category, e);
    }
  }

  // refunds are taken off, so the total is the expense of the cashflow report and a category with more refunds than
  // spending is a row with a minus; a share is of the categories that net above zero, so none passes 100 %
  const total = current.reduce((s, t) => s + t.spend, 0);
  const base = spendingBase(current);
  const income = totalsOf(current.map((t) => t.flows)).incomeCents;
  const ofIncome = (cents: number) => (income > 0 ? cents / income : null);
  // a category spent on in the previous period only is a row too, at 0 now, so the changes add up to the total change
  const spent = new Set([...perCategory].filter(([, e]) => e.total !== 0).map(([category]) => category));
  for (const [category, cents] of prev) if (cents !== 0) spent.add(category);
  const none = { monthly: months.map(() => 0), total: 0, count: 0 };

  const stats: CategoryStat[] = [...spent]
    .map((category) => {
      const e = perCategory.get(category) ?? none;
      const c = getCategory(category);
      const [recent, before] = trendSums.get(category) ?? [0, 0];
      return {
        category,
        label: c.label,
        group: c.group,
        kind: c.kind,
        totalCents: e.total,
        share: base ? e.total / base : 0,
        incomeShare: ofIncome(e.total),
        count: e.count,
        avgTxCents: e.count ? Math.round(e.total / e.count) : 0,
        monthlyAvgCents: averagedAt.length ? Math.round(averagedAt.reduce((sum, i) => sum + e.monthly[i]!, 0) / averagedAt.length) : null,
        // whole cents: the middle two months may average to half a cent
        medianMonthCents: averagedAt.length ? Math.round(median(averagedAt.map((i) => e.monthly[i]!))) : null,
        minMonthCents: averagedAt.length ? Math.min(...averagedAt.map((i) => e.monthly[i]!)) : null,
        maxMonthCents: averagedAt.length ? Math.max(...averagedAt.map((i) => e.monthly[i]!)) : null,
        monthsActive: e.monthly.filter((v) => v > 0).length,
        previousCents: prev.get(category) ?? 0,
        trend: before > 0 ? (recent - before) / before : null,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents || b.previousCents - a.previousCents || a.category.localeCompare(b.category));

  const groups = CATEGORY_GROUPS.map((group) => {
    const categories = stats.filter((s) => s.group === group);
    const groupTotal = categories.reduce((s, c) => s + c.totalCents, 0);
    return {
      group,
      totalCents: groupTotal,
      share: base ? groupTotal / base : 0,
      incomeShare: ofIncome(groupTotal),
      previousCents: categories.reduce((s, c) => s + c.previousCents, 0),
      categories,
    };
  })
    .filter((g) => g.categories.length)
    .sort((a, b) => b.totalCents - a.totalCents || b.previousCents - a.previousCents);

  return { comparable, totalCents: total, previousTotalCents: stats.reduce((s, c) => s + c.previousCents, 0), incomeCents: income, groups };
}
