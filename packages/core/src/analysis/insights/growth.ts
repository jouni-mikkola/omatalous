/**
 * H-insights 6: purchases without bills and subscriptions grew faster than income. The last six complete months are
 * set against the same months a year earlier (12 against 12 with 24 months of history), each month without its
 * one-off. Income leaves out refunds and payments from people. The months now must stand out from the household's
 * month-to-month noise (`clearlyAbove`). The figure is in euros of each year: no claim about real terms and no cause.
 */
import { daysInMonth } from "../../dates.ts";
import { median } from "../../stats.ts";
import { formatEur } from "../format.ts";
import { clearlyAbove } from "../signal.ts";
import { earnedIncome, isCompleteMonth } from "../usual.ts";
import { capitalise, lastCompleteMonths, monthRows, monthSpan, purchasesWithoutOneOff, shiftMonth } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";

/** Purchases must grow this many percentage points more than income. */
const MIN_GAP = 0.05;
/** Flat purchases are no news, whatever income did. */
const MIN_GROWTH = 0.05;

/** "+14 %", "−3 %", "±0 %" */
export function signedPercent(share: number): string {
  const p = Math.round(share * 100);
  return p === 0 ? "±0 %" : `${p > 0 ? "+" : "−"}${Math.abs(p)} %`;
}

/** Purchases of the window without one-offs, month by month and in total, and its usual monthly income. */
function window(ctx: InsightArgs["ctx"], months: readonly string[]): { monthly: number[]; purchases: number; income: number } {
  const usual = median(months.map((m) => monthRows(ctx, m).purchases));
  const monthly = months.map((m) => purchasesWithoutOneOff(ctx, m, usual));
  return { monthly, purchases: monthly.reduce((s, v) => s + v, 0), income: median(months.map((m) => earnedIncome(ctx, m))) };
}

export function spendingOutgrowsIncome({ ctx, end, gateMonthlyCents }: InsightArgs): Insight[] {
  const twelve = lastCompleteMonths(ctx, end, 12);
  const long = twelve.length === 12 && isCompleteMonth(ctx, shiftMonth(twelve[0]!, -12));
  const now = long ? twelve : twelve.slice(-6);
  if (now.length < 6 || !isCompleteMonth(ctx, shiftMonth(now[0]!, -12))) return [];
  const then = now.map((m) => shiftMonth(m, -12));
  const a = window(ctx, now);
  const b = window(ctx, then);
  if (a.purchases <= 0 || b.purchases <= 0 || a.income <= 0 || b.income <= 0) return [];
  const purchasesGrowth = a.purchases / b.purchases - 1;
  const incomeGrowth = a.income / b.income - 1;
  // what purchases cost beyond keeping pace with income, over a year, and never more than they grew
  const extra = Math.min(a.purchases - b.purchases, a.purchases - b.purchases * (1 + incomeGrowth));
  const yearly = Math.round((extra * 12) / now.length);
  if (purchasesGrowth < MIN_GROWTH || purchasesGrowth - incomeGrowth < MIN_GAP || yearly < 12 * gateMonthlyCents) return [];
  // purchases swing month to month: the months now must stand clear of that
  if (!clearlyAbove(a.monthly, b.monthly)) return [];
  const first = now[0]!;
  const last = now[now.length - 1]!;
  return [
    {
      id: "spending-growth",
      tone: "warning",
      title: `Ostokset ${signedPercent(purchasesGrowth)} vuodessa, tulot ${signedPercent(incomeGrowth)}`,
      detail: `${capitalise(monthSpan(first, last))} verrattuna samaan aikaan vuotta aiemmin, ilman laskuja, tilauksia ja kertaostoja; ero ${formatEur(yearly, false)} vuodessa.`,
      yearlyCents: yearly,
      link: { from: `${first}-01`, to: `${last}-${String(daysInMonth(last)).padStart(2, "0")}` },
    },
  ];
}
