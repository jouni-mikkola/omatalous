/**
 * Words and months of the spending change: the month names, the span of a period and which month a range is judged on.
 * Shared by the spending change report and its insights, which live on both sides of the analysis/reports line.
 */
import { addMonths, monthOf } from "../dates.ts";
import type { AnalysisContext } from "./context.ts";
import { formatEur } from "./format.ts";
import type { DateRange } from "./period.ts";
import { isCompleteMonth } from "./usual.ts";

const MONTHS = ["tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu", "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu"];
export const monthName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1]!;
export const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const signed = (cents: number) => `${cents < 0 ? "−" : "+"}${formatEur(Math.abs(cents), false)}`;

/** "lokakuu 2026", "kesä–elokuu 2026", "marraskuu 2025–lokakuu 2026". */
export function spanLabel(months: readonly string[]): string {
  const first = months[0]!;
  const last = months[months.length - 1]!;
  if (first === last) return `${monthName(last)} ${last.slice(0, 4)}`;
  if (first.slice(0, 4) !== last.slice(0, 4)) return `${monthName(first)} ${first.slice(0, 4)}–${monthName(last)} ${last.slice(0, 4)}`;
  return `${monthName(first).replace(/kuu$/, "")}–${monthName(last)} ${last.slice(0, 4)}`;
}


/** The month the range ends in (not after today), and the last complete month at or before it. */
export function changeMonths(ctx: AnalysisContext, range: DateRange): { month: string; lastComplete: string } {
  const month = monthOf(range.to < ctx.today ? range.to : ctx.today);
  return { month, lastComplete: isCompleteMonth(ctx, month) ? month : addMonths(month, -1) };
}
