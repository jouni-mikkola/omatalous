/**
 * Insights: observations a household would not have thought to check, each with its number, its basis, its rows and
 * what it is worth over a year (`yearlyCents`). Every source below has its own file, gate and history rule
 * (.claude/plan/research/H-insights.md); this file only ranks them. The overview shows the first three, the Havainnot
 * report all of them. What the alerts say (alerts.ts) and what the month explanation says (explain.ts) is not repeated.
 */
import { NO_INPUTS } from "../../types.ts";
import { borrowing } from "./borrowing.ts";
import { commitmentsShare } from "./commitments.ts";
import { spendingOutgrowsIncome } from "./growth.ts";
import { incomeChangesSource } from "./income.ts";
import { instalments } from "./instalments.ts";
import { priceRises } from "./prices.ts";
import { renewals } from "./renewals.ts";
import { expensiveMonths } from "./seasons.ts";
import { gateMonthly } from "./shared.ts";
import { spendingChanges } from "./spending.ts";
import { stoppedPayments } from "./stopped.ts";
import { subscriptionChanges } from "./subscriptions.ts";
import type { Insight, InsightArgs, InsightInput, InsightSource } from "./types.ts";

export type { Insight, InsightArgs, InsightInput, InsightLink, InsightSource, InsightTone } from "./types.ts";

/** At most this many on the overview (H-insights section 1). */
export const OVERVIEW_INSIGHTS = 3;

/** Each returns only what passed its own gate. To add a source, add one line here. */
const SOURCES: readonly InsightSource[] = [
  priceRises,
  stoppedPayments,
  subscriptionChanges,
  renewals,
  instalments,
  expensiveMonths,
  spendingOutgrowsIncome,
  commitmentsShare,
  borrowing,
  incomeChangesSource,
  spendingChanges,
];

/** A dismissed insight comes back when its yearly figure has moved this much from the one it was dismissed at. */
const RETURN_SHARE = 0.25;

/**
 * The mark subject that dismisses an insight at its current figure: `alert:<id>@<yearlyCents>` (PUT /api/marks with
 * mark "dismissed").
 */
export function insightDismissSubject(i: Pick<Insight, "id" | "yearlyCents">): string {
  return `alert:${i.id}@${i.yearlyCents}`;
}

/** Hidden while a dismissal of the same id stands at a figure within 25 % of today's. A dismissal without a figure hides it for good. */
function dismissed(i: Insight, subjects: ReadonlySet<string>): boolean {
  if (subjects.has(`alert:${i.id}`)) return true;
  for (const s of subjects) {
    const at = s.lastIndexOf("@");
    if (at < 0 || s.slice(0, at) !== `alert:${i.id}`) continue;
    const then = Number(s.slice(at + 1));
    if (Number.isFinite(then) && Math.abs(i.yearlyCents - then) < RETURN_SHARE * Math.abs(then)) return true;
  }
  return false;
}

/** Every insight that passed its gate, largest `yearlyCents` first, dismissed ones left out. */
export function rankInsights(input: InsightInput): Insight[] {
  const { ctx, range } = input;
  const end = range.to < ctx.today ? range.to : ctx.today;
  const inputs = input.inputs ?? NO_INPUTS;
  const args: InsightArgs = {
    ctx,
    range,
    end,
    running: input.running ?? (range.from <= ctx.today && ctx.today <= range.to),
    current: input.current,
    totals: input.totals,
    inputs,
    alerts: input.alerts ?? [],
    gateMonthlyCents: gateMonthly(ctx, end),
  };
  const subjects = new Set(inputs.marks.filter((m) => m.mark === "dismissed").map((m) => m.subject));
  // what an alert names already (a merchant, a category) is not told twice
  const alerted = new Set(args.alerts.flatMap((a) => [a.merchant, a.category]).filter((x): x is string => !!x));
  return SOURCES.flatMap((source) => source(args))
    .filter((i) => i.yearlyCents > 0 && !(i.merchant && alerted.has(i.merchant)) && !dismissed(i, subjects))
    .sort((a, b) => b.yearlyCents - a.yearlyCents || a.id.localeCompare(b.id));
}

/** The overview's insights: the first three of `rankInsights`. */
export function buildInsights(input: InsightInput): Insight[] {
  return rankInsights(input).slice(0, OVERVIEW_INSIGHTS);
}
