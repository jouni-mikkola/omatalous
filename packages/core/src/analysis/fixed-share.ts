/**
 * Fixed costs as a share of the usual income: one figure, read by the buffer report (Raportit > Kiinteät ja
 * muuttuvat, Säästövinkit > Tilanne) for today and by the commitments insight for the day it is judged on.
 */
import { cancelledSubjects, fixedMonthlyCents } from "../commitments.ts";
import { monthOf } from "../dates.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { messageIn } from "../messages.ts";
import { lenderInstalments } from "../loan-detect.ts";
import type { RecurringSeries } from "../recurring.ts";
import type { IsoDate, UserInputs } from "../types.ts";
import { type AnalysisContext, recurringAt } from "./context.ts";
import { expectedIncome } from "./expected.ts";
import { completeMonthsBefore } from "./usual.ts";
import { MIN_COMPARE_MONTHS } from "../thresholds.ts";

/** Less than this is not a household's fixed costs, only a few subscriptions. */
const MIN_FIXED_CENTS = 20000;

/**
 * "odotetuista tuloista, viimeiset 4 kuukautta": the expected income of `month` (`expectedIncome`) with the number of
 * complete months it is the mean of, 3 to 6. Without an expected income there is no window to name.
 */
function expectedIncomeSpan(ctx: AnalysisContext, month: string, lang: Language = DEFAULT_LANGUAGE): string {
  const n = completeMonthsBefore(ctx, month).length;
  return n < MIN_COMPARE_MONTHS ? messageIn(lang, "rep.span_plain") : messageIn(lang, "rep.span_months", { count: n });
}

/** The series the fixed costs read on a day: the recurring ones and a lender's monthly payments on no steady day (`lenderInstalments`). */
export function fixedSeriesAt(ctx: AnalysisContext, day: IsoDate): readonly RecurringSeries[] {
  const series = recurringAt(ctx, day);
  return [...series, ...lenderInstalments(ctx, series, day < ctx.today ? day : ctx.today)];
}

/** Fixed costs a month against the usual income of the month of `end`, and the label every page gives the share. */
export interface FixedShare {
  /** Subscriptions, bills and loan instalments per month, of the series on `end`. */
  fixedMonthlyCents: number;
  /** Expected monthly income (`expectedIncome`: earned income, the mean of the last complete months); null under three. */
  incomeMonthlyCents: number | null;
  /** Fixed costs as a share of that income; null without income or without real fixed costs. */
  fixedShare: number | null;
  /** "Kiinteät menot odotetuista tuloista, viimeiset 4 kuukautta": Raportit and Säästövinkit > Tilanne. */
  fixedShareLabel: string;
}

/** The share on `end`. A subscription the household marked as cancelled is no fixed cost, as on the overview. */
export function fixedShareOn(ctx: AnalysisContext, end: IsoDate, inputs: UserInputs, lang: Language = DEFAULT_LANGUAGE): FixedShare {
  const fixed = fixedMonthlyCents(fixedSeriesAt(ctx, end), cancelledSubjects(inputs, end < ctx.today ? end : ctx.today));
  // the complete months before the month of `end`, the same yardstick as every "usually" (analysis/usual.ts)
  const month = monthOf(end);
  const income = expectedIncome(ctx, month);
  return {
    fixedMonthlyCents: fixed,
    incomeMonthlyCents: income,
    fixedShare: fixed >= MIN_FIXED_CENTS && income && income > 0 ? fixed / income : null,
    fixedShareLabel: messageIn(lang, "rep.fixed_costs_label", { span: expectedIncomeSpan(ctx, month, lang) }),
  };
}
