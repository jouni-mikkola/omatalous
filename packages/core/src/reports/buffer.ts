// Decision: build up savings or not
import type { AnalysisContext } from "../analysis/context.ts";
import { usualIncome, usualSpending } from "../analysis/usual.ts";
import { cancelledSubjects, fixedMonthlyCents } from "../commitments.ts";
import { type BalanceInput, NO_INPUTS, type UserInputs } from "../types.ts";

/** Less than this is not a household's fixed costs, only a few subscriptions. */
const MIN_FIXED_CENTS = 20000;

export interface BufferReport {
  /** Subscriptions, bills and loan instalments per month, as they are now. */
  fixedMonthlyCents: number;
  /** Usual monthly income (`usualIncome`: earned income, the median of the last complete months); null under three. */
  incomeMonthlyCents: number | null;
  /** Fixed costs as a share of that income; null without income or without real fixed costs. */
  fixedShare: number | null;
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
  // a subscription the household marked as cancelled is no longer a fixed cost, as on the overview
  const fixed = fixedMonthlyCents(ctx.recurring, cancelledSubjects(inputs));

  // the complete months before this one, the same yardstick as every "usually" (analysis/usual.ts)
  const month = ctx.today.slice(0, 7);
  const incomeMonthly = usualIncome(ctx, month);
  const spendUsual = usualSpending(ctx, month);
  const share = fixed >= MIN_FIXED_CENTS && incomeMonthly && incomeMonthly > 0 ? fixed / incomeMonthly : null;

  const counted = balances.filter((a) => (a.type === "savings" || a.type === "checking") && a.balanceCents !== null);
  const cashCents = counted.length ? counted.reduce((s, a) => s + a.balanceCents!, 0) : null;
  const bufferMonths = cashCents === null || !spendUsual || spendUsual <= 0 ? null : Math.max(0, cashCents) / spendUsual;

  return { fixedMonthlyCents: fixed, incomeMonthlyCents: incomeMonthly, fixedShare: share, usualSpendCents: spendUsual, cashCents, bufferMonths };
}
