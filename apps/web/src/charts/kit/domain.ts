/** A series needs at least this many values before one of them can be called an outlier. */
const MIN_VALUES = 4;

/**
 * The top of an axis that one outlier does not flatten: a year of bars at 1 000 to 2 000 € and one month at 9 000 € would
 * leave the year a row of stubs. A value more than `factor` times the third quartile is `clipped` (its index), and `max`
 * is the largest of the others. For lengths read from zero (bars, shares), so a value counts by its size. With fewer than
 * four values, or a third quartile of zero, nothing is clipped.
 */
export function robustDomain(values: readonly number[], { factor = 3 }: { factor?: number } = {}): { max: number; clipped: number[] } {
  const sizes = values.map((v) => (Number.isFinite(v) ? Math.abs(v) : 0));
  const top = Math.max(0, ...sizes);
  if (sizes.length < MIN_VALUES) return { max: top, clipped: [] };
  const sorted = [...sizes].sort((a, b) => a - b);
  const q3 = sorted[Math.floor(0.75 * (sorted.length - 1))]!;
  if (q3 <= 0) return { max: top, clipped: [] };
  const cap = factor * q3;
  return { max: Math.max(0, ...sizes.filter((s) => s <= cap)), clipped: sizes.flatMap((s, i) => (s > cap ? [i] : [])) };
}
