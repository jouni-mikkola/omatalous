// Decision: where to cut
import { getCategory } from "../categories.ts";
import type { AnalysisContext, AnalysisTx } from "../analysis/context.ts";
import { comparableWith } from "../analysis/coverage.ts";
import { spendOf, spendSelect, sumOf } from "../analysis/counted.ts";
import { spendingBase } from "../analysis/data-quality.ts";
import { roundedShares } from "../analysis/bridge-view.ts";
import { printedParts } from "../analysis/printed.ts";
import { CATEGORY_COICOP, type PriceSplit, priceSplit } from "../analysis/prices.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { fromMonthIndex, monthIndex } from "../dates.ts";
import { totalsOf } from "../analysis/flows.ts";
import { type DateRange, previousRange, toDayRange } from "../analysis/period.ts";
import { type CategoryPart, categoryParts } from "../analysis/row-parts.ts";
import { median } from "../stats.ts";
import { THEMES } from "../themes.ts";
import { carsOf, fullMonths, placeLabel, placeOf, rangeMonthIndexes, themeHeading } from "./shared.ts";

export interface CategoryStat {
  category: string;
  label: string;
  /** The heading of its theme (`placeOf`), the theme of Menot kuukausittain with the same sum. A category may have a row in two groups. */
  group: string;
  kind: string;
  totalCents: number;
  /** Of the spending of the range. */
  share: number;
  /**
   * `share` as the whole percent the page prints, rounded with the other categories of its group so they add up to the
   * group's own (`GroupStat.shareUnits`); null below zero.
   */
  shareUnits: number | null;
  /** `totalCents` as the whole euros every panel prints: the group's categories rounded together into the euros their group prints (`printedParts`). */
  printedCents: number;
  /** `changeCents` the same way, into the change its group prints; null when not comparable. */
  printedChangeCents: number | null;
  /** Of the income of the range; null when there was none. */
  incomeShare: number | null;
  count: number;
  avgTxCents: number;
  /**
   * The four month figures are over the complete months of the range that the category's own accounts cover, as the
   * average of Menot kuukausittain is, and null without one: a running month is not a monthly figure.
   */
  monthlyAvgCents: number | null;
  /** The months the four figures are over ("N kuukauden keskiarvo"); 0 with none. */
  averageMonths: number;
  medianMonthCents: number | null;
  minMonthCents: number | null;
  maxMonthCents: number | null;
  monthsActive: number;
  previousCents: number;
  /** `totalCents` on the accounts both periods have the whole of: what `previousCents` is set against. 0 when not comparable. */
  comparedCents: number;
  /** `comparedCents` less `previousCents`, like for like on the same accounts; null when the periods are not comparable. */
  changeCents: number | null;
  /** Last 3 months vs the 3 before them, as a fraction; null when there is no base. */
  trend: number | null;
  /** The share of its spending that is fixed costs (`fixedIds`, as Kiinteät ja muuttuvat counts them), 0 to 1. */
  fixedShare: number;
  /**
   * The rise from `previousCents` to `comparedCents` split into the part prices explain and the part bought more, the
   * index of the months the period touches set against that of the previous period's. Null when it did not rise, the
   * periods are not comparable, or the category has no class or the months no valid index rows (the running month has none).
   */
  prices: PriceSplit | null;
  /** The category's spending a level under it (`categoryParts`), adding up to `totalCents`; only when a build's extension told some of its rows. */
  parts?: CategoryPart[];
}

export interface GroupStat {
  group: string;
  totalCents: number;
  /** Of the spending of the range. */
  share: number;
  /** `share` as the whole percent the page prints, the groups rounded together to the 100 % they are parts of; null below zero. */
  shareUnits: number | null;
  /** `totalCents` and `changeCents` as the whole euros printed, the groups rounded together into Yhteensä. */
  printedCents: number;
  printedChangeCents: number | null;
  /** Of the income of the range; null when there was none. */
  incomeShare: number | null;
  previousCents: number;
  comparedCents: number;
  /** The sum of its categories' `changeCents`; null when not comparable. */
  changeCents: number | null;
  /** Its categories' money a month over the complete months their accounts cover together, as a category's is; null without one. */
  monthlyAvgCents: number | null;
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
  /** `totalCents` on the accounts both periods have the whole of: what `previousTotalCents` is set against. 0 when not comparable. */
  comparedTotalCents: number;
  /** `comparedTotalCents` less `previousTotalCents`; null when not comparable. */
  changeCents: number | null;
  /** Income of the range, the base of `incomeShare`. */
  incomeCents: number;
  groups: GroupStat[];
}

/** Spending (consumption + debt) per group and category with monthly statistics. */
export function categoryReport(ctx: AnalysisContext, range: DateRange): CategoryReport {
  const months = rangeMonthIndexes(range, 120, ctx);
  const firstMonth = months[0]!;
  // the rows `spendRows` gives (context.ts), and the ones that count: the select `explain` lists
  const { rows: current, counted } = spendSelect(ctx, toDayRange(range));
  // a running period is compared with the same days of the previous one
  const [pf, pt] = previousRange(range.from, range.from <= ctx.today && ctx.today <= range.to ? ctx.today : range.to);
  // the accounts both periods have the whole of: a change is told on those on both sides, and none without any
  const shared = comparableWith(ctx, { from: pf, to: pt }, range)?.shared ?? null;
  const comparable = shared !== null;
  const onShared = (rows: readonly AnalysisTx[]) => rows.filter((t) => shared?.has(t.accountId));
  const monthsOf = (from: string, to: string) => Array.from({ length: monthIndex(to) - monthIndex(from) + 1 }, (_, i) => fromMonthIndex(monthIndex(from) + i));
  const previousMonths = monthsOf(pf, pt);
  const currentMonths = monthsOf(range.from, range.from <= ctx.today && ctx.today <= range.to ? ctx.today : range.to);
  const previous = shared ? onShared(spendSelect(ctx, toDayRange({ from: pf, to: pt })).counted) : [];

  // each row in the group Menot kuukausittain places it in, so a group is its theme to the cent
  const cars = carsOf(ctx, counted);
  const keyOf = (t: AnalysisTx) => placeOf(ctx, t, cars).key;
  const perCategory = new Map<string, { monthly: number[]; total: number; count: number; fixed: number; accounts: Set<string> }>();
  const rowsOf = new Map<string, AnalysisTx[]>();
  for (const t of counted) {
    const key = keyOf(t);
    if (ctx.rowParts) (rowsOf.get(key) ?? rowsOf.set(key, []).get(key)!).push(t);
    const e = perCategory.get(key) ?? { monthly: months.map(() => 0), total: 0, count: 0, fixed: 0, accounts: new Set<string>() };
    // a card bill comes every month but pays everyday purchases: it is never fixed (fixed-variable.ts)
    if (ctx.fixedIds.has(t.id) && t.category !== "card_bill") e.fixed += t.spend;
    e.accounts.add(t.accountId);
    // months before the shown ones (ranges over ten years) count in the total only
    if (t.month >= firstMonth) e.monthly[t.month - firstMonth]! += t.spend;
    e.total += t.spend;
    e.count += 1;
    perCategory.set(key, e);
  }
  const prev = new Map<string, number>();
  for (const t of previous) prev.set(keyOf(t), (prev.get(keyOf(t)) ?? 0) + t.spend);
  // this period on the same accounts, what a change is measured on
  const comparedNow = new Map<string, number>();
  for (const t of onShared(counted)) comparedNow.set(keyOf(t), (comparedNow.get(keyOf(t)) ?? 0) + t.spend);
  const averaged = fullMonths(ctx, range, months);
  // trend: the last three complete months against the three before them, so six complete months or none
  const trendEnd = averaged.length ? averaged[averaged.length - 1]! : null;
  const trendSums = new Map<string, [number, number]>();
  if (trendEnd !== null && isCompleteMonth(ctx, fromMonthIndex(trendEnd - 5))) {
    for (const t of ctx.txs) {
      if (!t.spend || t.month > trendEnd || t.month <= trendEnd - 6) continue;
      const key = keyOf(t);
      const e = trendSums.get(key) ?? [0, 0];
      e[t.month > trendEnd - 3 ? 0 : 1] += t.spend;
      trendSums.set(key, e);
    }
  }

  // refunds are taken off, so the total is the expense of the cashflow report and a category with more refunds than
  // spending is a row with a minus; a share is of the categories that net above zero, so none passes 100 %
  const total = sumOf(counted, spendOf);
  const base = spendingBase(current);
  const income = totalsOf(current.map((t) => t.flows)).incomeCents;
  const ofIncome = (cents: number) => (income > 0 ? cents / income : null);
  // a category spent on in the previous period only is a row too, at 0 now, so the changes add up to the total change
  const spent = new Set([...perCategory].filter(([, e]) => e.total !== 0).map(([key]) => key));
  for (const [key, cents] of prev) if (cents !== 0) spent.add(key);
  const none = { monthly: months.map(() => 0), total: 0, count: 0, fixed: 0, accounts: new Set<string>() };

  // each row's months and accounts, for its group's average
  const entryOf = new Map<string, typeof none>();
  const stats: CategoryStat[] = [...spent]
    .map((key) => {
      const [theme, category] = key.split("/") as [string, string];
      const e = perCategory.get(key) ?? none;
      entryOf.set(`${themeHeading(theme)}/${category}`, e);
      const c = getCategory(category);
      const [recent, before] = trendSums.get(key) ?? [0, 0];
      // a category spent on in the previous period only has no account of its own: 0 over the household's months
      const averagedAt = fullMonths(ctx, range, months, e.accounts.size ? e.accounts : undefined).map((m) => m - firstMonth);
      const parts = categoryParts(rowsOf.get(key) ?? [], ctx.rowParts, category);
      return {
        category,
        label: placeLabel(theme, category, c.label),
        group: themeHeading(theme),
        kind: c.kind,
        totalCents: e.total,
        share: base ? e.total / base : 0,
        shareUnits: null as number | null,
      printedCents: 0,
      printedChangeCents: null as number | null,
        incomeShare: ofIncome(e.total),
        count: e.count,
        avgTxCents: e.count ? Math.round(e.total / e.count) : 0,
        monthlyAvgCents: averagedAt.length ? Math.round(averagedAt.reduce((sum, i) => sum + e.monthly[i]!, 0) / averagedAt.length) : null,
        // whole cents: the middle two months may average to half a cent
        medianMonthCents: averagedAt.length ? Math.round(median(averagedAt.map((i) => e.monthly[i]!))) : null,
        minMonthCents: averagedAt.length ? Math.min(...averagedAt.map((i) => e.monthly[i]!)) : null,
        maxMonthCents: averagedAt.length ? Math.max(...averagedAt.map((i) => e.monthly[i]!)) : null,
        averageMonths: averagedAt.length,
        monthsActive: e.monthly.filter((v) => v > 0).length,
        previousCents: prev.get(key) ?? 0,
        comparedCents: comparedNow.get(key) ?? 0,
        changeCents: comparable ? (comparedNow.get(key) ?? 0) - (prev.get(key) ?? 0) : null,
        trend: before > 0 ? (recent - before) / before : null,
        fixedShare: e.total > 0 ? Math.min(1, Math.max(0, e.fixed / e.total)) : 0,
        prices: comparable ? priceSplit(CATEGORY_COICOP[category], { cents: prev.get(key) ?? 0, months: previousMonths }, { cents: comparedNow.get(key) ?? 0, months: currentMonths }, ctx.today) : null,
        ...(parts ? { parts } : {}),
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents || b.previousCents - a.previousCents || a.category.localeCompare(b.category));

  const groups = THEMES.map((theme) => theme.heading).map((group) => {
    const categories = stats.filter((s) => s.group === group);
    const groupTotal = categories.reduce((s, c) => s + c.totalCents, 0);
    const entries = categories.map((c) => entryOf.get(`${c.group}/${c.category}`) ?? none);
    const accounts = new Set(entries.flatMap((e) => [...e.accounts]));
    const averagedAt = fullMonths(ctx, range, months, accounts.size ? accounts : undefined).map((m) => m - firstMonth);
    return {
      group,
      totalCents: groupTotal,
      share: base ? groupTotal / base : 0,
      shareUnits: null as number | null,
      incomeShare: ofIncome(groupTotal),
      previousCents: categories.reduce((s, c) => s + c.previousCents, 0),
      comparedCents: categories.reduce((s, c) => s + c.comparedCents, 0),
      changeCents: comparable ? categories.reduce((s, c) => s + c.changeCents!, 0) : null,
      monthlyAvgCents: averagedAt.length ? Math.round(averagedAt.reduce((sum, i) => sum + entries.reduce((t, e) => t + e.monthly[i]!, 0), 0) / averagedAt.length) : null,
      categories,
    };
  })
    .filter((g) => g.categories.length)
    .sort((a, b) => b.totalCents - a.totalCents || b.previousCents - a.previousCents);

  // the printed shares: the groups rounded together to 100, the categories of a group to the share their group prints
  // (a category in two groups is a row in each, so each row has its own copy)
  const groupUnits = roundedShares(groups.map((g) => g.totalCents), base);
  // the printed euros: groups rounded together into Yhteensä, each group's categories into the euros their group prints,
  // changes the same way, so every column adds up as printed and every panel quotes the same figure (ADR 0004)
  const groupEuros = printedParts(groups.map((g) => g.totalCents), total);
  const groupMoves = comparable ? printedParts(groups.map((g) => g.changeCents), groups.reduce((s, g) => s + g.changeCents!, 0)) : groups.map(() => null);
  const printedGroups = groups.map((g, gi) => {
    const units = roundedShares(g.categories.map((c) => c.totalCents), base, 0, groupUnits[gi] ?? undefined);
    const euros = printedParts(g.categories.map((c) => c.totalCents), g.totalCents, groupEuros[gi]!);
    const moves = g.changeCents === null ? g.categories.map(() => null) : printedParts(g.categories.map((c) => c.changeCents), g.changeCents, groupMoves[gi]!);
    return {
      ...g,
      shareUnits: groupUnits[gi] ?? null,
      printedCents: groupEuros[gi]!,
      printedChangeCents: groupMoves[gi] ?? null,
      categories: g.categories.map((c, ci) => ({ ...c, shareUnits: units[ci] ?? null, printedCents: euros[ci]!, printedChangeCents: moves[ci] ?? null })),
    };
  });
  const previousTotalCents = stats.reduce((s, c) => s + c.previousCents, 0);
  const comparedTotalCents = stats.reduce((s, c) => s + c.comparedCents, 0);
  return { comparable, totalCents: total, previousTotalCents, comparedTotalCents, changeCents: comparable ? comparedTotalCents - previousTotalCents : null, incomeCents: income, groups: printedGroups };
}
