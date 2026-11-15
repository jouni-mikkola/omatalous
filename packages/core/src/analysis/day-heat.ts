import { heatLevels } from "./heat.ts";
import { sumOf } from "./counted.ts";

/**
 * The usual spending day of a run of days and each day's shade against it, by `heatLevels` (the shade of the month
 * heat map): the mean of the ended days that had spending, since a day with nothing is not a cheap day but a day off.
 * Today is not ended, so it is plain and stays out of the mean. Any day series can be shaded with it: the calendar of
 * Tapahtumat, the rows a filter leaves.
 */
export function dayHeat(days: readonly { date: string; cents: number }[], today: string): { usualCents: number | null; heat: number[] } {
  const complete = days.map((d) => d.date < today);
  const spent = days.filter((d, i) => complete[i] && d.cents > 0);
  const usualCents = spent.length ? Math.round(sumOf(spent, (d) => d.cents) / spent.length) : null;
  return { usualCents, heat: heatLevels(days.map((d) => d.cents), complete, usualCents) };
}
