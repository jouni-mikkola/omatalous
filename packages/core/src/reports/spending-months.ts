// Decision: which category to cut: its sum over the period, its average month, and the months and payees behind it
import { categoryLabel } from "../category-names.ts";
import { getCategory } from "../categories.ts";
import { type AnalysisContext, spendRows } from "../analysis/context.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { fromMonthIndex } from "../dates.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { expectedLevel } from "../analysis/expected.ts";
import { SPENDING_PAYEES } from "../thresholds.ts";
import { fullMonths, rangeMonthIndexes } from "./shared.ts";

interface SpendingPayee {
  name: string;
  cents: number;
  count: number;
}

interface SpendingCategory {
  category: string;
  label: string;
  /** One per month of `months`. */
  values: number[];
  /** The sum of `values`. */
  totalCents: number;
  /** The expected level of the category's complete months (`expectedLevel`, their mean); null under `MIN_COMPARE_MONTHS` of them. */
  typicalCents: number | null;
  /** The newest complete month less `typicalCents`; null without either. */
  lastDiffCents: number | null;
  /** The largest payees over the months shown, and the rest of them as one sum, so they add up to `totalCents`. */
  payees: SpendingPayee[];
  otherPayeesCents: number;
  /**
   * The part of `totalCents` that is purchases read off a card statement. Tapahtumat lists the bank's rows, so these are
   * in the sum and not in its list. 0 without statements.
   */
  statementCents: number;
  /** A card bill of this category counts here at what its statement rows leave of it, while Tapahtumat lists the bill whole. */
  lowered: boolean;
}

export interface SpendingMonthsReport {
  /** `YYYY-MM`, oldest first: the months of the range the history reaches, 24 at most. */
  months: string[];
  /** The first day the sums count: the start of the range, or of `months` when the range is longer. A link to the rows starts here. */
  from: string;
  /** Per month: it has ended and the accounts were in the data from its 1st. An incomplete month is no monthly figure. */
  complete: boolean[];
  /** Spending per month (`spendRows`: consumption and debt service, a card's purchases on their own days). */
  totals: number[];
  /** The sum of `totals`. */
  totalCents: number;
  /** The expected level of the complete months' totals, which the categories' levels add up to within rounding; null under `MIN_COMPARE_MONTHS` of them. */
  typicalCents: number | null;
  /** How many months `typicalCents` is the level of. */
  typicalMonths: number;
  /** Index in `months` of the newest complete month; null without one. */
  last: number | null;
  /** Every category with a row in the months shown, largest first. In every month their values add up to the month's total. */
  categories: SpendingCategory[];
}

/**
 * Spending by month and by category over the months of the range. A row counts in the month of its day and in its own
 * category, so a month's column, a category's column and the rows Tapahtumat lists for that month and category are one
 * sum (but for purchases read off a card statement, which `statementCents` and `lowered` name). A month that has not
 * ended, or that the accounts do not cover, is shown and left out of the average month.
 */
export function spendingMonthsReport(ctx: AnalysisContext, range: DateRange, lang: Language = DEFAULT_LANGUAGE): SpendingMonthsReport {
  const indexes = rangeMonthIndexes(range, 24, ctx);
  const first = indexes[0]!;
  const months = indexes.map(fromMonthIndex);
  const shown = { from: range.from > `${months[0]}-01` ? range.from : `${months[0]}-01`, to: range.to };
  const full = new Set(fullMonths(ctx, range, indexes).map((m) => m - first));
  const complete = indexes.map((_, i) => full.has(i));
  const totals = indexes.map(() => 0);
  const byCategory = new Map<string, { values: number[]; payees: Map<string, SpendingPayee>; statementCents: number; lowered: boolean }>();
  const offStatement = new Set<unknown>(ctx.explained);
  for (const t of spendRows(ctx, toDayRange(shown))) {
    if (!t.spend || t.month < first) continue;
    const i = t.month - first;
    totals[i]! += t.spend;
    const e = byCategory.get(t.category) ?? { values: indexes.map(() => 0), payees: new Map<string, SpendingPayee>(), statementCents: 0, lowered: false };
    e.values[i]! += t.spend;
    if (offStatement.has(t)) e.statementCents += t.spend;
    if (ctx.lowered.has(t.id)) e.lowered = true;
    // by the name Tapahtumat filters on, so a payee's link opens the rows of its sum
    const name = t.merchant;
    const payee = e.payees.get(name) ?? { name, cents: 0, count: 0 };
    payee.cents += t.spend;
    payee.count += 1;
    e.payees.set(name, payee);
    byCategory.set(t.category, e);
  }
  const completeAt = indexes.map((_, i) => i).filter((i) => complete[i]);
  const last = completeAt.length ? completeAt[completeAt.length - 1]! : null;
  const categories = [...byCategory.entries()]
    .map(([category, { values, payees, statementCents, lowered }]) => {
      const totalCents = values.reduce((s, v) => s + v, 0);
      const typicalCents = expectedLevel(completeAt.map((i) => values[i]!));
      const named = [...payees.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)).slice(0, SPENDING_PAYEES);
      return {
        category,
        label: categoryLabel(getCategory(category), lang),
        values,
        totalCents,
        typicalCents,
        lastDiffCents: typicalCents !== null && last !== null ? values[last]! - typicalCents : null,
        payees: named,
        otherPayeesCents: totalCents - named.reduce((s, p) => s + p.cents, 0),
        statementCents,
        lowered,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents || a.category.localeCompare(b.category));
  return {
    months,
    from: shown.from,
    complete,
    totals,
    totalCents: totals.reduce((s, v) => s + v, 0),
    typicalCents: expectedLevel(completeAt.map((i) => totals[i]!)),
    typicalMonths: completeAt.length,
    last,
    categories,
  };
}
