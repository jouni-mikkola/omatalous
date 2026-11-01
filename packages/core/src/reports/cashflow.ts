// Decision: spend less or save more
import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { unknownSpending } from "../analysis/data-quality.ts";
import { incomeCentsOf, incomeSelect, sumOf } from "../analysis/counted.ts";
import { savingsRateOf } from "../analysis/bridge.ts";
import { type MoneyBridge, moneyBridge } from "../analysis/money-bridge.ts";
import { type BridgeView, bridgeView } from "../analysis/bridge-view.ts";
import { unknownIncomeShare } from "../analysis/income.ts";
import { coverOf, type PeriodTotals, totalsOf } from "../analysis/flows.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { addMonths, monthEnd, monthOf, monthRange } from "../dates.ts";
import { type BalanceInput } from "../types.ts";
import { fullMonths, monthLabels, rangeMonthIndexes } from "./shared.ts";

export interface CashflowRow {
  month: string;
  incomeCents: number;
  consumptionCents: number;
  debtCents: number;
  savedCents: number;
  /** Credit drawn in the month, net of what was paid back and never below zero (`coverOf`). */
  borrowedCents: number;
  netCents: number;
  /** Tulos of the month, `PeriodTotals.leftCents` as `totalsOf` gives it: this report holds no sum of its own. */
  leftCents: number;
  /** The month's `savingsRateOf`; null for a month that is partial or that the range cuts, which the table shows as "–". */
  savingsRate: number | null;
  /** The month has ended and the history covers it from the 1st. A row that is not complete reads "vajaa". */
  complete: boolean;
  /**
   * The heights of the month's two stacks in the cash flow chart: money in (income and credit drawn) and money out
   * (consumption, debt service and what went to savings), each part counted from zero up, and in less out ("Erotus").
   */
  stack: { inCents: number; outCents: number; gapCents: number };
}

interface RateCompare {
  month: string;
  rate: number;
  /** The rate of the month before and of the same month a year earlier (`savingsRateOf`); null when that month is not complete or has no income. */
  previous: { month: string; rate: number | null };
  yearAgo: { month: string; rate: number | null };
}

export interface CashflowReport {
  rows: CashflowRow[];
  /** The share of the range's spending that is not itemised, 0 to 1 (`unknownSpending`): Raportit says so when it is over 20 %. */
  unknownShare: number;
  /** The share of the range's income that nothing has told yet, 0 to 1 (`unknownIncomeShare`): not earned income until answered. */
  unknownIncomeShare: number;
  totals: PeriodTotals;
  /** Per-month averages over the complete months; null when the range has none. */
  average: Omit<CashflowRow, "month" | "savingsRate" | "complete" | "stack"> | null;
  /** The range holds the month that has not ended: its bills are out but its salary may not be in. */
  running: boolean;
  /** The bar Tulojen käyttö of the range's totals, the running month in them as in every other figure of the page. */
  bridge: BridgeView;
  /**
   * The range's totals with `inCents`, the money in (income and credit drawn) the period row of Raportit's month table
   * is laid against. One sum for the page: the rows of the table add up to it. Only `savingsRate` is told from the
   * complete months of a running range, since a month in progress reads as a loss.
   */
  whole: PeriodTotals & { inCents: number };
  /**
   * Where the money went, from the money in to the change of the accounts (Saldot's own `change`): the lines add up to
   * it with no remainder. Each line has its sum and the rows it is made of. null with no balances, or when Saldot has
   * no change to tell.
   */
  moneyBridge: MoneyBridge | null;
  /** The savings rate of the newest complete month beside the month before and the same month a year ago; null without a complete month with a rate. */
  rateCompare: RateCompare | null;
  /** The usual savings rate: the middle half of the complete months' rates and their median; null under four such months. */
  usualRate: { low: number; mid: number; high: number; months: number } | null;
}

/** Nearest-rank quantile of sorted values. */
const quantile = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;

/** The newest complete month's savings rate beside the month before and the same month a year ago, each told as `savingsRateOf` tells it. */
function rateCompareOf(ctx: AnalysisContext, rows: readonly CashflowRow[]): RateCompare | null {
  const last = rows.findLast((x) => x.complete && x.savingsRate !== null);
  if (!last) return null;
  const at = (month: string) => ({ month, rate: savingsRateOf(ctx, [month]).rate });
  return { month: last.month, rate: last.savingsRate!, previous: at(addMonths(last.month, -1)), yearAgo: at(addMonths(last.month, -12)) };
}

/** Money in vs. where it went (consumption, debt, savings), month by month. */
export function cashflowReport(ctx: AnalysisContext, range: DateRange, balances: readonly BalanceInput[] = []): CashflowReport {
  const months = rangeMonthIndexes(range, 24, ctx);
  // a range longer than the shown months: the rows are the last 24, the totals still cover the whole range
  const all = inDays(ctx, toDayRange(range));
  // a month's days within the range: the select of the month's income
  const daysOf = (month: string) => toDayRange({ from: range.from > `${month}-01` ? range.from : `${month}-01`, to: range.to < monthEnd(month) ? range.to : monthEnd(month) });
  const txs = all.filter((x) => x.month >= months[0]!);
  const rows = monthLabels(months).map((month, i) => {
    const inMonth = txs.filter((x) => x.month === months[i]);
    const t = totalsOf(inMonth.map((x) => x.flows));
    // the rate is a whole month's: a month the range cuts holds only part of it
    const wholeMonth = range.from <= `${month}-01` && range.to >= monthEnd(month);
    const incomeCents = sumOf(incomeSelect(ctx, daysOf(month)).counted, incomeCentsOf);
    const borrowedCents = coverOf(t).creditDrawnCents;
    // a part below zero (refunds over purchases) has no height in a stack
    const inCents = Math.max(0, incomeCents) + Math.max(0, borrowedCents);
    const outCents = Math.max(0, t.consumptionCents) + Math.max(0, t.debtCents) + Math.max(0, t.savedCents);
    return {
      month,
      incomeCents,
      consumptionCents: t.consumptionCents,
      debtCents: t.debtCents,
      savedCents: t.savedCents,
      borrowedCents,
      netCents: t.netCents,
      leftCents: t.leftCents,
      savingsRate: wholeMonth ? savingsRateOf(ctx, [month]).rate : null,
      complete: isCompleteMonth(ctx, month),
      stack: { inCents, outCents, gapCents: inCents - outCents },
    };
  });
  const running = range.from <= ctx.today && ctx.today <= range.to;
  const averaged = new Set(fullMonths(ctx, range, months));
  const base = rows.filter((_, i) => averaged.has(months[i]!));
  const avg = (key: keyof Omit<CashflowRow, "month" | "savingsRate" | "complete" | "stack">) => Math.round(base.reduce((s, r) => s + r[key], 0) / base.length);
  const totals = totalsOf(all.map((x) => x.flows));
  const closedMonths = monthRange(monthOf(range.from), monthOf(range.to)).filter((m) => `${m}-01` >= range.from && isCompleteMonth(ctx, m));
  const whole = { ...totals, inCents: totals.incomeCents + coverOf(totals).creditDrawnCents, savingsRate: running ? (closedMonths.length ? savingsRateOf(ctx, closedMonths).rate : null) : totals.savingsRate };
  const rates = rows.filter((x) => x.complete && x.savingsRate !== null).map((x) => x.savingsRate!).sort((a, b) => a - b);
  return {
    rows,
    bridge: bridgeView(totals),
    moneyBridge: moneyBridge(ctx, range, balances),
    whole,
    rateCompare: rateCompareOf(ctx, rows),
    usualRate: rates.length < 4 ? null : { low: quantile(rates, 0.25), mid: quantile(rates, 0.5), high: quantile(rates, 0.75), months: rates.length },
    unknownShare: unknownSpending(ctx, range).share,
    unknownIncomeShare: unknownIncomeShare(all),
    totals,
    running,
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
