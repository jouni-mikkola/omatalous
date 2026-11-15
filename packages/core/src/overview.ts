/**
 * The figures of Yhteenveto that no other part of the dashboard gives: this month's income and its earned part,
 * the last twelve months of income and spending, and this month's categories against their usual month. Every other part reads a figure of `nyt`, `home`, `ahead` or `holdings` as it is.
 */
import { addMonths, monthOf } from "./dates.ts";
import { earnedIncome, monthIncome } from "./analysis/usual.ts";
import type { AnalysisContext } from "./analysis/context.ts";
import { DEFAULT_LANGUAGE, type Language } from "./locale.ts";
import { spendingMonthsReport } from "./reports/spending-months.ts";

/** How many months the chart of Yhteenveto draws, the running one included. */
const OVERVIEW_MONTHS = 12;
/** How many categories Yhteenveto names; the rest are one sum. */
const OVERVIEW_CATEGORIES = 6;

interface OverviewMonth {
  month: string;
  /** All income (`monthIncome`, Tulot): in the running month Yhteenveto's Tulot. */
  incomeCents: number;
  /**
   * Spending as the bridge counts it (`flowSpendOf`, the consumption and debt of the flows): in the running month Yhteenveto's
   * Menot. Income less this, less what went to savings, is Tulos. A debt paid from a savings account is not in it
   * (it is Säästöön), which Raportit's Menot kuukausittain counts as spending: `fromSavingsCents` is the difference.
   */
  spendCents: number;
  /** What the month's rows of Raportit's Menot kuukausittain hold beyond `spendCents`: debt paid from a savings account (`fromSavings` of `spendingMonthsReport`). */
  fromSavingsCents: number;
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
   * The running month's income so far (`monthIncome`, the month's Tulot of the income report) and the earned part of it
   * (`earnedIncome`, Ansiotulot). Tulot shows the first; the second is its sub-line when it differs. There is no usual
   * of the first: Tavalliset tulot is the mean of the second, so it stays on the income report.
   */
  income: { cents: number; earnedCents: number };
  /** The months the history reaches of the last `OVERVIEW_MONTHS`, oldest first, the running month last. */
  months: OverviewMonth[];
  /** The usual month's spending over the complete months of `months`, on the base of the bars (`typicalFlowCents` of Menot kuukausittain, without large purchases); null under three of them. */
  usualSpendCents: number | null;
  /** How many complete months `usualSpendCents` is the mean of, which the chart's key names. */
  usualMonths: number;
  /**
   * This month's largest `OVERVIEW_CATEGORIES` categories with spending above zero, largest first, and the rest as one
   * sum, as the categories of Raportit count them. `totalCents` is the running month's `spendCents`, Menot of Yhteenveto.
   * The categories also hold the debt paid from a savings account, which Menot leaves out (`fromSavingsCents`):
   * `rows` and `otherCents` add up to `totalCents` and `fromSavingsCents` together.
   */
  categories: { rows: OverviewCategory[]; otherCents: number; otherCount: number; totalCents: number; fromSavingsCents: number; usualMonths: number };
}

export function buildOverview(ctx: AnalysisContext, lang: Language = DEFAULT_LANGUAGE): Overview {
  const month = monthOf(ctx.today);
  // one report, so a month's bar, the usual line and the categories are the sums Raportit shows for the same months
  const spending = spendingMonthsReport(ctx, { from: `${addMonths(month, 1 - OVERVIEW_MONTHS)}-01`, to: ctx.today }, lang);
  const at = spending.months.length - 1;
  // the months' Menot are the bridge's spending, so a month's bars and Tulos add up; the report's sum is that and the debt paid from savings
  const spent = spending.totals.map((cents, i) => cents - spending.fromSavings[i]!);
  const totalCents = spent[at] ?? 0;
  const top = spending.categories
    .filter((c) => c.values[at]! > 0)
    .sort((a, b) => b.values[at]! - a.values[at]! || a.category.localeCompare(b.category))
    .slice(0, OVERVIEW_CATEGORIES)
    .map((c): OverviewCategory => ({ category: c.category, label: c.label, cents: c.values[at]!, usualCents: c.typicalCents }));
  return {
    income: { cents: monthIncome(ctx, month), earnedCents: earnedIncome(ctx, month) },
    months: spending.months.map((m, i) => ({ month: m, incomeCents: monthIncome(ctx, m), spendCents: spent[i]!, fromSavingsCents: spending.fromSavings[i]!, complete: spending.complete[i]! })),
    usualSpendCents: spending.typicalFlowCents,
    usualMonths: spending.typicalMonths,
    categories: {
      rows: top,
      otherCents: (spending.totals[at] ?? 0) - top.reduce((sum, c) => sum + c.cents, 0),
      otherCount: spending.categories.filter((c) => c.values[at] !== 0).length - top.length,
      totalCents,
      fromSavingsCents: spending.fromSavings[at] ?? 0,
      // a category's usual reads its own months, fewer than the chart's when a card's rows are missing from some
      usualMonths: spending.categoryMonths,
    },
  };
}
