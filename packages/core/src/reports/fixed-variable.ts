// Decision: take on a new commitment or not
import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { roundedShares } from "../analysis/bridge-view.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { monthLabels, rangeMonthIndexes } from "./shared.ts";

export interface FixedVariableRow {
  month: string;
  /** Subscriptions and bills (recurring with a fixed cadence) with their loan instalments, card bills not included. */
  fixedCents: number;
  /** Frequent, irregular habits (groceries, delivery, coffee). */
  habitCents: number;
  /** Everything else: one-off and occasional purchases. */
  variableCents: number;
  /** Debt service outside the fixed series: interest, fees and extra payments. */
  debtCents: number;
}

/** A row with what the stacked area draws: each layer's top, so the chart adds up nothing. */
interface FixedVariableBand extends FixedVariableRow {
  /** The tops of fixed, habit, variable and debt stacked in that order; the last is the month's spending. */
  tops: [number, number, number, number];
  /** Fixed costs as a share of the month's spending; null when it spent nothing. */
  fixedShare: number | null;
  /**
   * Each layer's share of the month's spending in whole percent, rounded together so they add up to 100: the labels at
   * the chart's right end. A layer below zero (a month of refunds) is null and stands outside; all null when it spent nothing.
   */
  shares: [number | null, number | null, number | null, number | null];
}

export interface FixedVariableReport {
  rows: FixedVariableBand[];
  /** The four layers over the range, their sum (`spendingCents`) and the fixed part of it; null when nothing was spent. */
  totals: Omit<FixedVariableRow, "month"> & { spendingCents: number; fixedShare: number | null };
}

/**
 * How much of the spending is locked in versus adjustable. The four columns add up to the spending of the period
 * (consumption and debt). A charge is fixed by the same rule as `isFixedCost` (a subscription or bill, not the card
 * bill), judged where it was paid: a subscription that has ended since was still fixed in its months.
 */
export function fixedVariableReport(ctx: AnalysisContext, range: DateRange): FixedVariableReport {
  const months = rangeMonthIndexes(range, 24, ctx);
  const first = months[0]!;
  const rows = monthLabels(months).map((month) => ({ month, fixedCents: 0, habitCents: 0, variableCents: 0, debtCents: 0 }));
  for (const t of inDays(ctx, toDayRange(range))) {
    const row = rows[t.month - first];
    if (!row) continue;
    // a card bill comes every month, but it pays everyday purchases (see isFixedCost); a loan instalment is fixed, like rent
    if (ctx.fixedIds.has(t.id) && t.category !== "card_bill") {
      row.fixedCents += t.flows.consumption + t.flows.debt;
      continue;
    }
    row.debtCents += t.flows.debt;
    const c = t.flows.consumption;
    if (!c) continue;
    if (ctx.habitIds.has(t.id)) row.habitCents += c;
    else row.variableCents += c;
  }
  const totals = rows.reduce(
    (acc, r) => ({
      fixedCents: acc.fixedCents + r.fixedCents,
      habitCents: acc.habitCents + r.habitCents,
      variableCents: acc.variableCents + r.variableCents,
      debtCents: acc.debtCents + r.debtCents,
    }),
    { fixedCents: 0, habitCents: 0, variableCents: 0, debtCents: 0 },
  );
  const bands = rows.map((r) => {
    const tops: [number, number, number, number] = [r.fixedCents, r.fixedCents + r.habitCents, r.fixedCents + r.habitCents + r.variableCents, r.fixedCents + r.habitCents + r.variableCents + r.debtCents];
    const shares = (tops[3] > 0 ? roundedShares([r.fixedCents, r.habitCents, r.variableCents, r.debtCents], tops[3]) : [null, null, null, null]) as FixedVariableBand["shares"];
    return { ...r, tops, fixedShare: tops[3] > 0 ? r.fixedCents / tops[3] : null, shares };
  });
  const spendingCents = totals.fixedCents + totals.habitCents + totals.variableCents + totals.debtCents;
  return { rows: bands, totals: { ...totals, spendingCents, fixedShare: spendingCents > 0 ? totals.fixedCents / spendingCents : null } };
}
