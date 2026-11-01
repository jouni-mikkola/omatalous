// Decision: which category is over the goal the household set for it, and which has no goal yet
import { getCategory } from "../categories.ts";
import { categoryLabel } from "../category-names.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { type AnalysisContext } from "../analysis/context.ts";
import { GOAL_CATEGORIES, goalSpend, proposedGoal, singleMonth } from "../analysis/category-goals.ts";
import type { DateRange } from "../analysis/period.ts";
import { monthEnd, monthOf } from "../dates.ts";
import type { UserInputs } from "../types.ts";

export interface CategoryGoalRow {
  category: string;
  label: string;
  /** The goal for one month; null when the household has set none. */
  goalCents: number | null;
  /** The expected month of the category in whole euros, to offer where no goal is set; null without a figure. */
  proposedCents: number | null;
  /** What the category spent in the range; null when the range is not one month, since a goal is a month's. */
  spentCents: number | null;
  /** `spentCents - goalCents`: positive is over. null without a goal or a month. */
  deltaCents: number | null;
  /** The number of rows behind `spentCents`. */
  count: number;
}

export interface CategoryGoalsReport {
  /** The month the range is from its first day, null for any other range. */
  month: string | null;
  /** False while the month is still running or the range stops short of its end: its spending so far is set beside the whole month's goal, so a gap below the goal is what is left. */
  complete: boolean;
  rows: CategoryGoalRow[];
  /**
   * The rows that have a goal, added up: `goalCents` the goals, `spentCents` what those categories spent and
   * `deltaCents` their difference, so the rows add up to the totals. null without a goal or a month.
   */
  total: { goalCents: number; spentCents: number; deltaCents: number } | null;
  /** The categories with no goal, for the sentence that says so. */
  missing: string[];
}

/**
 * Goals against the month's spending, one row per goal category. The goals are the household's own (`inputs`), proposals
 * come from the expected figure of the month of today.
 */
export function categoryGoalsReport(ctx: AnalysisContext, range: DateRange, inputs: UserInputs, lang: Language = DEFAULT_LANGUAGE): CategoryGoalsReport {
  const goals = inputs.categoryGoals ?? {};
  const month = singleMonth(range);
  const spent = month ? goalSpend(ctx, range) : null;
  // a goal is for the month ahead of the household, whichever month is on view
  const proposalMonth = monthOf(ctx.today);
  const rows: CategoryGoalRow[] = GOAL_CATEGORIES.map((category) => {
    const goalCents = goals[category] ?? null;
    const spentCents = spent?.get(category)?.cents ?? null;
    return {
      category,
      label: categoryLabel(getCategory(category), lang),
      goalCents,
      proposedCents: goalCents === null ? proposedGoal(ctx, proposalMonth, category) : null,
      spentCents,
      deltaCents: goalCents !== null && spentCents !== null ? spentCents - goalCents : null,
      count: spent?.get(category)?.count ?? 0,
    };
  });
  const withGoal = rows.filter((r) => r.goalCents !== null);
  const total =
    month && withGoal.length > 0
      ? {
          goalCents: withGoal.reduce((s, r) => s + r.goalCents!, 0),
          spentCents: withGoal.reduce((s, r) => s + r.spentCents!, 0),
          deltaCents: withGoal.reduce((s, r) => s + r.deltaCents!, 0),
        }
      : null;
  return { month, complete: month !== null && range.to >= monthEnd(month) && ctx.today >= monthEnd(month), rows, total, missing: rows.filter((r) => r.goalCents === null).map((r) => r.label) };
}
