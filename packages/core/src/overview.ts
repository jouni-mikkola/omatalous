/**
 * The figures of Yhteenveto that no other part of the dashboard gives: this month's income against the usual month's,
 * how far what the household has net moved in a month, the last twelve months of income and spending, and this month's
 * categories against their usual month. Every other part reads a figure of `nyt`, `home`, `ahead` or `holdings` as it is.
 */
import { addMonths, addMonthsToDate, monthOf } from "./dates.ts";
import { expectedIncome } from "./analysis/expected.ts";
import { earnedIncome } from "./analysis/usual.ts";
import type { AnalysisContext } from "./analysis/context.ts";
import { DEFAULT_LANGUAGE, type Language } from "./locale.ts";
import { accountsLessDebtOn } from "./reports/balances.ts";
import { spendingMonthsReport } from "./reports/spending-months.ts";
import type { BalanceInput, IsoDate, UserInputs } from "./types.ts";

/** How many months the chart of Yhteenveto draws, the running one included. */
const OVERVIEW_MONTHS = 12;
/** How many categories Yhteenveto names; the rest are one sum. */
const OVERVIEW_CATEGORIES = 6;

interface OverviewMonth {
  month: string;
  /** Earned income (`earnedIncome`): in the running month the Tulot tile's figure. */
  incomeCents: number;
  /** Spending as Raportit's Menot kuukausittain counts it (`spendingMonthsReport`): in the running month the Menot tile's figure. */
  spendCents: number;
  /** Ended, and the accounts were in the data from its 1st (`isCompleteMonth`). The running month never is. */
  complete: boolean;
}

interface OverviewCategory {
  category: string;
  label: string;
  /** This month's spending in the category so far. */
  cents: number;
  /** The category's usual month (`typicalCents` of Menot kuukausittain over the months of the chart); null without one. */
  usualCents: number | null;
}

export interface Overview {
  /**
   * The running month's earned income so far (`earnedIncome`) and the usual month's (`expectedIncome`, null under
   * `MIN_COMPARE_MONTHS` complete months): the same quantity, so the two compare.
   */
  income: { cents: number; usualCents: number | null };
  /**
   * The accounts less the debts today against the same day a month ago (`accountsLessDebtOn` both days): the change of
   * the Varat tile. Null when either day is not known.
   */
  net: { since: IsoDate; changeCents: number } | null;
  /** The months the history reaches of the last `OVERVIEW_MONTHS`, oldest first, the running month last. */
  months: OverviewMonth[];
  /** The usual month's spending over the complete months of `months` (`typicalCents` of Menot kuukausittain); null under three of them. */
  usualSpendCents: number | null;
  /** How many complete months `usualSpendCents` is the mean of, which the chart's key names. */
  usualMonths: number;
  /**
   * This month's largest `OVERVIEW_CATEGORIES` categories with spending above zero, largest first, and the rest as one
   * sum: `rows` and `otherCents` add up to `totalCents`, the running month's `spendCents`.
   */
  categories: { rows: OverviewCategory[]; otherCents: number; otherCount: number; totalCents: number; usualMonths: number };
}

export function buildOverview(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs, lang: Language = DEFAULT_LANGUAGE): Overview {
  const month = monthOf(ctx.today);
  const since = addMonthsToDate(ctx.today, -1);
  const now = accountsLessDebtOn(ctx, balances, inputs, ctx.today);
  const before = accountsLessDebtOn(ctx, balances, inputs, since);
  // one report, so a month's bar, the usual line and the categories are the sums Raportit shows for the same months
  const spending = spendingMonthsReport(ctx, { from: `${addMonths(month, 1 - OVERVIEW_MONTHS)}-01`, to: ctx.today }, lang);
  const at = spending.months.length - 1;
  const totalCents = spending.totals[at] ?? 0;
  const top = spending.categories
    .filter((c) => c.values[at]! > 0)
    .sort((a, b) => b.values[at]! - a.values[at]! || a.category.localeCompare(b.category))
    .slice(0, OVERVIEW_CATEGORIES)
    .map((c): OverviewCategory => ({ category: c.category, label: c.label, cents: c.values[at]!, usualCents: c.typicalCents }));
  return {
    income: { cents: earnedIncome(ctx, month), usualCents: expectedIncome(ctx, month) },
    net: now === null || before === null ? null : { since, changeCents: now - before },
    months: spending.months.map((m, i) => ({ month: m, incomeCents: earnedIncome(ctx, m), spendCents: spending.totals[i]!, complete: spending.complete[i]! })),
    usualSpendCents: spending.typicalCents,
    usualMonths: spending.typicalMonths,
    categories: {
      rows: top,
      otherCents: totalCents - top.reduce((sum, c) => sum + c.cents, 0),
      otherCount: spending.categories.filter((c) => c.values[at] !== 0).length - top.length,
      totalCents,
      // a category's usual reads its own months, fewer than the chart's when a card's rows are missing from some
      usualMonths: spending.categoryMonths,
    },
  };
}
