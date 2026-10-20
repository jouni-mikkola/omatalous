// Decision: spend less or save more
import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { unknownSpending } from "../analysis/data-quality.ts";
import { incomeCentsOf, incomeSelect, sumOf } from "../analysis/counted.ts";
import { savingsRateOf } from "../analysis/bridge.ts";
import { type BridgeView, bridgeView } from "../analysis/bridge-view.ts";
import { unknownIncomeShare } from "../analysis/income.ts";
import { coverOf, type PeriodTotals, totalsOf } from "../analysis/flows.ts";
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
  /** Credit drawn in the month, net of what was paid back and never below zero (`coverOf`). */
  borrowedCents: number;
  netCents: number;
  /** Yli jäi of the month, `PeriodTotals.leftCents` as `totalsOf` gives it: this report holds no sum of its own. */
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
  /**
   * Totals of the complete months of a range that holds the running month; null when it has no running month or
   * no complete one. The margin and savings rate are told from these, since a month in progress reads as a loss.
   */
  closed: PeriodTotals | null;
  /** How many complete months `closed` holds: the title of the bar names them. 0 without a running month. */
  closedMonths: number;
  /** The bar Tulojen käyttö of the settled totals (`closed` of a running range, else `totals`); null with no settled month. */
  bridge: BridgeView | null;
  /**
   * The totals the page tells as the period's (the bridge's: `closed` of a running range, else `totals`) with
   * `inCents`, the money in (income and credit drawn) the period row of Raportit's month table is laid against. null
   * when a running range has no complete month.
   */
  settled: (PeriodTotals & { inCents: number }) | null;
  /** Yli jäi added up from January, this year against the year before: the cumulative chart of Raportit. */
  yearToDate: YearToDate;
  /** The usual savings rate: the middle half of the complete months' rates and their median; null under four such months. */
  usualRate: { low: number; mid: number; high: number; months: number } | null;
}

export interface YearToDate {
  /** The calendar year of the range's end. */
  year: number;
  /**
   * Yli jäi added up from 1 January to the end of each month (index 0 = January). A year whose January the history
   * does not cover from the 1st has no line (all null): a sum from a later month would read as a smaller year.
   */
  current: (number | null)[];
  previous: (number | null)[];
  /** The month (0–11) of `current` that has not ended: its point is an estimate, its salary may not be in yet. */
  partialMonth: number | null;
  /** This year less last year at the end of the newest ended month both lines have: the answer under the chart. */
  compared: { month: number; cents: number } | null;
}

/** Yli jäi from January of `year`, month by month up to `lastMonth` (1–12), or all null when a month is not covered. */
function leftFromJanuary(ctx: AnalysisContext, year: number, lastMonth: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: 12 }, () => null);
  const txs = inDays(ctx, toDayRange({ from: `${year}-01-01`, to: `${year}-12-31` }));
  let sum = 0;
  for (let m = 1; m <= lastMonth; m++) {
    const month = `${year}-${String(m).padStart(2, "0")}`;
    const running = monthEnd(month) >= ctx.today;
    // the running month is whole from its 1st when the month before it is: every earlier month of the year was checked
    // already, and January's is last December
    if (running ? m === 1 && !isCompleteMonth(ctx, `${year - 1}-12`) : !isCompleteMonth(ctx, month)) return out.fill(null);
    sum += totalsOf(txs.filter((x) => x.month === monthIndex(month)).map((x) => x.flows)).leftCents;
    out[m - 1] = sum;
    if (running) break;
  }
  return out;
}

/** Nearest-rank quantile of sorted values. */
const quantile = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;

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
  // the same months as the dashboard's settled totals: complete, and in the range from their 1st
  const closedMonths = new Set(monthRange(monthOf(range.from), monthOf(range.to)).filter((m) => `${m}-01` >= range.from && isCompleteMonth(ctx, m)).map(monthIndex));
  const closedFlows = running ? all.filter((x) => closedMonths.has(x.month)) : [];
  const averaged = new Set(fullMonths(ctx, range, months));
  const base = rows.filter((_, i) => averaged.has(months[i]!));
  const avg = (key: keyof Omit<CashflowRow, "month" | "savingsRate" | "complete" | "stack">) => Math.round(base.reduce((s, r) => s + r[key], 0) / base.length);
  const totals = totalsOf(all.map((x) => x.flows));
  const closed = closedFlows.length ? totalsOf(closedFlows.map((x) => x.flows)) : null;
  const settled = running ? closed : totals;
  const end = monthOf(range.to);
  const year = Number(end.slice(0, 4));
  const lastMonth = Number(end.slice(5, 7));
  const current = leftFromJanuary(ctx, year, lastMonth);
  const previous = leftFromJanuary(ctx, year - 1, 12);
  const partialMonth = monthEnd(end) >= ctx.today ? lastMonth - 1 : null;
  const both = current.map((v, i) => (v !== null && previous[i] !== null && i !== partialMonth ? i : -1)).filter((i) => i >= 0);
  const at = both.length ? both[both.length - 1]! : null;
  const rates = rows.filter((x) => x.complete && x.savingsRate !== null).map((x) => x.savingsRate!).sort((a, b) => a - b);
  return {
    rows,
    bridge: settled ? bridgeView(settled) : null,
    settled: settled && { ...settled, inCents: settled.incomeCents + coverOf(settled).creditDrawnCents },
    yearToDate: { year, current, previous, partialMonth, compared: at === null ? null : { month: at, cents: current[at]! - previous[at]! } },
    usualRate: rates.length < 4 ? null : { low: quantile(rates, 0.25), mid: quantile(rates, 0.5), high: quantile(rates, 0.75), months: rates.length },
    unknownShare: unknownSpending(ctx, range).share,
    unknownIncomeShare: unknownIncomeShare(all),
    totals,
    running,
    closed,
    closedMonths: closedFlows.length ? closedMonths.size : 0,
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
