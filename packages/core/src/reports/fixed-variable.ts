import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { monthLabels, rangeMonthIndexes } from "./shared.ts";

export interface FixedVariableRow {
  month: string;
  /** Subscriptions and bills (recurring with a fixed cadence), card bills not included. */
  fixedCents: number;
  /** Frequent, irregular habits (groceries, delivery, coffee). */
  habitCents: number;
  /** Everything else: one-off and occasional purchases. */
  variableCents: number;
  debtCents: number;
}

export interface FixedVariableReport {
  rows: FixedVariableRow[];
  totals: Omit<FixedVariableRow, "month">;
}

/** How much of the spending is locked in versus adjustable. */
export function fixedVariableReport(ctx: AnalysisContext, range: DateRange): FixedVariableReport {
  const months = rangeMonthIndexes(range);
  const first = months[0]!;
  const rows = monthLabels(months).map((month) => ({ month, fixedCents: 0, habitCents: 0, variableCents: 0, debtCents: 0 }));
  for (const t of inDays(ctx, toDayRange(range))) {
    const row = rows[t.month - first];
    if (!row) continue;
    row.debtCents += t.flows.debt;
    const c = t.flows.consumption;
    if (!c) continue;
    // a card bill comes every month, but it pays everyday purchases (see isFixedCost)
    if (ctx.fixedIds.has(t.id) && t.category !== "card_bill") row.fixedCents += c;
    else if (ctx.habitIds.has(t.id)) row.habitCents += c;
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
  return { rows, totals };
}
