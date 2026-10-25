/**
 * Decision: does the household slow down this month to keep to the spending goal it set, and by how much a day.
 * The month's spending so far (the pace chart's `currentTotal`) set against the one monthly goal, and the month's end as
 * the usual months spent the rest of it (`MonthPace.projection`). One goal for consumption and debt payments together,
 * as the chart counts them; no goal per category.
 */
import type { MonthPace } from "./forecast.ts";

/**
 * Where the month stands against the goal:
 * - `over`: the spending so far is already above the goal.
 * - `above`: within the goal now, but even the lighter quarter of usual months would end above it.
 * - `near`: the goal falls inside the estimate's range, so the month may end on either side.
 * - `within`: even the heavier quarter of usual months would end within the goal.
 * - `open`: within the goal now and no estimate to say more (under three complete months of history).
 */
type GoalState = "over" | "above" | "near" | "within" | "open";

export interface SpendingGoal {
  /** The goal for one month, in cents. */
  cents: number;
  /** The goal less the month's spending so far: below zero when it is over. */
  leftCents: number;
  /** The month's end as the usual months spent the rest of it: the lower and the upper quartile. null without the estimate. */
  end: { low: number; high: number } | null;
  /** What may be spent on each day still to come (after today) to end on the goal; null when nothing is left to spend or no day is. */
  perDayCents: number | null;
  state: GoalState;
}

/** `goalCents` set against the running month `pace`. A month that has ended has its total as the end. */
export function spendingGoal(pace: MonthPace, goalCents: number): SpendingGoal {
  const leftCents = goalCents - pace.currentTotal;
  const lastDay = pace.current.reduce<number>((n, v, i) => (v === null ? n : i + 1), 0);
  const daysLeft = pace.daysInMonth - lastDay;
  const end = daysLeft <= 0 ? { low: pace.currentTotal, high: pace.currentTotal } : pace.projection ? { low: pace.projection.low.at(-1)!, high: pace.projection.high.at(-1)! } : null;
  const state: GoalState = leftCents < 0 ? "over" : !end ? "open" : end.low > goalCents ? "above" : end.high > goalCents ? "near" : "within";
  return { cents: goalCents, leftCents, end, perDayCents: leftCents > 0 && daysLeft > 0 ? Math.floor(leftCents / daysLeft) : null, state };
}
