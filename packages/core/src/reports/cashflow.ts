// Decision: spend less or save more
import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { unknownSpending } from "../analysis/data-quality.ts";
import { incomeCentsOf, incomeSelect, sumOf } from "../analysis/counted.ts";
import { type PeriodTotals, totalsOf } from "../analysis/flows.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { monthEnd, monthIndex, monthOf, monthRange } from "../dates.ts";
import { fullMonths, monthLabels, rangeMonthIndexes } from "./shared.ts";

export interface CashflowRow {
  month: string;
  incomeCents: number;
  consumptionCents: number;
  debtCents: number;
  savedCents: number;
  borrowedCents: number;
  netCents: number;
  /** Yli jäi of the month, `PeriodTotals.leftCents` as `totalsOf` gives it: this report holds no sum of its own. */
  leftCents: number;
  savingsRate: number | null;
  /** The month has ended and the history covers it from the 1st. A row that is not complete reads "vajaa". */
  complete: boolean;
}

export interface CashflowReport {
  rows: CashflowRow[];
  /** The share of the range's spending that is not itemised, 0 to 1 (`unknownSpending`): Raportit says so when it is over 20 %. */
  unknownShare: number;
  totals: PeriodTotals;
  /** Per-month averages over the complete months; null when the range has none. */
  average: Omit<CashflowRow, "month" | "savingsRate" | "complete"> | null;
  /** The range holds the month that has not ended: its bills are out but its salary may not be in. */
  running: boolean;
  /**
   * Totals of the complete months of a range that holds the running month; null when it has no running month or
   * no complete one. The margin and savings rate are told from these, since a month in progress reads as a loss.
   */
  closed: PeriodTotals | null;
}

/** Money in vs. where it went (consumption, debt, savings), month by month. */
export function cashflowReport(ctx: AnalysisContext, range: DateRange): CashflowReport {
  const months = rangeMonthIndexes(range, 24, ctx);
  // a range longer than the shown months: the rows are the last 24, the totals still cover the whole range
  const all = inDays(ctx, toDayRange(range));
  // a month's days within the range: the select of the month's income
  const daysOf = (month: string) => toDayRange({ from: range.from > `${month}-01` ? range.from : `${month}-01`, to: range.to < monthEnd(month) ? range.to : monthEnd(month) });
  const txs = all.filter((x) => x.month >= months[0]!);
  const rows = monthLabels(months).map((month, i) => {
    const inMonth = txs.filter((x) => x.month === months[i]);
    const t = totalsOf(inMonth.map((x) => x.flows));
    return {
      month,
      incomeCents: sumOf(incomeSelect(ctx, daysOf(month)).counted, incomeCentsOf),
      consumptionCents: t.consumptionCents,
      debtCents: t.debtCents,
      savedCents: t.savedCents,
      borrowedCents: t.borrowedCents,
      netCents: t.netCents,
      leftCents: t.leftCents,
      savingsRate: t.savingsRate,
      complete: isCompleteMonth(ctx, month),
    };
  });
  const running = range.from <= ctx.today && ctx.today <= range.to;
  // the same months as the dashboard's settled totals: complete, and in the range from their 1st
  const closedMonths = new Set(monthRange(monthOf(range.from), monthOf(range.to)).filter((m) => `${m}-01` >= range.from && isCompleteMonth(ctx, m)).map(monthIndex));
  const closedFlows = running ? all.filter((x) => closedMonths.has(x.month)) : [];
  const averaged = new Set(fullMonths(ctx, range, months));
  const base = rows.filter((_, i) => averaged.has(months[i]!));
  const avg = (key: keyof Omit<CashflowRow, "month" | "savingsRate" | "complete">) => Math.round(base.reduce((s, r) => s + r[key], 0) / base.length);
  return {
    rows,
    unknownShare: unknownSpending(ctx, range).share,
    totals: totalsOf(all.map((x) => x.flows)),
    running,
    closed: closedFlows.length ? totalsOf(closedFlows.map((x) => x.flows)) : null,
    average: !base.length ? null : {
      incomeCents: avg("incomeCents"),
      consumptionCents: avg("consumptionCents"),
      debtCents: avg("debtCents"),
      savedCents: avg("savedCents"),
      borrowedCents: avg("borrowedCents"),
      netCents: avg("netCents"),
      leftCents: avg("leftCents"),
    },
  };
}
