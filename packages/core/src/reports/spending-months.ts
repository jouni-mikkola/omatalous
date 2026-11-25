// Decision: which category to cut: its sum over the period, its average month, and the months and payees behind it
import { spendingLabel } from "../category-names.ts";
import { getCategory } from "../categories.ts";
import { flowSpendOf } from "../analysis/counted.ts";
import { type AnalysisContext, spendRows } from "../analysis/context.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { fromMonthIndex } from "../dates.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { expectedLevel } from "../analysis/expected.ts";
import { type AgainstUsual, againstUsual, cardRowsMissingIn } from "../analysis/usual.ts";
import { largePurchases } from "../analysis/large.ts";
import { SPENDING_PAYEES } from "../thresholds.ts";
import { fullMonths, knownMonths, rangeMonthIndexes, whereKnown } from "./shared.ts";

interface SpendingPayee {
  name: string;
  cents: number;
  count: number;
}

interface SpendingCategory {
  category: string;
  label: string;
  /** One per month of `months`; null in a month the data does not reach (`knownMonths`). */
  values: (number | null)[];
  /** The sum of the category's rows over the range, those of a month the data does not reach too. */
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
}

export interface SpendingMonthsReport {
  /** `YYYY-MM`, oldest first: the months of the range the history reaches, 24 at most. */
  months: string[];
  /** The first day the sums count: the start of the range, or of `months` when the range is longer. A link to the rows starts here. */
  from: string;
  /** Per month: it has ended and the accounts were in the data from its 1st. An incomplete month is no monthly figure. */
  complete: boolean[];
  /** Spending per month (`spendRows`: consumption and debt service, a card's purchases on their own days); null in a month the data does not reach, which is no month's spending and in no average. */
  totals: (number | null)[];
  /** The sum of the rows of the range: `totals` and the months they leave out. */
  totalCents: number;
  /**
   * Per month, what `totals` holds of debt paid from a savings account (Säästöistä maksettu). Tulos and the first page's Menot
   * count it once, as Säästöön, so `totals` less this is the Menot of the first page.
   */
  fromSavings: (number | null)[];
  /** The sum of `fromSavings` and of the months it leaves out. */
  fromSavingsCents: number;
  /**
   * The expected level of the complete months' totals without their large purchases (`largePurchases`), which the
   * categories' levels add up to within rounding unless `cardGap`; null under `MIN_COMPARE_MONTHS` of them. The bars
   * and `totals` keep the large purchases.
   */
  typicalCents: number | null;
  /** `typicalCents` of the spending of the flows (`totals` less `fromSavings`): the usual month the first page's Menot are set against. */
  typicalFlowCents: number | null;
  /**
   * Per month, how far its Menot (`totals` less `fromSavings`, the base of `typicalFlowCents`) stand from
   * `typicalFlowCents`; null in a month that is not complete, without a level, or within the euro of it.
   */
  againstUsual: (AgainstUsual | null)[];
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
 * sum (but for purchases read off a card statement, which `statementCents` names). A month that has not
 * ended, or that the accounts do not cover, is shown and left out of the average month.
 */
export function spendingMonthsReport(ctx: AnalysisContext, range: DateRange, lang: Language = DEFAULT_LANGUAGE): SpendingMonthsReport {
  const indexes = rangeMonthIndexes(range, 24, ctx);
  const first = indexes[0]!;
  const months = indexes.map(fromMonthIndex);
  const shown = { from: range.from > `${months[0]}-01` ? range.from : `${months[0]}-01`, to: range.to };
  const full = new Set(fullMonths(ctx, range, indexes).map((m) => m - first));
  const complete = indexes.map((_, i) => full.has(i));
  const known = knownMonths(ctx, months);
  const totals = indexes.map(() => 0);
  const fromSavings = indexes.map(() => 0);
  const large = largePurchases(ctx);
  const largeTotals = indexes.map(() => 0);
  const largeFlowTotals = indexes.map(() => 0);
  const byCategory = new Map<string, { values: number[]; largeValues: number[]; payees: Map<string, SpendingPayee>; statementCents: number }>();
  const offStatement = new Set<unknown>(ctx.explained);
  for (const t of spendRows(ctx, toDayRange(shown))) {
    if (!t.spend || t.month < first) continue;
    const i = t.month - first;
    totals[i]! += t.spend;
    fromSavings[i]! += t.spend - flowSpendOf(t);
    const e = byCategory.get(t.category) ?? { values: indexes.map(() => 0), largeValues: indexes.map(() => 0), payees: new Map<string, SpendingPayee>(), statementCents: 0 };
    e.values[i]! += t.spend;
    // money back for a large purchase leaves with it (as in the themes), or the level is lowered by a refund of a sum it left out
    if (large.has(ctx.returns.get(t.id) ?? t.id)) {
      e.largeValues[i]! += t.spend;
      largeTotals[i]! += t.spend;
      largeFlowTotals[i]! += flowSpendOf(t);
    }
    if (offStatement.has(t)) e.statementCents += t.spend;
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
    .map(([category, { values, largeValues, payees, statementCents }]) => {
      const totalCents = values.reduce((s, v) => s + v, 0);
      const typicalCents = expectedLevel(categoryAt.map((i) => values[i]! - largeValues[i]!));
      const named = [...payees.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)).slice(0, SPENDING_PAYEES);
      return {
        category,
        label: spendingLabel(getCategory(category), lang),
        values: whereKnown(values, known),
        totalCents,
        typicalCents,
        lastDiffCents: typicalCents !== null && last !== null ? values[last]! - typicalCents : null,
        payees: named,
        otherPayeesCents: totalCents - named.reduce((s, p) => s + p.cents, 0),
        statementCents,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents || a.category.localeCompare(b.category));
  const typicalFlowCents = expectedLevel(completeAt.map((i) => totals[i]! - fromSavings[i]! - largeFlowTotals[i]!));
  return {
    months,
    from: shown.from,
    complete,
    // the cells of an unknown month are null, the sums still hold every row: money spent is money spent
    totals: whereKnown(totals, known),
    totalCents: totals.reduce((s, v) => s + v, 0),
    fromSavings: whereKnown(fromSavings, known),
    fromSavingsCents: fromSavings.reduce((s, v) => s + v, 0),
    typicalCents: expectedLevel(completeAt.map((i) => totals[i]! - largeTotals[i]!)),
    typicalFlowCents,
    againstUsual: indexes.map((_, i) => (complete[i] && known[i] ? againstUsual(totals[i]! - fromSavings[i]!, typicalFlowCents) : null)),
    typicalMonths: completeAt.length,
    categoryMonths: categoryAt.length,
    cardGap: categoryAt.length < completeAt.length,
    last,
    categories,
  };
}
