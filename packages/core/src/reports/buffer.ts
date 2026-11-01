// Decision: build up savings or not, and whether the cash left after card debt and the bills before payday carries the household
import type { AnalysisContext } from "../analysis/context.ts";
import { cashAhead } from "../analysis/ahead.ts";
import { type FixedShare, fixedShareOn } from "../analysis/fixed-share.ts";
import { expectedSpending } from "../analysis/expected.ts";
import { monthOf } from "../dates.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { type BalanceInput, NO_INPUTS, type UserInputs } from "../types.ts";

export interface BufferReport extends FixedShare {
  /** Spending (consumption and debt) in an expected month (`expectedSpending`), groceries included; null under three complete months. */
  expectedSpendCents: number | null;
  /** Balances of savings and checking accounts today; null when none of them has a balance. */
  cashCents: number | null;
  /** What the credit cards owe today, positive; 0 without a card balance. A card's purchases leave the accounts with its bill, so the buffer cannot count on that money. */
  cardDebtCents: number;
  /** The subscriptions and bills the accounts pay before the next payday (`cashAhead`), the card's bill left out: it is the card debt above. */
  dueBeforePaydayCents: number;
  /** `cashCents` less the card debt and the bills due before the payday; null with `cashCents`. */
  netCents: number | null;
  /** The net cash in months of expected spending; null without a balance or an expected level. */
  bufferMonths: number | null;
}

/**
 * How much of the income is spoken for before the month starts, and how many months of expected spending the money on
 * savings and checking accounts would carry. Always about today. Fixed costs are a share of income and say nothing
 * about the buffer: a household lives on groceries too. The cash is counted after what is already spoken for: the debt
 * on credit cards and the bills due before the payday. The buffer is told only where the bank gave a balance (a CSV
 * import has none). `inputs` carries the user's marks: a cancelled subscription leaves the fixed costs.
 */
export function bufferReport(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs = NO_INPUTS, lang: Language = DEFAULT_LANGUAGE): BufferReport {
  const fixed = fixedShareOn(ctx, ctx.today, inputs, lang);
  const spendExpected = expectedSpending(ctx, monthOf(ctx.today));

  const counted = balances.filter((a) => (a.type === "savings" || a.type === "checking") && a.balanceCents !== null);
  const cashCents = counted.length ? counted.reduce((s, a) => s + a.balanceCents!, 0) : null;
  const cardDebtCents = balances.filter((a) => a.type === "credit_card" && a.balanceCents !== null && a.balanceCents < 0).reduce((s, a) => s - a.balanceCents!, 0);
  const { totals } = cashAhead(ctx, balances, inputs);
  const dueBeforePaydayCents = totals.dueCents - totals.cardCents;
  const netCents = cashCents === null ? null : cashCents - cardDebtCents - dueBeforePaydayCents;
  const bufferMonths = netCents === null || !spendExpected || spendExpected <= 0 ? null : Math.max(0, netCents) / spendExpected;

  return { ...fixed, expectedSpendCents: spendExpected, cashCents, cardDebtCents, dueBeforePaydayCents, netCents, bufferMonths };
}
