// Decision: which category to cut: its sum over the period, its average month, and the months and payees behind it
import { spendingLabel } from "../category-names.ts";
import { getCategory } from "../categories.ts";
import { flowSpendOf } from "../analysis/counted.ts";
import { type AnalysisContext, spendRows } from "../analysis/context.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { fromMonthIndex } from "../dates.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { expectedLevel } from "../analysis/expected.ts";
import { type AgainstUsual, againstUsual, cardRowsMissingIn, gateFor } from "../analysis/usual.ts";
import { largePurchases } from "../analysis/large.ts";
import { MIN_COMPARE_MONTHS, SPENDING_CHANGE_STEPS, SPENDING_PAYEES } from "../thresholds.ts";
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
   * The expected level of the category (`expectedLevel`, the mean of its months) without its large purchases
   * (`largePurchases`); null under `MIN_COMPARE_MONTHS` of them. A category that holds a card's purchases (or the card's
   * bill) reads the `categoryMonths`; every other category reads every complete month, as a card connected late is no
   * part of its history.
   */
  typicalCents: number | null;
  /** The newest complete month less `typicalCents`; null without either. */
  lastDiffCents: number | null;
  /** The newest complete month stands off `typicalCents` by at least the gate of the level (`gateFor`), on either side. False without a level. */
  lastOff: boolean;
  /** The largest payees over the months shown, and the rest of them as one sum, so they add up to `totalCents`. */
  payees: SpendingPayee[];
  otherPayeesCents: number;
  /**
   * The part of `totalCents` that is purchases read off a card statement. Tapahtumat lists the bank's rows, so these are
   * in the sum and not in its list. 0 without statements.
   */
  statementCents: number;
}

/** A step of the waterfall from the usual month to a month: a category's gap to its level, between the running sums `fromCents` and `toCents`. */
interface SpendingChangeStep {
  /** The category's id and name; null for the step of the categories with no level (`withoutLevel`) and for the one last step that holds the gaps of all the others, which is there only when they do not cancel out. */
  category: string | null;
  label: string | null;
  /** The step is what the categories with no level (a card connected late, a category with under `MIN_COMPARE_MONTHS` months) spent in the month: it has no gap, the whole sum is the step. Absent on every other step. */
  withoutLevel?: true;
  /** The gap in cents: above zero is more than the category's level. */
  cents: number;
  fromCents: number;
  toCents: number;
}

/**
 * A month set against the usual month, category by category: `startCents` (the levels of the categories that have one,
 * which is the column "Keskimäärin kuussa" added up) plus the steps is `endCents`, the month's spending, to the cent.
 */
interface SpendingChange {
  startCents: number;
  steps: SpendingChangeStep[];
  endCents: number;
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
  /**
   * Per month, the waterfall from the usual month: the categories whose gap is the largest (`SPENDING_CHANGE_STEPS`, a
   * euro or more each), the rises first, then what the categories with no level spent in the month as one step
   * (`withoutLevel`, there when it is not zero), and the rest of the gaps as one last step. The start is the levels added
   * up, so it is the sum of the categories' monthly averages. Null in a month that is not one of the months the levels
   * read: the `categoryMonths` while the card's categories have a level, else every complete month; and null when no category has a level.
   */
  changes: (SpendingChange | null)[];
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
  const byCategory = new Map<string, { values: number[]; largeValues: number[]; payees: Map<string, SpendingPayee>; statementCents: number; cardLinked: boolean }>();
  const offStatement = new Set<unknown>(ctx.explained);
  const cards = new Set(ctx.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  for (const t of spendRows(ctx, toDayRange(shown))) {
    if (!t.spend || t.month < first) continue;
    const i = t.month - first;
    totals[i]! += t.spend;
    fromSavings[i]! += t.spend - flowSpendOf(t);
    const e = byCategory.get(t.category) ?? { values: indexes.map(() => 0), largeValues: indexes.map(() => 0), payees: new Map<string, SpendingPayee>(), statementCents: 0, cardLinked: t.category === "card_bill" };
    e.values[i]! += t.spend;
    if (cards.has(t.accountId) || offStatement.has(t)) e.cardLinked = true;
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
  // only a category that holds the card's purchases or its bill is short of months before the card: the rent and the
  // other categories of the accounts that were there all along keep every complete month
  const typicalCents = expectedLevel(completeAt.map((i) => totals[i]! - largeTotals[i]!));
  const categories = [...byCategory.entries()]
    .map(([category, { values, largeValues, payees, statementCents, cardLinked }]) => {
      const totalCents = values.reduce((s, v) => s + v, 0);
      const levelAt = cardLinked ? categoryAt : completeAt;
      const typicalCents = expectedLevel(levelAt.map((i) => values[i]! - largeValues[i]!));
      const named = [...payees.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)).slice(0, SPENDING_PAYEES);
      return {
        category,
        label: spendingLabel(getCategory(category), lang),
        values: whereKnown(values, known),
        totalCents,
        typicalCents,
        lastDiffCents: typicalCents !== null && last !== null ? values[last]! - typicalCents : null,
        lastOff: typicalCents !== null && last !== null && Math.abs(values[last]! - typicalCents) >= gateFor(typicalCents),
        payees: named,
        otherPayeesCents: totalCents - named.reduce((s, p) => s + p.cents, 0),
        statementCents,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents || a.category.localeCompare(b.category));
  // the months the card's categories have a level in, or every complete month when they have none: they are then in the last step
  const changeAt = categoryAt.length >= MIN_COMPARE_MONTHS ? categoryAt : completeAt;
  const changes = indexes.map((_, i) => (known[i] && changeAt.includes(i) ? changeOf(i, categories, totals[i]!) : null));
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
    typicalCents,
    typicalFlowCents,
    againstUsual: indexes.map((_, i) => (complete[i] && known[i] ? againstUsual(totals[i]! - fromSavings[i]!, typicalFlowCents) : null)),
    typicalMonths: completeAt.length,
    categoryMonths: categoryAt.length,
    cardGap: categoryAt.length < completeAt.length,
    last,
    changes,
    categories,
  };
}

/**
 * The waterfall of month `i`. It starts from the levels of the categories that have one, so the start is the sum of the
 * column the page names it after. What the categories with no level spent in the month is its own step, so the steps
 * still end at the month's spending; null when no category has a level.
 */
function changeOf(i: number, categories: readonly { category: string; label: string; values: (number | null)[]; typicalCents: number | null }[], endCents: number): SpendingChange | null {
  const gaps: { category: string; label: string; cents: number }[] = [];
  let levelsCents = 0;
  let withoutLevelCents = 0;
  for (const c of categories) {
    if (c.typicalCents === null) {
      withoutLevelCents += c.values[i] ?? 0;
      continue;
    }
    levelsCents += c.typicalCents;
    gaps.push({ category: c.category, label: c.label, cents: (c.values[i] ?? 0) - c.typicalCents });
  }
  const startCents = levelsCents;
  if (gaps.length === 0) return null;
  // a gap that rounds to no euro is no step; the largest are named, a rise stands before a fall
  const named = gaps
    .filter((g) => Math.round(Math.abs(g.cents) / 100) !== 0)
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.category.localeCompare(b.category))
    .slice(0, SPENDING_CHANGE_STEPS)
    .sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
  const steps: SpendingChangeStep[] = [];
  let running = startCents;
  for (const g of named) {
    steps.push({ category: g.category, label: g.label, cents: g.cents, fromCents: running, toCents: running + g.cents });
    running += g.cents;
  }
  if (withoutLevelCents !== 0) {
    steps.push({ category: null, label: null, withoutLevel: true, cents: withoutLevelCents, fromCents: running, toCents: running + withoutLevelCents });
    running += withoutLevelCents;
  }
  // the gaps of the others are one last step, left out when they cancel out
  if (endCents !== running) steps.push({ category: null, label: null, cents: endCents - running, fromCents: running, toCents: endCents });
  return { startCents, steps, endCents };
}
