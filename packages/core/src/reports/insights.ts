// Decision: what is worth changing first
import { buildAlerts } from "../analysis/alerts.ts";
import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { totalsOf } from "../analysis/flows.ts";
import { type Insight, rankInsights } from "../analysis/insights/index.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { completeMonthsBefore } from "../analysis/usual.ts";
import { monthOf } from "../dates.ts";
import type { UserInputs } from "../types.ts";

export interface InsightsReport {
  /** Every insight that passed its gate, largest `yearlyCents` first, each with its basis (`detail`) and rows. */
  items: Insight[];
  /** Complete months of history before the end of the period: the year comparisons need 18 to 24. */
  months: number;
}

/** The Havainnot report: all of `rankInsights`, where the overview shows the first three. */
export function insightsReport(ctx: AnalysisContext, range: DateRange, inputs: UserInputs): InsightsReport {
  const current = inDays(ctx, toDayRange(range));
  const end = range.to < ctx.today ? range.to : ctx.today;
  return {
    // the same alerts as the overview, so the report and its first three agree and nothing an alert says repeats
    items: rankInsights({ ctx, range, current, totals: totalsOf(current.map((t) => t.flows)), inputs, alerts: buildAlerts(ctx, range, inputs) }),
    months: completeMonthsBefore(ctx, monthOf(end), 36).length,
  };
}
