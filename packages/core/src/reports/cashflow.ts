import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { type PeriodTotals, totalsOf } from "../analysis/flows.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { fullMonths, monthLabels, rangeMonthIndexes } from "./shared.ts";

export interface CashflowRow {
  month: string;
  incomeCents: number;
  consumptionCents: number;
  debtCents: number;
  savedCents: number;
  borrowedCents: number;
  netCents: number;
  savingsRate: number | null;
}

export interface CashflowReport {
  rows: CashflowRow[];
  totals: PeriodTotals;
  /** Per-month averages over the complete months; null when the range has none. */
  average: Omit<CashflowRow, "month" | "savingsRate"> | null;
}

/** Money in vs. where it went (consumption, debt, savings), month by month. */
export function cashflowReport(ctx: AnalysisContext, range: DateRange): CashflowReport {
  const months = rangeMonthIndexes(range);
  // a range longer than the shown months: the rows are the last 24, the totals still cover the whole range
  const all = inDays(ctx, toDayRange(range));
  const txs = all.filter((x) => x.month >= months[0]!);
  const rows = monthLabels(months).map((month, i) => {
    const t = totalsOf(txs.filter((x) => x.month === months[i]).map((x) => x.flows));
    return {
      month,
      incomeCents: t.incomeCents,
      consumptionCents: t.consumptionCents,
      debtCents: t.debtCents,
      savedCents: t.savedCents,
      borrowedCents: t.borrowedCents,
      netCents: t.netCents,
      savingsRate: t.savingsRate,
    };
  });
  const averaged = new Set(fullMonths(ctx, range, months));
  const base = rows.filter((_, i) => averaged.has(months[i]!));
  const avg = (key: keyof Omit<CashflowRow, "month" | "savingsRate">) => Math.round(base.reduce((s, r) => s + r[key], 0) / base.length);
  return {
    rows,
    totals: totalsOf(all.map((x) => x.flows)),
    average: !base.length ? null : {
      incomeCents: avg("incomeCents"),
      consumptionCents: avg("consumptionCents"),
      debtCents: avg("debtCents"),
      savedCents: avg("savedCents"),
      borrowedCents: avg("borrowedCents"),
      netCents: avg("netCents"),
    },
  };
}
