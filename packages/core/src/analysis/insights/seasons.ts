/**
 * H-insights 10: calendar months that cost clearly more than usual in each of the last two years, and the monthly sum
 * that covers them. A month is compared with its usual level (the median of the six complete months before it) with
 * its one-off taken out by the month explanation's rule. One year alone cannot tell a season from chance, so a month
 * counts only when both of the last two years were 20 % or more above usual, and by more than three times the usual
 * month-to-month swing.
 */
import { daysInMonth } from "../../dates.ts";
import { usualSpending } from "../explain.ts";
import { formatEur } from "../format.ts";
import { median } from "../../stats.ts";
import { completeMonthsBefore, isCompleteMonth } from "../usual.ts";
import { capitalise, lastCompleteMonths, monthName, monthRows, monthStem, oneOff, shiftMonth } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";

const MIN_SHARE = 0.2;
const YEARS = 2;
/** The excess must also be this many times the usual month-to-month swing (MAD of the six months before, as a standard deviation). */
const MIN_SWINGS = 3;

/** How much the six complete months before `month` swing around their median, as a standard deviation. */
function swing(ctx: InsightArgs["ctx"], month: string): number {
  const values = completeMonthsBefore(ctx, month).map((m) => monthRows(ctx, m).spend);
  const mid = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - mid)));
}

interface Season {
  month: string;
  /** The mean excess over the years, cents. */
  extra: number;
}

export function expensiveMonths({ ctx, end, gateMonthlyCents }: InsightArgs): Insight[] {
  const recent = lastCompleteMonths(ctx, end, 12);
  if (recent.length < 12) return [];
  const seasons: Season[] = [];
  for (const month of recent) {
    const years = Array.from({ length: YEARS }, (_, k) => shiftMonth(month, -12 * k));
    const extras: number[] = [];
    for (const m of years) {
      const usual = isCompleteMonth(ctx, m) ? usualSpending(ctx, m) : null;
      if (usual === null || usual <= 0) break;
      const spend = monthRows(ctx, m).spend;
      const one = oneOff(ctx, m, spend - usual);
      const excess = spend - (one ? Math.max(0, one.spend - one.refunded) : 0) - usual;
      if (excess < Math.max(MIN_SHARE * usual, 5 * gateMonthlyCents, MIN_SWINGS * swing(ctx, m))) break;
      extras.push(excess);
    }
    if (extras.length === YEARS) seasons.push({ month, extra: Math.round(extras.reduce((s, v) => s + v, 0) / YEARS) });
  }
  const yearly = seasons.reduce((s, x) => s + x.extra, 0);
  if (!seasons.length || yearly < 12 * gateMonthlyCents) return [];
  const top = [...seasons].sort((a, b) => b.extra - a.extra)[0]!;
  const stems = seasons.map((s) => monthStem(s.month));
  const names = stems.length === 1 ? `${stems[0]}kuun` : `${stems.slice(0, -1).map((s) => `${s}-`).join(", ")} ja ${stems[stems.length - 1]}kuun`;
  const last = (m: string) => `${m}-${String(daysInMonth(m)).padStart(2, "0")}`;
  return [
    {
      id: `seasons:${seasons.map((s) => s.month.slice(5)).join("-")}`,
      tone: "info",
      title: `${capitalise(monthName(top.month))} ${formatEur(top.extra, false)} tavallista kalliimpi kahtena vuonna`,
      detail: `${capitalise(names)} lisämenot ${formatEur(yearly, false)} vuodessa, ${formatEur(Math.round(yearly / 12), false)} kuussa; kertaostot eivät ole mukana.`,
      yearlyCents: yearly,
      link: { from: `${top.month}-01`, to: last(top.month) },
    },
  ];
}
