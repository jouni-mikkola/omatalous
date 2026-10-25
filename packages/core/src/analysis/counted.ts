/**
 * The rows a sum figure counts and the cents each adds (ADR 0004): the one select behind a month's spending, a
 * category's spending, a month's income and a month's earned income. A report adds these rows up and `explain` lists
 * the same rows, so the figure and its explanation cannot differ. A spending figure takes its rows from `spendRows` (context.ts).
 */
import { type AnalysisContext, type AnalysisTx, inDays, spendRows } from "./context.ts";
import { type Flows, leftOf } from "./flows.ts";
import { isEarnedIncome } from "./income.ts";
import type { DayRange } from "./period.ts";

/** Cents a row adds to spending: consumption + debt, a refund below zero (`AnalysisTx.spend`). */
export const spendOf = (t: Pick<AnalysisTx, "spend">): number => t.spend;

/** Cents a row adds to income (`Flows.income`). */
export const incomeCentsOf = (t: Pick<AnalysisTx, "flows">): number => t.flows.income;

/** Cents a row adds to earned income: its income when `isEarnedIncome`, else 0. */
export const earnedOf = (t: Parameters<typeof isEarnedIncome>[0]): number => (isEarnedIncome(t) ? t.flows.income : 0);

/** Cents a row adds to Tulos (`leftOf` its flows). */
export const leftCentsOf = (t: { flows: Flows }): number => leftOf(t.flows);

/** The rows of `rows` that spending counts. */
const spendCounted = <T extends Pick<AnalysisTx, "spend">>(rows: readonly T[]): T[] => rows.filter((t) => t.spend !== 0);

/** The rows of `rows` that income counts. */
const incomeCounted = <T extends Pick<AnalysisTx, "flows">>(rows: readonly T[]): T[] => rows.filter((t) => t.flows.income !== 0);

/** The rows of `rows` that earned income counts. */
const earnedCounted = <T extends Parameters<typeof isEarnedIncome>[0]>(rows: readonly T[]): T[] => rows.filter((t) => earnedOf(t) !== 0);

/** The rows of `rows` that Tulos counts. */
const leftCounted = <T extends { flows: Flows }>(rows: readonly T[]): T[] => rows.filter((t) => leftOf(t.flows) !== 0);

/** The sum of what `cents` says each of the counted rows adds. */
export function sumOf<T>(rows: readonly T[], cents: (t: T) => number): number {
  let sum = 0;
  for (const t of rows) sum += cents(t);
  return sum;
}

/** The one select of a spending figure: the rows of the range as spending reads them, and the ones it counts. */
export function spendSelect(ctx: AnalysisContext, r: DayRange): { rows: AnalysisTx[]; counted: AnalysisTx[] } {
  const rows = spendRows(ctx, r);
  return { rows, counted: spendCounted(rows) };
}

/** The one select of an income figure. */
export function incomeSelect(ctx: AnalysisContext, r: DayRange): { rows: AnalysisTx[]; counted: AnalysisTx[] } {
  const rows = inDays(ctx, r);
  return { rows, counted: incomeCounted(rows) };
}

/** The one select of an earned income figure. */
export function earnedSelect(ctx: AnalysisContext, r: DayRange): { rows: AnalysisTx[]; counted: AnalysisTx[] } {
  const rows = inDays(ctx, r);
  return { rows, counted: earnedCounted(rows) };
}

/**
 * The one select of Tulos as the cash flow report has it (`totalsOf` the booked rows of the days): the rows whose flows
 * add up to income + borrowed − expenses − saved, each bill whole. The first page's totals read the rows of `spendRows`
 * instead, which a card statement lowers.
 */
export function bookedLeftSelect(ctx: AnalysisContext, r: DayRange): { rows: AnalysisTx[]; counted: AnalysisTx[] } {
  const rows = inDays(ctx, r);
  return { rows, counted: leftCounted(rows) };
}

/**
 * The one select of a month's spending as the usual level reads it (`usualSpending`): the booked rows of the days, each
 * bill whole, with no statement rows. The same days as `spendSelect`, which reads each bill at what its statement rows
 * leave of it.
 */
export function bookedSpendSelect(ctx: AnalysisContext, r: DayRange): { rows: AnalysisTx[]; counted: AnalysisTx[] } {
  const rows = inDays(ctx, r);
  return { rows, counted: spendCounted(rows) };
}
