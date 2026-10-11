/**
 * "Tavallisesti" and "valmis kuukausi": the one yardstick every view uses to say what is usual and which months may
 * be compared. A running month, or one the history does not cover from the 1st, is never part of it, and fewer than
 * three months say nothing. The usual spending, the usual income and the gate a cause must pass are defined here once
 * (ADR 0004). See docs/MONEY_FLOWS.md.
 */
import { fromMonthIndex, monthEnd, monthIndex } from "../dates.ts";
import { median } from "../stats.ts";
import { type AnalysisContext, historyCovers } from "./context.ts";
import { isEarnedIncome } from "./income.ts";

/** The usual level is the median of this many complete months at most. */
export const USUAL_MONTHS = 6;
/** Fewer complete months than this give no usual level and no comparison. */
export const MIN_COMPARE_MONTHS = 3;

type MonthContext = Pick<AnalysisContext, "dataFrom" | "today">;

/** The month (`2026-09`) has ended and the history covers it from the 1st. */
export function isCompleteMonth(ctx: MonthContext, month: string): boolean {
  const end = monthEnd(month);
  return end < ctx.today && historyCovers(ctx, `${month}-01`);
}

/**
 * The complete months right before `month`, at most `n`, oldest first. It stops at the first month that is not
 * complete, so a history that starts later gives fewer (none when `month` itself is in the future).
 */
export function completeMonthsBefore(ctx: MonthContext, month: string, n: number = USUAL_MONTHS): string[] {
  const out: string[] = [];
  for (let i = monthIndex(month) - 1; out.length < n; i--) {
    const label = fromMonthIndex(i);
    if (!isCompleteMonth(ctx, label)) break;
    out.push(label);
  }
  return out.reverse();
}

/**
 * The first day with `MIN_COMPARE_MONTHS` complete months behind it: the 1st of the month after the third month the
 * history covers from its first day. Null without history.
 */
export function usualFrom(ctx: MonthContext): string | null {
  if (!ctx.dataFrom) return null;
  const start = monthIndex(ctx.dataFrom.slice(0, 7));
  const first = historyCovers(ctx, `${fromMonthIndex(start)}-01`) ? start : start + 1;
  return `${fromMonthIndex(first + MIN_COMPARE_MONTHS)}-01`;
}

/**
 * The usual level of a month figure: the median of the values of `completeMonthsBefore(ctx, month, USUAL_MONTHS)`,
 * in whole cents, or null under three values.
 */
export function usualCents(values: readonly number[]): number | null {
  return values.length < MIN_COMPARE_MONTHS ? null : Math.round(median(values));
}

interface MonthSums {
  /** consumption + debt */
  spend: number;
  /** Income without money from people and refunds (`isEarnedIncome`). */
  earned: number;
}

const ZERO: MonthSums = { spend: 0, earned: 0 };
const sums = new WeakMap<AnalysisContext, Map<number, MonthSums>>();

/** A month's spending and earned income, summed once per context. */
function monthSums(ctx: AnalysisContext, month: string): MonthSums {
  let byMonth = sums.get(ctx);
  if (!byMonth) {
    byMonth = new Map();
    for (const t of ctx.txs) {
      let e = byMonth.get(t.month);
      if (!e) byMonth.set(t.month, (e = { spend: 0, earned: 0 }));
      e.spend += t.spend;
      if (isEarnedIncome(t)) e.earned += t.flows.income;
    }
    sums.set(ctx, byMonth);
  }
  return byMonth.get(monthIndex(month)) ?? ZERO;
}

/** A month's earned income (`isEarnedIncome`): what `usualIncome` is the median of. */
export function earnedIncome(ctx: AnalysisContext, month: string): number {
  return monthSums(ctx, month).earned;
}

/**
 * The usual level of a month's total spending: the median of the complete months before it, whole months (the
 * dashed line of the monthly chart). null under three complete months.
 */
export function usualSpending(ctx: AnalysisContext, month: string): number | null {
  return usualCents(completeMonthsBefore(ctx, month).map((m) => monthSums(ctx, m).spend));
}

/**
 * Tavalliset tulot: the median earned income of the complete months before `month`. Money from people and refunds
 * are left out, as the income report leaves them out. null under three complete months.
 */
export function usualIncome(ctx: AnalysisContext, month: string): number | null {
  return usualCents(completeMonthsBefore(ctx, month).map((m) => earnedIncome(ctx, m)));
}

/** A cause or a finding is worth its own line from this share of its base a month (H-insights section 1). */
export const GATE_SHARE = 0.02;
/** The gate is never under 10 € a month. */
export const GATE_FLOOR_CENTS = 1000;

/**
 * The smallest figure worth its own line against `baseCents` a month: 2 % of it, at least `floorCents` (10 €). The
 * income views pass their own floor.
 */
export function gateFor(baseCents: number, floorCents: number = GATE_FLOOR_CENTS): number {
  return Math.max(floorCents, Math.round(GATE_SHARE * baseCents));
}
