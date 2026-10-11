/**
 * H-insights 10: calendar months that cost clearly more than usual in each of the last two years, and the monthly sum
 * that covers them. A month is compared with its usual level (the median of the six complete months before it) with
 * its one-off taken out by the month explanation's rule. One year alone cannot tell a season from chance, so a month
 * counts only when both of the last two years were 20 % or more above usual and stood out from the household's
 * month-to-month noise, each year by MIN_T / √2 standard errors, so the two together stand MIN_T apart and neither
 * carries it alone (ADR 0011).
 */
import { addMonths, monthEnd } from "../../dates.ts";
import { formatEur } from "../format.ts";
import { completeMonthsBefore, isCompleteMonth, usualSpending } from "../usual.ts";
import { capitalise, lastCompleteMonths, monthName, monthRows, monthStem, oneOffCents } from "./shared.ts";
import { MIN_T, monthlyNoise, monthT } from "../signal.ts";
import type { Insight, InsightArgs } from "./types.ts";

const MIN_SHARE = 0.2;
const YEARS = 2;
/** Each year's share of the test: two independent years at MIN_T / √2 each stand MIN_T apart together. */
const YEAR_T = MIN_T / Math.sqrt(YEARS);
/** The noise is read from up to this many months before the month: the same month a year earlier is left out, so a season does not count itself as noise. */
const NOISE_MONTHS = 11;

/** A month's spending with its one-off struck by the month explanation's rule; only a month over its usual level has one. */
function struckSpend(ctx: InsightArgs["ctx"], month: string): number {
  const spend = monthRows(ctx, month).spend;
  return spend - oneOffCents(ctx, month);
}

/** The month-to-month noise of the complete months before `month`, on the series the excess is measured on. */
function noise(ctx: InsightArgs["ctx"], month: string): number {
  return monthlyNoise(completeMonthsBefore(ctx, month, NOISE_MONTHS).map((m) => struckSpend(ctx, m)));
}

export interface Season {
  /** The month of the last year, `2025-12`; the year before is the same month 12 earlier. */
  month: string;
  /** The mean excess over the years, cents. */
  extra: number;
  /** Each year's excess over its usual level, one-off out, the latest first. */
  extras: number[];
}

/**
 * Calendar months of the last 12 complete months that were 20 % over usual, clear of the noise, in each of the last
 * two years. The insight sums them; Optimoi takes each month for itself.
 */
export function expensiveMonthItems({ ctx, end, gateMonthlyCents }: Pick<InsightArgs, "ctx" | "end" | "gateMonthlyCents">): Season[] {
  const recent = lastCompleteMonths(ctx, end, 12);
  if (recent.length < 12) return [];
  const seasons: Season[] = [];
  for (const month of recent) {
    const years = Array.from({ length: YEARS }, (_, k) => addMonths(month, -12 * k));
    const extras: number[] = [];
    for (const m of years) {
      const usual = isCompleteMonth(ctx, m) ? usualSpending(ctx, m) : null;
      if (usual === null || usual <= 0) break;
      const excess = struckSpend(ctx, m) - usual;
      if (excess < Math.max(MIN_SHARE * usual, 5 * gateMonthlyCents) || monthT(excess, noise(ctx, m), completeMonthsBefore(ctx, m).length) < YEAR_T) break;
      extras.push(excess);
    }
    if (extras.length === YEARS) seasons.push({ month, extra: Math.round(extras.reduce((s, v) => s + v, 0) / YEARS), extras });
  }
  return seasons;
}

export function expensiveMonths(args: InsightArgs): Insight[] {
  const { gateMonthlyCents } = args;
  const seasons = expensiveMonthItems(args);
  const yearly = seasons.reduce((s, x) => s + x.extra, 0);
  if (!seasons.length || yearly < 12 * gateMonthlyCents) return [];
  const top = [...seasons].sort((a, b) => b.extra - a.extra)[0]!;
  const stems = seasons.map((s) => monthStem(s.month));
  const names = stems.length === 1 ? `${stems[0]}kuun` : `${stems.slice(0, -1).map((s) => `${s}-`).join(", ")} ja ${stems[stems.length - 1]}kuun`;
  return [
    {
      id: `seasons:${seasons.map((s) => s.month.slice(5)).join("-")}`,
      tone: "info",
      title: `${capitalise(monthName(top.month))} ${formatEur(top.extra, false)} tavallista kalliimpi kahtena vuonna`,
      detail: `${capitalise(names)} lisämenot ${formatEur(yearly, false)} vuodessa, ${formatEur(Math.round(yearly / 12), false)} kuussa; kertaostot eivät ole mukana.`,
      yearlyCents: yearly,
      link: { from: `${top.month}-01`, to: monthEnd(top.month) },
    },
  ];
}
