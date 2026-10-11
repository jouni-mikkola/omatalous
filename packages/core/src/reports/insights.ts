// Decision: what is worth changing first
import type { AnalysisContext } from "../analysis/context.ts";
import { type Insight, insightInputOf, rankInsights } from "../analysis/insights/index.ts";
import type { DateRange } from "../analysis/period.ts";
import { completeMonthsBefore } from "../analysis/usual.ts";
import { monthOf } from "../dates.ts";
import type { UserInputs } from "../types.ts";

export interface InsightsReport {
  /** Every insight that passed its gate, largest `yearlyCents` first, each with its basis (`detail`) and rows. */
  items: Insight[];
  /** Complete months of history before the end of the period: the year comparisons need 18 to 24. */
  months: number;
}

/** The Havainnot report, shown while Säästövinkit is switched off: all of `rankInsights`, where the overview shows the first three. */
export function insightsReport(ctx: AnalysisContext, range: DateRange, inputs: UserInputs): InsightsReport {
  const end = range.to < ctx.today ? range.to : ctx.today;
  return {
    items: rankInsights(insightInputOf(ctx, range, inputs)),
    months: completeMonthsBefore(ctx, monthOf(end), 36).length,
  };
}
