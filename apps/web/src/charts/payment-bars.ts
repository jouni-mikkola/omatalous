// The geometry of the daily bars of Laskut: one bar to a day, one stacked piece to each payment of that day.
// Nothing here knows what a bill is; the heights are shares of the plot, so the drawing needs no measured width.
import { niceTicks } from "./scale.ts";

interface PieceIn {
  /** The day's place on the axis, from 0. */
  column: number;
  /** The sum, in positive cents. */
  cents: number;
}

interface Piece {
  /** The place of the payment in the input. */
  index: number;
  column: number;
  /** Where the piece starts and ends in the bar of its day, as a share of the plot's height from 0 to 1. */
  from: number;
  to: number;
}

interface Bars {
  pieces: Piece[];
  /** The value axis, in cents: 0 and the round steps up to the top of the plot. */
  ticks: number[];
  /** The place of a tick as a share of the plot's height. */
  at: (cents: number) => number;
}

/**
 * Stacks the payments of one day on each other in the order given and scales every bar against the tallest day, which
 * ends a little under the top of the plot at a round tick. The pieces of a day are never added into one printed sum.
 */
export function stackBars(input: readonly PieceIn[]): Bars {
  const filled = new Map<number, number>();
  const stacked = input.map(({ column, cents }, index) => {
    const base = filled.get(column) ?? 0;
    filled.set(column, base + cents);
    return { index, column, base, top: base + cents };
  });
  const { ticks, max } = niceTicks(Math.max(0, ...filled.values()), 3);
  return {
    pieces: stacked.map(({ index, column, base, top }) => ({ index, column, from: base / max, to: top / max })),
    ticks,
    at: (cents) => cents / max,
  };
}

/** The room a day's label takes on the axis, in rem: a weekday over a day and a dot is about 1.1 rem wide, plus a gap. */
const LABEL_REM = 1.4;

/** How many labels an axis `widthPx` wide has room for side by side when 1 rem is `remPx` (a fraction, not rounded). */
export function labelRoom(widthPx: number, remPx: number): number {
  return widthPx / remPx / LABEL_REM;
}

/**
 * Whether the day at `column` of `columns` carries a label under its bar: every day while they fit, else every few
 * days. `fits` is how many labels the axis has room for side by side (`labelRoom`, all of them when it is not
 * measured), so a wide text or a narrow screen takes a longer step. The last day, the payday, always carries one, and a day before it
 * gives way when it would touch it.
 */
export function carriesLabel(columns: number, column: number, fits: number = columns): boolean {
  if (column === columns - 1) return true;
  const step = Math.max(Math.ceil(columns / 12), Math.ceil(columns / Math.max(1, fits)));
  return column % step === 0 && columns - 1 - column >= step;
}
