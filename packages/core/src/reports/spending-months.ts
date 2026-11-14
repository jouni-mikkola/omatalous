// Decision: which category to cut: its sum over the period, its average month, and the months and payees behind it
import { categoryLabel } from "../category-names.ts";
import { getCategory } from "../categories.ts";
import { type AnalysisContext, spendRows } from "../analysis/context.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { fromMonthIndex } from "../dates.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { expectedLevel } from "../analysis/expected.ts";
import { cardRowsMissingIn } from "../analysis/usual.ts";
import { largePurchases } from "../analysis/large.ts";
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
  /**
   * The expected level of the category over `categoryMonths` (`expectedLevel`, their mean) without its large purchases
   * (`largePurchases`); null under `MIN_COMPARE_MONTHS` of them.
   */
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
  /**
   * The expected level of the complete months' totals without their large purchases (`largePurchases`), which the
   * categories' levels add up to within rounding unless `cardGap`; null under `MIN_COMPARE_MONTHS` of them. The bars
   * and `totals` keep the large purchases.
   */
  typicalCents: number | null;
  /** How many months `typicalCents` is the level of. */
  typicalMonths: number;
  /**
   * How many months the categories' levels read: the complete months that hold a connected card's rows where the
   * newest one holds them (`cardRowsMissingIn`). Under `MIN_COMPARE_MONTHS` the categories have no level.
   */
  categoryMonths: number;
  /** Complete months were left out of the categories' levels: they come before a connected card's rows, which the newest complete month has in their categories. */
  cardGap: boolean;
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
  const large = largePurchases(ctx);
  const largeTotals = indexes.map(() => 0);
  const byCategory = new Map<string, { values: number[]; largeValues: number[]; payees: Map<string, SpendingPayee>; statementCents: number; lowered: boolean }>();
  const offStatement = new Set<unknown>(ctx.explained);
  for (const t of spendRows(ctx, toDayRange(shown))) {
    if (!t.spend || t.month < first) continue;
    const i = t.month - first;
    totals[i]! += t.spend;
    const e = byCategory.get(t.category) ?? { values: indexes.map(() => 0), largeValues: indexes.map(() => 0), payees: new Map<string, SpendingPayee>(), statementCents: 0, lowered: false };
    e.values[i]! += t.spend;
    // money back for a large purchase leaves with it (as in the themes), or the level is lowered by a refund of a sum it left out
    if (large.has(ctx.returns.get(t.id) ?? t.id)) {
      e.largeValues[i]! += t.spend;
      largeTotals[i]! += t.spend;
    }
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
  // A month before a connected card's rows begin has its purchases in no category (a bill at most), so it lowers the
  // level of every category the card buys in and the newest month looks dear. A category's level reads the months that
  // hold the card as the newest one does; the month totals stay comparable (a bill is spending). A bill paid early or
  // late moves no month out: a card never connected is a bill in every month.
  const gapAt = new Set(completeAt.filter((i) => cardRowsMissingIn(ctx, months[i]!)));
  const categoryAt = last === null ? [] : completeAt.filter((i) => gapAt.has(i) === gapAt.has(last));
  const categories = [...byCategory.entries()]
    .map(([category, { values, largeValues, payees, statementCents, lowered }]) => {
      const totalCents = values.reduce((s, v) => s + v, 0);
      const typicalCents = expectedLevel(categoryAt.map((i) => values[i]! - largeValues[i]!));
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
    typicalCents: expectedLevel(completeAt.map((i) => totals[i]! - largeTotals[i]!)),
    typicalMonths: completeAt.length,
    categoryMonths: categoryAt.length,
    cardGap: categoryAt.length < completeAt.length,
    last,
    categories,
  };
}
