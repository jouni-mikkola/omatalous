/**
 * The large rows of a household, for the views that show them apart from the money of the months: the purchases of
 * the `large` policy (one-offs.ts), and its mirror for income. An income row is large when it is a single one: at
 * least 500 €, over the usual income of a month (`usualIncome` of the row's month), in no series, and over a quarter of
 * what the rest of its payer paid in the twelve months around it. So pay, a pension or a benefit is never large, also
 * when its days are too uneven for a series; an inheritance, a car sold or a year's tax refund is. With under three
 * complete months before the row the usual income is not known and the row is not large. Both sets are read from the
 * whole history, once per context.
 */
import { fromMonthIndex } from "../dates.ts";
import type { AnalysisContext } from "./context.ts";
import { isIncomeRow, payerKey } from "./income.ts";
import { LARGE, oneOffs, yearAround } from "./one-offs.ts";
import { usualIncome } from "./usual.ts";

/** The least an income row is to be large: the same floor as a purchase has. */
const MIN_INCOME_CENTS = 50000;

interface LargeRows {
  purchases: ReadonlySet<string>;
  income: ReadonlySet<string>;
}

const cache = new WeakMap<AnalysisContext, LargeRows>();

function largeRows(ctx: AnalysisContext): LargeRows {
  let found = cache.get(ctx);
  if (!found) {
    const inSeries = new Set(ctx.recurring.flatMap((s) => s.transactionIds));
    const fromPayer = yearAround(ctx.txs, payerKey, (t) => t.flows.income);
    const income = new Set<string>();
    for (const t of ctx.txs) {
      const cents = t.flows.income;
      if (!isIncomeRow(t) || cents < MIN_INCOME_CENTS || inSeries.has(t.id) || cents <= LARGE.multiple * (fromPayer(t) - cents)) continue;
      const usual = usualIncome(ctx, fromMonthIndex(t.month));
      if (usual !== null && cents > usual) income.add(t.id);
    }
    cache.set(ctx, (found = { purchases: oneOffs(ctx.txs, LARGE, inSeries), income }));
  }
  return found;
}

/** The ids of the large purchases: one-offs of the `large` policy over the whole history. */
export const largePurchases = (ctx: AnalysisContext): ReadonlySet<string> => largeRows(ctx).purchases;

/** The ids of the large income rows: a single row over the usual income of its month. */
export const largeIncome = (ctx: AnalysisContext): ReadonlySet<string> => largeRows(ctx).income;
