/**
 * The figures of Yhteenveto's tiles that no other part of the dashboard gives: this month's income against the usual
 * month's, and how far what the household has net moved in a month. Every other tile reads a figure of `nyt`, `home` or
 * `holdings` as it is.
 */
import { addMonthsToDate, monthOf } from "./dates.ts";
import { expectedIncome } from "./analysis/expected.ts";
import { earnedIncome } from "./analysis/usual.ts";
import type { AnalysisContext } from "./analysis/context.ts";
import { accountsLessDebtOn } from "./reports/balances.ts";
import type { BalanceInput, IsoDate, UserInputs } from "./types.ts";

export interface Overview {
  /**
   * The running month's earned income so far (`earnedIncome`) and the usual month's (`expectedIncome`, null under
   * `MIN_COMPARE_MONTHS` complete months): the same quantity, so the two compare.
   */
  income: { cents: number; usualCents: number | null };
  /**
   * The accounts less the debts today against the same day a month ago (`accountsLessDebtOn` both days): the change of
   * the Varat tile. Null when either day is not known.
   */
  net: { since: IsoDate; changeCents: number } | null;
}

export function buildOverview(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): Overview {
  const month = monthOf(ctx.today);
  const since = addMonthsToDate(ctx.today, -1);
  const now = accountsLessDebtOn(ctx, balances, inputs, ctx.today);
  const before = accountsLessDebtOn(ctx, balances, inputs, since);
  return {
    income: { cents: earnedIncome(ctx, month), usualCents: expectedIncome(ctx, month) },
    net: now === null || before === null ? null : { since, changeCents: now - before },
  };
}
