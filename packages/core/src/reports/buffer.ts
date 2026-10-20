// Decision: build up savings or not
import type { AnalysisContext } from "../analysis/context.ts";
import { type FixedShare, fixedShareOn } from "../analysis/fixed-share.ts";
import { usualSpending } from "../analysis/usual.ts";
import { monthOf } from "../dates.ts";
import { type BalanceInput, NO_INPUTS, type UserInputs } from "../types.ts";

export interface BufferReport extends FixedShare {
  /** Spending (consumption and debt) in a usual month, groceries included; null under three complete months. */
  usualSpendCents: number | null;
  /** Balances of savings and checking accounts today; null when none of them has a balance. */
  cashCents: number | null;
  /** The cash in months of usual spending; null without a balance or a usual level. */
  bufferMonths: number | null;
}

/**
 * How much of the income is spoken for before the month starts, and how many months of usual spending the money on
 * savings and checking accounts would carry. Always about today. Fixed costs are a share of income and say nothing
 * about the buffer: a household lives on groceries too. The buffer is told only where the bank gave a balance (a CSV
 * import has none). `inputs` carries the user's marks: a cancelled subscription leaves the fixed costs.
 */
export function bufferReport(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs = NO_INPUTS): BufferReport {
  const fixed = fixedShareOn(ctx, ctx.today, inputs);
  const spendUsual = usualSpending(ctx, monthOf(ctx.today));

  const counted = balances.filter((a) => (a.type === "savings" || a.type === "checking") && a.balanceCents !== null);
  const cashCents = counted.length ? counted.reduce((s, a) => s + a.balanceCents!, 0) : null;
  const bufferMonths = cashCents === null || !spendUsual || spendUsual <= 0 ? null : Math.max(0, cashCents) / spendUsual;

  return { ...fixed, usualSpendCents: spendUsual, cashCents, bufferMonths };
}
