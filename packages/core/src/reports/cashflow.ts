// Decision: spend less or save more
import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { unknownSpending } from "../analysis/data-quality.ts";
import { incomeCentsOf, incomeSelect, sumOf } from "../analysis/counted.ts";
import { savingsRateOf } from "../analysis/bridge.ts";
import { coverOf, type PeriodTotals, totalsOf } from "../analysis/flows.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { monthEnd, monthOf, monthRange } from "../dates.ts";
import { knownMonths, monthLabels, rangeMonthIndexes } from "./shared.ts";

/** The money of a row is null in a month the data does not reach (`knownMonths`): no figure of that month, and its rows are still in the totals of the range. */
interface CashflowRow {
  month: string;
  incomeCents: number | null;
  consumptionCents: number | null;
  debtCents: number | null;
  savedCents: number | null;
  /** Credit drawn in the month, net of what was paid back and never below zero (`coverOf`). */
  borrowedCents: number | null;
  netCents: number | null;
  /** Tulos of the month, `PeriodTotals.leftCents` as `totalsOf` gives it: this report holds no sum of its own. */
  leftCents: number | null;
  /** The month's `savingsRateOf`; null for a month that is partial or that the range cuts, which the table shows as "–". */
  savingsRate: number | null;
  /** The month has ended and the history covers it from the 1st. A row that is not complete reads "vajaa". */
  complete: boolean;
}

export interface CashflowReport {
  rows: CashflowRow[];
  /** The share of the range's spending that is not itemised, 0 to 1 (`unknownSpending`). */
  unknownShare: number;
  totals: PeriodTotals;
  /**
   * The range's totals with `inCents`, the money in (income and credit drawn) the period row of Raportit's month table
   * is laid against. One sum for the page: the rows of the table add up to it. Only `savingsRate` is told from the
   * complete months of a running range, since a month in progress reads as a loss.
   */
  whole: PeriodTotals & { inCents: number };
}

/** Money in vs. where it went (consumption, debt, savings), month by month. */
export function cashflowReport(ctx: AnalysisContext, range: DateRange, maxMonths = 24): CashflowReport {
  const months = rangeMonthIndexes(range, maxMonths, ctx);
  // a range longer than the shown months: the rows are the last 24, the totals still cover the whole range
  const all = inDays(ctx, toDayRange(range));
  // a month's days within the range: the select of the month's income
  const daysOf = (month: string) => toDayRange({ from: range.from > `${month}-01` ? range.from : `${month}-01`, to: range.to < monthEnd(month) ? range.to : monthEnd(month) });
  const txs = all.filter((x) => x.month >= months[0]!);
  const labels = monthLabels(months);
  const known = knownMonths(ctx, labels);
  const rows = labels.map((month, i): CashflowRow => {
    const inMonth = txs.filter((x) => x.month === months[i]);
    const t = known[i] ? totalsOf(inMonth.map((x) => x.flows)) : null;
    // the rate is a whole month's: a month the range cuts holds only part of it
    const wholeMonth = range.from <= `${month}-01` && range.to >= monthEnd(month);
    return {
      month,
      incomeCents: t ? sumOf(incomeSelect(ctx, daysOf(month)).counted, incomeCentsOf) : null,
      consumptionCents: t?.consumptionCents ?? null,
      debtCents: t?.debtCents ?? null,
      savedCents: t?.savedCents ?? null,
      borrowedCents: t ? coverOf(t).creditDrawnCents : null,
      netCents: t?.netCents ?? null,
      leftCents: t?.leftCents ?? null,
      savingsRate: t && wholeMonth ? savingsRateOf(ctx, [month]).rate : null,
      complete: isCompleteMonth(ctx, month),
    };
  });
  const running = range.from <= ctx.today && ctx.today <= range.to;
  const totals = totalsOf(all.map((x) => x.flows));
  const closedMonths = monthRange(monthOf(range.from), monthOf(range.to)).filter((m) => `${m}-01` >= range.from && isCompleteMonth(ctx, m));
  const whole = { ...totals, inCents: totals.incomeCents + coverOf(totals).creditDrawnCents, savingsRate: running ? (closedMonths.length ? savingsRateOf(ctx, closedMonths).rate : null) : totals.savingsRate };
  return { rows, whole, unknownShare: unknownSpending(ctx, range).share, totals };
}
