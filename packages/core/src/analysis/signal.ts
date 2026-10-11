/**
 * Whether a change stands out from the household's own month-to-month noise (ADR 0011). Every insight and alert that
 * sets one window of months against another, or one month against its usual level, passes this test before it is
 * told, and so do Optimoi's food and habit areas.
 *
 * The noise is the mean moving range of the monthly series over 1.128 (Shewhart's individuals chart): the standard
 * deviation of a month for a series without a change. A step between two months adds one range, so a real change does
 * not count itself as noise, as a window's variance counts a step inside the window.
 */
import { sum } from "../stats.ts";

/**
 * A change must stand this many standard errors from nothing. At 2.5 three of the kit's 200 steady households read as
 * spending growth; at 4 none of them as any insight or alert.
 */
export const MIN_T = 4;

/** The mean moving range of a normal series is 1.128 standard deviations. */
const RANGE_PER_SD = 1.128;

const mean = (xs: readonly number[]) => sum(xs) / xs.length;

/** The month-to-month noise of one or more monthly series, as a standard deviation; 0 without two months in a series. */
export function monthlyNoise(...series: readonly (readonly number[])[]): number {
  const ranges = series.flatMap((xs) => xs.slice(1).map((v, i) => Math.abs(v - xs[i]!)));
  return ranges.length ? sum(ranges) / ranges.length / RANGE_PER_SD : 0;
}

/** Whether `change` stands MIN_T standard errors `se` from nothing. A change without noise around it always does. */
function standsOut(change: number, se: number): boolean {
  return change !== 0 && Math.abs(change) >= MIN_T * se;
}

/**
 * Whether the means of two windows of months stand apart, in either direction. The noise defaults to the two windows'
 * own; a window of one month has no range, so its caller passes the noise of the months around it.
 */
export function meansApart(now: readonly number[], then: readonly number[], noise = monthlyNoise(now, then)): boolean {
  if (!now.length || !then.length) return false;
  return standsOut(mean(now) - mean(then), noise * Math.sqrt(1 / now.length + 1 / then.length));
}

/** Whether the mean of `now` stands MIN_T standard errors above the mean of `then`. */
export function clearlyAbove(now: readonly number[], then: readonly number[]): boolean {
  return mean(now) > mean(then) && meansApart(now, then);
}

/**
 * How many standard errors one month stands `excess` above a usual level, the median of `months` months: the error
 * holds the month's own noise and the level's (a median of n months varies π/2n of a month's variance). Infinite
 * when there is no noise.
 */
export function monthT(excess: number, noise: number, months: number): number {
  const se = noise * Math.sqrt(1 + Math.PI / (2 * Math.max(1, months)));
  return se > 0 ? excess / se : excess > 0 ? Infinity : excess < 0 ? -Infinity : 0;
}

/** Whether one month stands MIN_T standard errors above its usual level (`monthT`). */
export function monthStandsOut(excess: number, noise: number, months: number): boolean {
  return monthT(excess, noise, months) >= MIN_T;
}
