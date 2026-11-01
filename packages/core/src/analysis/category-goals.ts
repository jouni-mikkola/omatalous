/**
 * Decision: does a category the household set a goal for stay within it this month, and what goal to propose where none
 * is set. Beside the one monthly goal (`spending-goal.ts`), never in place of it: a category goal is not part of that
 * sum. Spending is the rows `spendSelect` counts out of `spendRows` (context.ts), each bill at what its statement rows
 * paid for, so a category's figure here is the one of Kategoriat.
 */
import { getCategory } from "../categories.ts";
import { monthEnd, monthOf } from "../dates.ts";
import { MAX_CATEGORY_GOAL_CENTS, MIN_CATEGORY_GOAL_CENTS } from "../thresholds.ts";
import type { IsoDate } from "../types.ts";
import type { AnalysisContext } from "./context.ts";
import { spendSelect } from "./counted.ts";
import { expectedFor } from "./expected.ts";
import { type DateRange, toDayRange } from "./period.ts";

/** The categories a goal can be set for: food, restaurants and transport first (public transport, and the car with fuel and parking). */
export const GOAL_CATEGORIES = ["groceries", "restaurants", "transport", "car"] as const;

export const isGoalCategory = (id: string): boolean => (GOAL_CATEGORIES as readonly string[]).includes(id);

/** What each goal category spent in the range, a refund taken off, and the number of rows behind it. */
export function goalSpend(ctx: AnalysisContext, range: DateRange): Map<string, { cents: number; count: number }> {
  const out = new Map<string, { cents: number; count: number }>(GOAL_CATEGORIES.map((c) => [c, { cents: 0, count: 0 }]));
  for (const t of spendSelect(ctx, toDayRange(range)).counted) {
    const slot = out.get(t.category);
    if (!slot) continue;
    slot.cents += t.spend;
    slot.count += 1;
  }
  return out;
}

/**
 * The goal to propose for `category` in `month`: the expected whole month of the category (ADR 0021) in whole euros.
 * null without an expected figure, with the category not itemised, or under a euro.
 */
export function proposedGoal(ctx: AnalysisContext, month: string, category: string): number | null {
  const expected = expectedFor(ctx, month);
  if (!expected?.itemised) return null;
  const found = expected.at().categories.find((c) => c.category === category)?.cents ?? 0;
  const cents = Math.round(found / 100) * 100;
  // inside the bounds the route accepts, so a proposal can always be accepted
  return cents >= MIN_CATEGORY_GOAL_CENTS && cents <= MAX_CATEGORY_GOAL_CENTS ? cents : null;
}

/** One goal of the running month for the first page. */
export interface CategoryGoalPace {
  category: string;
  label: string;
  /** The goal for one month, in cents. */
  cents: number;
  /** What the category has spent in the month so far. */
  spentCents: number;
  /** `cents - spentCents`: below zero when over. */
  leftCents: number;
}

/** The goals set, in the order of `GOAL_CATEGORIES`, against the spending of `month` up to `today`. */
export function categoryGoalPaces(ctx: AnalysisContext, month: string, today: IsoDate, goals: Readonly<Record<string, number>>): CategoryGoalPace[] {
  const upTo = today < monthEnd(month) ? today : monthEnd(month);
  const spent = goalSpend(ctx, { from: `${month}-01`, to: upTo });
  return GOAL_CATEGORIES.filter((c) => goals[c]).map((category) => {
    const cents = goals[category]!;
    const spentCents = spent.get(category)?.cents ?? 0;
    return { category, label: getCategory(category).label, cents, spentCents, leftCents: cents - spentCents };
  });
}

/** The month a range is from its first day to a day of it, or null: a goal is a month's, so a range from the middle of a month or over several has none to set beside. */
export const singleMonth = (range: DateRange): string | null => (monthOf(range.from) === monthOf(range.to) && range.from.endsWith("-01") ? monthOf(range.from) : null);
