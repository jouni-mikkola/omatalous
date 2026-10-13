/**
 * The ruler over a column of category bars: the ticks of `barScale` for the longest row and the step between two of them,
 * which the stylesheet repeats down the column as the lines the bars are read against. Null (no ruler) where `barScale` is.
 */
import { barScale } from "../../marks.ts";

export interface Ruler {
  ticks: { at: number; label: string | null }[];
  /** The distance between two ticks, as a percent of the longest bar (two decimals). */
  step: string;
}

export function rulerOf(longestCents: number): Ruler | null {
  const ticks = barScale(longestCents);
  if (!ticks) return null;
  return { ticks, step: `${Math.round((ticks[1]!.at - ticks[0]!.at) * 100) / 100}%` };
}
