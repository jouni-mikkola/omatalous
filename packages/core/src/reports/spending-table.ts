// Decision: which category to cut, read against the period before, a year ago and the last twelve months, fixed costs apart from the rest
import { getCategory } from "../categories.ts";
import type { AnalysisContext, AnalysisTx } from "../analysis/context.ts";
import { comparableWith } from "../analysis/coverage.ts";
import { spendSelect } from "../analysis/counted.ts";
import { type CategoryPart, categoryParts } from "../analysis/row-parts.ts";
import { largePurchases } from "../analysis/large.ts";
import { type DateRange, previousRange, toDayRange } from "../analysis/period.ts";
import { YEAR_MONTHS } from "../thresholds.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { addMonthsToDate, fromMonthIndex, monthEnd, monthIndex, monthOf } from "../dates.ts";
import { categoryLabel } from "../category-names.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { carsOf, placeLabel, placeOf, themeHeading } from "./shared.ts";

/** What a row spent on the accounts both periods have the whole of, in the period and in the one it is set beside. */
interface TableComparison {
  nowCents: number;
  thenCents: number;
  /** `nowCents - thenCents`, so the browser adds up nothing. */
  deltaCents: number;
}

export interface SpendingTableRow {
  /** `theme/category`: a category the car takes some rows of is a row in Auto and in its own group. */
  key: string;
  category: string;
  label: string;
  group: string;
  /** Consumption and debt service of the range, a refund taken off: the rows' sum is `SpendingTableReport.totalCents`. */
  totalCents: number;
  /** The part of `totalCents` that is fixed costs (subscriptions, bills, instalments; not card bills), and the rest. They add up to `totalCents`. */
  fixedCents: number;
  variableCents: number;
  /** The part of `totalCents` that is one-off purchases (`largePurchases`); inside `fixedCents` or `variableCents`, never both. */
  oneOffCents: number;
  /** Against the period before and the same days a year ago; null where the periods are not comparable. */
  previous: TableComparison | null;
  yearAgo: TableComparison | null;
  /** The twelve-month column: the row's spending in `SpendingTableReport.year`; null without such a period. */
  yearCents: number | null;
  /** The number of rows behind `totalCents`, for the drill. */
  count: number;
  /** The row's spending a level under it (`categoryParts`), adding up to `totalCents`; only when a build's extension told some of its rows. */
  parts?: CategoryPart[];
}

/** A named one-off purchase of the range. */
export interface TableOneOff {
  id: string;
  date: string;
  merchant: string;
  category: string;
  label: string;
  cents: number;
}

export interface SpendingTableReport {
  /** The days the range reaches, a running one ending today. */
  span: DateRange;
  totalCents: number;
  fixedCents: number;
  variableCents: number;
  oneOffCents: number;
  /** The periods the two comparisons are over; null when there is nothing to set beside. */
  periods: { previous: DateRange | null; yearAgo: DateRange | null };
  /** The twelve whole months before the end of the range and how many of them the history has; null without a whole month. The column adds up to `yearCents`. */
  year: (DateRange & { months: number; totalCents: number }) | null;
  /** The rows' comparison figures added up; null where the period has none. */
  totals: { previous: TableComparison | null; yearAgo: TableComparison | null };
  rows: SpendingTableRow[];
  oneOffs: TableOneOff[];
}

/** The days the range reaches, a running one ending today. */
const spanOf = (ctx: Pick<AnalysisContext, "today">, range: DateRange): DateRange => ({ from: range.from, to: range.to < ctx.today ? range.to : ctx.today });

/** The period right before (`previousRange`) and the same days a year earlier. */
function earlierSpans(span: DateRange): Record<"previous" | "yearAgo", DateRange> {
  const [from, to] = previousRange(span.from, span.to);
  return { previous: { from, to }, yearAgo: { from: addMonthsToDate(span.from, -12), to: addMonthsToDate(span.to, -12) } };
}

/** The twelve whole months that end with the last whole month of the range, the first one the history has a whole month of. */
function yearPeriod(ctx: AnalysisContext, span: DateRange): (DateRange & { months: number }) | null {
  const month = monthOf(span.to);
  const end = span.to === monthEnd(month) ? monthIndex(month) : monthIndex(month) - 1;
  let start = end - YEAR_MONTHS + 1;
  const first = ctx.dataFrom ? monthIndex(ctx.dataFrom) : Infinity;
  start = Math.max(start, first);
  while (start <= end && !isCompleteMonth(ctx, fromMonthIndex(start))) start++;
  if (start > end) return null;
  return { from: `${fromMonthIndex(start)}-01`, to: monthEnd(fromMonthIndex(end)), months: end - start + 1 };
}

/**
 * Spending by category as one table: the range, the same days before and a year ago on the accounts both have the whole
 * of, and the last twelve whole months. The rows are those of Kategoriat (`placeOf`), so every column adds up to its total
 * and the total is the figure of the question.
 */
export function spendingTableReport(ctx: AnalysisContext, range: DateRange, lang: Language = DEFAULT_LANGUAGE): SpendingTableReport {
  const span = spanOf(ctx, range);
  // the rows that count out of `spendRows` (context.ts), each bill at what its statement rows paid for
  const { counted } = spendSelect(ctx, toDayRange(range));
  const cars = carsOf(ctx, counted);
  const keyOf = (t: AnalysisTx) => placeOf(ctx, t, cars);
  const large = largePurchases(ctx);
  const byKey = new Map<string, SpendingTableRow>();
  const rowFor = (t: AnalysisTx): SpendingTableRow => {
    const { theme, key } = keyOf(t);
    let row = byKey.get(key);
    if (!row) {
      byKey.set(key, (row = { key, category: t.category, label: placeLabel(theme, t.category, categoryLabel(getCategory(t.category), lang), lang), group: themeHeading(theme, lang), totalCents: 0, fixedCents: 0, variableCents: 0, oneOffCents: 0, previous: null, yearAgo: null, yearCents: null, count: 0 }));
    }
    return row;
  };
  const oneOffs: TableOneOff[] = [];
  const rowsOf = new Map<string, AnalysisTx[]>();
  for (const t of counted) {
    const row = rowFor(t);
    if (ctx.rowParts) (rowsOf.get(row.key) ?? rowsOf.set(row.key, []).get(row.key)!).push(t);
    row.totalCents += t.spend;
    row.count += 1;
    // a card bill comes every month but pays everyday purchases: it is never fixed (fixed-variable.ts)
    if (ctx.fixedIds.has(t.id) && t.category !== "card_bill") row.fixedCents += t.spend;
    else row.variableCents += t.spend;
    if (large.has(t.id)) {
      row.oneOffCents += t.spend;
      oneOffs.push({ id: t.id, date: t.bookingDate, merchant: t.merchant, category: t.category, label: row.label, cents: t.spend });
    }
  }

  for (const row of byKey.values()) {
    const parts = categoryParts(rowsOf.get(row.key) ?? [], ctx.rowParts, row.category);
    if (parts) row.parts = parts;
  }

  const earlier = earlierSpans(span);
  const periods: SpendingTableReport["periods"] = { previous: null, yearAgo: null };
  for (const kind of ["previous", "yearAgo"] as const) {
    const shared = comparableWith(ctx, earlier[kind], span)?.shared;
    if (!shared || shared.size === 0) continue;
    periods[kind] = earlier[kind];
    const sums = (rows: readonly AnalysisTx[], into: Map<string, number>) => {
      for (const t of rows) if (shared.has(t.accountId)) into.set(keyOf(t).key, (into.get(keyOf(t).key) ?? 0) + t.spend);
    };
    const now = new Map<string, number>();
    const then = new Map<string, number>();
    sums(counted.filter((t) => t.bookingDate <= span.to), now);
    const thenRows = spendSelect(ctx, toDayRange(earlier[kind])).counted;
    sums(thenRows, then);
    // a category spent on only in the earlier period is a row too, at 0 now, so the rows add up to the periods' totals
    for (const t of thenRows) if (shared.has(t.accountId) && !byKey.has(keyOf(t).key)) rowFor(t);
    for (const [key, row] of byKey) {
      const nowCents = now.get(key) ?? 0;
      const thenCents = then.get(key) ?? 0;
      row[kind] = { nowCents, thenCents, deltaCents: nowCents - thenCents };
    }
  }

  const yearSpan = yearPeriod(ctx, span);
  let year: SpendingTableReport["year"] = null;
  if (yearSpan) {
    const yearRows = spendSelect(ctx, toDayRange(yearSpan)).counted;
    for (const t of yearRows) rowFor(t);
    for (const row of byKey.values()) row.yearCents = 0;
    let totalCents = 0;
    for (const t of yearRows) {
      byKey.get(keyOf(t).key)!.yearCents! += t.spend;
      totalCents += t.spend;
    }
    year = { ...yearSpan, totalCents };
  }

  // a row another period or the year column added has known zeroes in the comparisons it was not seen in
  for (const kind of ["previous", "yearAgo"] as const) {
    if (periods[kind]) for (const row of byKey.values()) row[kind] ??= { nowCents: 0, thenCents: 0, deltaCents: 0 };
  }
  const rows = [...byKey.values()]
    .filter((r) => r.totalCents !== 0 || r.fixedCents !== 0 || r.variableCents !== 0 || r.previous?.thenCents || r.previous?.nowCents || r.yearAgo?.thenCents || r.yearAgo?.nowCents || r.yearCents)
    .sort((a, b) => b.totalCents - a.totalCents || a.key.localeCompare(b.key));
  const sum = (pick: (r: SpendingTableRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const totalOf = (kind: "previous" | "yearAgo"): TableComparison | null => {
    if (!periods[kind]) return null;
    const nowCents = sum((r) => r[kind]?.nowCents ?? 0);
    const thenCents = sum((r) => r[kind]?.thenCents ?? 0);
    return { nowCents, thenCents, deltaCents: nowCents - thenCents };
  };
  return {
    span,
    totalCents: sum((r) => r.totalCents),
    fixedCents: sum((r) => r.fixedCents),
    variableCents: sum((r) => r.variableCents),
    oneOffCents: sum((r) => r.oneOffCents),
    periods,
    year,
    totals: { previous: totalOf("previous"), yearAgo: totalOf("yearAgo") },
    rows,
    oneOffs: oneOffs.sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id)),
  };
}
