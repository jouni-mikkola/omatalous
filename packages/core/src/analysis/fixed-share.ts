/**
 * Fixed costs as a share of the usual income: one figure, read by the buffer report (Raportit > Kiinteät ja
 * muuttuvat, Säästövinkit > Tilanne) for today and by the commitments insight for the day it is judged on.
 */
import { cancelledSubjects, fixedMonthlyCents } from "../commitments.ts";
import { monthOf } from "../dates.ts";
import { lenderInstalments } from "../loan-detect.ts";
import type { RecurringSeries } from "../recurring.ts";
import type { IsoDate, UserInputs } from "../types.ts";
import { type AnalysisContext, recurringAt } from "./context.ts";
import { completeMonthsBefore, MIN_COMPARE_MONTHS, usualIncome } from "./usual.ts";

/** Less than this is not a household's fixed costs, only a few subscriptions. */
const MIN_FIXED_CENTS = 20000;

/**
 * "tavallisista tuloista, viimeiset 4 kuukautta": the usual income of `month` (`usualIncome`) with the number of
 * complete months it is the median of, 3 to 6. Without a usual income there is no window to name.
 */
export function usualIncomeOf(ctx: AnalysisContext, month: string): string {
  const n = completeMonthsBefore(ctx, month).length;
  return n < MIN_COMPARE_MONTHS ? "tavallisista tuloista" : `tavallisista tuloista, viimeiset ${n} kuukautta`;
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
  /** Usual monthly income (`usualIncome`: earned income, the median of the last complete months); null under three. */
  incomeMonthlyCents: number | null;
  /** Fixed costs as a share of that income; null without income or without real fixed costs. */
  fixedShare: number | null;
  /** "Kiinteät menot tavallisista tuloista, viimeiset 4 kuukautta": Raportit and Säästövinkit > Tilanne. */
  fixedShareLabel: string;
}

/** The share on `end`. A subscription the household marked as cancelled is no fixed cost, as on the overview. */
export function fixedShareOn(ctx: AnalysisContext, end: IsoDate, inputs: UserInputs): FixedShare {
  const fixed = fixedMonthlyCents(fixedSeriesAt(ctx, end), cancelledSubjects(inputs, end < ctx.today ? end : ctx.today));
  // the complete months before the month of `end`, the same yardstick as every "usually" (analysis/usual.ts)
  const month = monthOf(end);
  const income = usualIncome(ctx, month);
  return {
    fixedMonthlyCents: fixed,
    incomeMonthlyCents: income,
    fixedShare: fixed >= MIN_FIXED_CENTS && income && income > 0 ? fixed / income : null,
    fixedShareLabel: `Kiinteät menot ${usualIncomeOf(ctx, month)}`,
  };
}
