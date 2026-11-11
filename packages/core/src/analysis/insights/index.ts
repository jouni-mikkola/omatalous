/**
 * Insights: observations a household would not have thought to check, each a fact, what it is set against, what to do
 * next and what it is worth over a year (`effectPerYear`, a calc line). Every source below has its own file, gate and
 * history rule; this file ranks them: a recurring pattern before a single row, then the larger effect first, and a
 * single row only when it is worth `SINGLE_MIN_YEARLY_CENTS` and is among the largest rows of its month. Säästövinkit shows them as Muut havainnot
 * (optimise/others.ts); with that page switched off the overview shows the first three and the Havainnot report all
 * of them. What the alerts say (alerts.ts) and what the spending change says (change.ts) is not repeated.
 */
import { DEFAULT_LANGUAGE, type Language } from "../../locale.ts";
import { INSIGHT_RETURN_SHARE, OVERVIEW_INSIGHTS, SINGLE_MIN_YEARLY_CENTS } from "../../thresholds.ts";
import { NO_INPUTS, type UserInputs, type UserMark } from "../../types.ts";
import { buildAlerts } from "../alerts.ts";
import { type AnalysisContext, inDays } from "../context.ts";
import { totalsOf } from "../flows.ts";
import { type DateRange, toDayRange } from "../period.ts";
import { borrowing } from "./borrowing.ts";
import { commitmentsShare } from "./commitments.ts";
import { cardInterest } from "./credit.ts";
import { spendingOutgrowsIncome } from "./growth.ts";
import { incomeChangesSource } from "./income.ts";
import { instalments } from "./instalments.ts";
import { paydaySpending } from "./payday.ts";
import { priceRises } from "./prices.ts";
import { renewals } from "./renewals.ts";
import { smallPurchases } from "./small-purchases.ts";
import { expensiveMonths } from "./seasons.ts";
import { amongLargestRows, gateMonthly } from "./shared.ts";
import { spendingChanges } from "./spending.ts";
import { stoppedPayments } from "./stopped.ts";
import { subscriptionChanges } from "./subscriptions.ts";
import { weekdays } from "./weekdays.ts";
import type { Insight, InsightArgs, InsightInput, InsightSource } from "./types.ts";

export type { Action, Comparison, EffectLine, Insight, InsightArgs, InsightEvidence, InsightFact, InsightInput, InsightLink, InsightSource, Quantity } from "./types.ts";

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
  cardInterest,
  incomeChangesSource,
  spendingChanges,
  paydaySpending,
  smallPurchases,
  weekdays,
];

/** The order of the list: a pattern before a single row, then the larger yearly effect, then the id. */
function compareInsights(a: Insight, b: Insight): number {
  return Number(a.kind === "single") - Number(b.kind === "single") || yearlyOf(b) - yearlyOf(a) || a.id.localeCompare(b.id);
}

/** The yearly figure of an insight without its sign: what a dismissal is compared with. */
const yearlyOf = (i: Pick<Insight, "effectPerYear">) => Math.abs(i.effectPerYear?.cents ?? 0);

/**
 * The dismissal that hides an insight (a mark "dismissed" on `alert:<id>@<yearlyCents>`, its figure of that day): one of the same id at a figure within 25 % of today's, or one without a figure,
 * which hides it for good. Null when none stands.
 */
function dismissalOf(i: Insight, marks: readonly UserMark[]): UserMark | null {
  for (const m of marks) {
    if (m.subject === `alert:${i.id}`) return m;
    const at = m.subject.lastIndexOf("@");
    if (at < 0 || m.subject.slice(0, at) !== `alert:${i.id}`) continue;
    const then = Number(m.subject.slice(at + 1));
    if (Number.isFinite(then) && Math.abs(yearlyOf(i) - then) < INSIGHT_RETURN_SHARE * Math.abs(then)) return m;
  }
  return null;
}

/** One insight and the dismissal that hides it, null while it shows. */
export interface AnsweredInsight {
  insight: Insight;
  dismissal: UserMark | null;
}

/** Whether a single row is large enough to be told: worth the threshold a year and among the largest rows of its month. */
function singleShown(args: InsightArgs, i: Insight): boolean {
  return yearlyOf(i) >= SINGLE_MIN_YEARLY_CENTS && amongLargestRows(args.ctx, i.evidence.rows);
}

/** Every insight that passed its gate, a pattern before a single row and then the larger effect first, each with the dismissal that hides it. */
export function answeredInsights(input: InsightInput): AnsweredInsight[] {
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
    lang: input.lang ?? DEFAULT_LANGUAGE,
  };
  const dismissals = inputs.marks.filter((m) => m.mark === "dismissed");
  // what an alert names already (a merchant, a category) is not told twice
  const alerted = new Set(args.alerts.flatMap((a) => [a.merchant, a.category]).filter((x): x is string => !!x));
  return SOURCES.flatMap((source) => source(args))
    .filter((i) => i.effectPerYear !== null && !(i.evidence.merchant && alerted.has(i.evidence.merchant)) && (i.kind === "pattern" || singleShown(args, i)))
    .sort(compareInsights)
    .map((insight) => ({ insight, dismissal: dismissalOf(insight, dismissals) }));
}

/** Every insight that passed its gate, in the order above, dismissed ones left out. */
export function rankInsights(input: InsightInput): Insight[] {
  return answeredInsights(input)
    .filter((a) => !a.dismissal)
    .map((a) => a.insight);
}

/**
 * What the insights of a period are judged on outside the dashboard: its rows, their totals and the overview's alerts,
 * so a list and the overview's first three agree and nothing an alert says repeats. The Havainnot report and
 * Säästövinkit (optimise/others.ts) read this.
 */
export function insightInputOf(ctx: AnalysisContext, range: DateRange, inputs: UserInputs, lang: Language = DEFAULT_LANGUAGE): InsightInput {
  const current = inDays(ctx, toDayRange(range));
  return { ctx, range, current, totals: totalsOf(current.map((t) => t.flows)), inputs, alerts: buildAlerts(ctx, range, inputs, lang), lang };
}

/** The overview's insights: the first three of `rankInsights`. */
export function buildInsights(input: InsightInput): Insight[] {
  return rankInsights(input).slice(0, OVERVIEW_INSIGHTS);
}
