import type { AnalysisContext, AnalysisTx } from "./context.ts";
import { spendOf, spendSelect, sumOf } from "./counted.ts";
import { toDayRange } from "./period.ts";
import { dayNumber, fromDayNumber } from "../dates.ts";

/** The spending of one day: `cents` as the month's spending counts it (`spendOf`), a refund day can be below zero. */
interface DayTotal {
  date: string;
  cents: number;
  count: number;
}

/**
 * Spending day by day from `start` to `to`, a day with no row at 0. A habit (the weekly shop) is the household's own
 * day and stays; the rows of a recurring bill or subscription (rent, electricity, loan payments) are left out, since the
 * payee sets their day. `recurringCents` is what was left out. The calendar of Raportit and the weekday insight read it.
 */
export function daySpend(ctx: AnalysisContext, start: string, to: string): { days: DayTotal[]; rowsOf: (day: string) => readonly AnalysisTx[]; recurringCents: number } {
  const inSeries = new Set(ctx.recurring.filter((s) => s.kind === "bill" || s.kind === "subscription").flatMap((s) => s.transactionIds));
  const all = spendSelect(ctx, toDayRange({ from: start, to })).counted;
  const counted = all.filter((t) => !inSeries.has(t.id));
  const byDay = new Map<number, AnalysisTx[]>();
  for (const t of counted) byDay.set(t.day, [...(byDay.get(t.day) ?? []), t]);
  const days: DayTotal[] = [];
  for (let n = dayNumber(start); n <= dayNumber(to); n++) {
    const rows = byDay.get(n) ?? [];
    days.push({ date: fromDayNumber(n), cents: sumOf(rows, spendOf), count: rows.length });
  }
  return { days, rowsOf: (day) => byDay.get(dayNumber(day)) ?? [], recurringCents: sumOf(all, spendOf) - sumOf(counted, spendOf) };
}
