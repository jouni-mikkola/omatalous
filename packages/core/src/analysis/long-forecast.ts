/**
 * The coming months as a simulation with a range. The saving of a month is its earned income less its spending (`earnedIncome`, `spendingThrough`, the one definition
 * of both, ADR 0004); the complete months before (`completeMonthsBefore`) teach the model (`simulateNet`). A path adds its months up, and
 * the range of a month is the 5th to the 95th percentile of all the paths. The draw is seeded: the same rows and the
 * same seed give the same range on every machine, and nothing here reads the clock or the environment.
 * The figure is the net saving of a month, earned income less spending (consumption + debt). Money moved to savings is
 * not spent, so it stays in it; the principal of a loan is, and the report adds it back to the net worth.
 */
import { FORECAST_HISTORY_MONTHS, FORECAST_LEVEL, FORECAST_RUNS, FORECAST_TAIL, MIN_COMPARE_MONTHS } from "../thresholds.ts";
import { type AnalysisContext } from "./context.ts";
import { quantile } from "./expected.ts";
import { completeMonthsBefore, earnedIncome, spendingThrough } from "./usual.ts";

/** A small seeded generator (mulberry32): the same seed gives the same numbers on every machine. */
function seededRandom(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a complete month left over: earned income less spending, cents. */
const monthNetCents = (ctx: AnalysisContext, month: string): number => earnedIncome(ctx, month) - spendingThrough(ctx, month);

/** The net saving of each complete month before `month`; null under `MIN_COMPARE_MONTHS` of them. */
export function netSamples(ctx: AnalysisContext, month: string): number[] | null {
  const months = completeMonthsBefore(ctx, month, FORECAST_HISTORY_MONTHS);
  return months.length < MIN_COMPARE_MONTHS ? null : months.map((m) => monthNetCents(ctx, m));
}

interface SimulatedRange {
  /** Per simulated month: the range of that month's own net saving. */
  month: { lowCents: number; midCents: number; highCents: number }[];
  /** Per simulated month: the range of the sum of the net savings from the first month to this one. */
  total: { lowCents: number; midCents: number; highCents: number }[];
}

const spread = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { lowCents: quantile(sorted, FORECAST_TAIL), midCents: quantile(sorted, 0.5), highCents: quantile(sorted, 1 - FORECAST_TAIL) };
};

/**
 * The factor a draw's distance from the mean grows by for a sample of `n` months. A few months show less of the spread
 * than the household has, so the range is widened the way a prediction interval is (Student's t over the normal, and
 * the mean's own error): about 1.8 for 3 months, 1.3 for 6, 1.1 for 24.
 */
const smallSampleFactor = (n: number): number => Math.sqrt(1 + 1 / n) * (1 + 1.6 / Math.max(1, n - 1));

/** A standard normal draw from two uniform ones (Box-Muller). */
const normal = (random: () => number): number => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

/**
 * `runs` paths of `months` months, each month a smoothed draw from `samples` (the net saving of the months before): one
 * of them at random, plus a normal draw sized so that the spread of the draws is `smallSampleFactor` times the spread
 * of the months, part of it as one level a whole path keeps (`FORECAST_LEVEL`), so that the sum of months widens the way a drift of the household's level does. The smoothing lets a month fall beyond the months seen, which a plain draw with replacement cannot.
 * The range of every month and of the running sum. Each draw is whole cents. `firstShare` is the part of the first
 * month that is still ahead (the running month), 1 for a whole month. Needs at least one sample.
 */
export function simulateNet(samples: readonly number[], months: number, seed: number, runs: number = FORECAST_RUNS, firstShare = 1): SimulatedRange {
  if (!samples.length) throw new Error("simulateNet needs at least one month");
  const random = seededRandom(seed);
  const n = samples.length;
  const mean = samples.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(samples.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));
  const level = sd * FORECAST_LEVEL;
  const smooth = sd * Math.sqrt(Math.max(0, smallSampleFactor(n) ** 2 - 1 - FORECAST_LEVEL ** 2));
  const each: number[][] = Array.from({ length: months }, () => []);
  const sums: number[][] = Array.from({ length: months }, () => []);
  for (let r = 0; r < runs; r++) {
    let sum = 0;
    const shift = level * normal(random);
    for (let m = 0; m < months; m++) {
      const v = Math.round((samples[Math.floor(random() * n)]! + shift + smooth * normal(random)) * (m === 0 ? firstShare : 1));
      sum += v;
      each[m]!.push(v);
      sums[m]!.push(sum);
    }
  }
  return { month: each.map(spread), total: sums.map(spread) };
}
