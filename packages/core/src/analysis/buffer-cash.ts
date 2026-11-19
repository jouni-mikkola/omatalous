import { monthOf } from "../dates.ts";
import { type BalanceInput, type UserInputs } from "../types.ts";
import { cashAhead } from "./ahead.ts";
import type { AnalysisContext } from "./context.ts";
import { expectedSpending } from "./expected.ts";

/** The cash and the spending the buffer is counted from. */
interface BufferCash {
  /** Balances of savings and checking accounts today; null when none of them has a balance. */
  cashCents: number | null;
  /** What the credit cards owe today, positive; 0 without a card balance. A card's purchases leave the accounts with its bill, so the buffer cannot count on that money. */
  cardDebtCents: number;
  /** The subscriptions and bills the accounts pay before the next payday (`cashAhead`), the card's bill left out: it is the card debt above. */
  dueBeforePaydayCents: number;
  /** `cashCents` less the card debt and the bills due before the payday; null with `cashCents`. */
  netCents: number | null;
  /** Spending in an expected month (`expectedSpending`); null under three complete months. */
  spendExpected: number | null;
}

/**
 * The one reading of the money the buffer counts: the cash on savings and checking accounts after what is already
 * spoken for (the debt on credit cards and the bills due before the payday), and an expected month of spending to
 * divide it by. `bufferReport` tells it in months, and the debt plan reads the same two figures for the buffer it fills first.
 */
export function bufferCash(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): BufferCash {
  const spendExpected = expectedSpending(ctx, monthOf(ctx.today));
  const counted = balances.filter((a) => (a.type === "savings" || a.type === "checking") && a.balanceCents !== null);
  const cashCents = counted.length ? counted.reduce((s, a) => s + a.balanceCents!, 0) : null;
  const cardDebtCents = balances.filter((a) => a.type === "credit_card" && a.balanceCents !== null && a.balanceCents < 0).reduce((s, a) => s - a.balanceCents!, 0);
  const { totals } = cashAhead(ctx, balances, inputs);
  const dueBeforePaydayCents = totals.dueCents - totals.cardCents;
  const netCents = cashCents === null ? null : cashCents - cardDebtCents - dueBeforePaydayCents;
  return { cashCents, cardDebtCents, dueBeforePaydayCents, netCents, spendExpected };
}
