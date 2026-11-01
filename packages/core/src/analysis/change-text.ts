/**
 * Words and months of the spending change: the month names, the span of a period and which month a range is judged on.
 * Shared by the spending change report and its insights, which live on both sides of the analysis/reports line.
 */
import { addMonths, monthOf } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import type { AnalysisContext } from "./context.ts";
import type { Language } from "../locale.ts";
import { messageIn } from "../messages.ts";
import { DEFAULT_LANGUAGE } from "../locale.ts";
import { formatEur, formatFiDate, monthName, monthNameIn } from "./format.ts";
import type { DateRange } from "./period.ts";
import { isCompleteMonth } from "./usual.ts";

/** "10.10. mennessä": the day a running month is cut at when the rows end before today, so its figures never read as today's. null when they reach today. */
export const cutWords = (running: boolean, through: IsoDate, today: IsoDate, lang: Language = DEFAULT_LANGUAGE): string | null =>
  running && through < today ? messageIn(lang, "rep.cut_by", { date: formatFiDate(through, lang).replace(lang === "en" ? /\/\d{4}$/ : /\d{4}$/, "") }) : null;
export const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const signed = (cents: number, lang: Language = DEFAULT_LANGUAGE) => `${cents < 0 ? "−" : "+"}${formatEur(Math.abs(cents), false, lang)}`;

/** "lokakuu 2026", "kesä–elokuu 2026", "marraskuu 2025–lokakuu 2026". */
export function spanLabel(months: readonly string[], lang: Language = DEFAULT_LANGUAGE): string {
  const first = months[0]!;
  const last = months[months.length - 1]!;
  if (first === last) return `${monthNameIn(last, lang)} ${last.slice(0, 4)}`;
  if (first.slice(0, 4) !== last.slice(0, 4)) return `${monthNameIn(first, lang)} ${first.slice(0, 4)}–${monthNameIn(last, lang)} ${last.slice(0, 4)}`;
  if (lang === "en") return `${monthNameIn(first, lang)}–${monthNameIn(last, lang)} ${last.slice(0, 4)}`;
  return `${monthName(first).replace(/kuu$/, "")}–${monthName(last)} ${last.slice(0, 4)}`;
}


/** The month the range ends in (not after today), and the last complete month at or before it. */
export function changeMonths(ctx: AnalysisContext, range: DateRange): { month: string; lastComplete: string } {
  const month = monthOf(range.to < ctx.today ? range.to : ctx.today);
  return { month, lastComplete: isCompleteMonth(ctx, month) ? month : addMonths(month, -1) };
}
