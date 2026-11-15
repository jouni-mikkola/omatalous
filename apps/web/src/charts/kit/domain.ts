/** A series needs at least this many values before one of them can be called an outlier. */
const MIN_VALUES = 4;

/**
 * The ends of an axis that one outlier does not flatten: a year of bars at 1 000 to 2 000 € and one month at 9 000 € would
 * leave the year a row of stubs. A value whose size is more than `factor` times the third quartile of the sizes is
 * `clipped` (its index), and `min` and `max` are the smallest and largest signed values of the others, so a clipped
 * negative outlier does not stretch the bottom and a clipped positive one does not stretch the top. Zero is not forced
 * into the ends here; the caller does that when its marks are read from zero. With fewer than four values, or a third
 * quartile of zero, nothing is clipped.
 */
export function robustDomain(
  values: readonly number[],
  { factor = 3 }: { factor?: number } = {},
): { min: number; max: number; clipped: number[] } {
  const sizes = values.map((v) => (Number.isFinite(v) ? Math.abs(v) : 0));
  let cap = Infinity;
  if (sizes.length >= MIN_VALUES) {
    const sorted = [...sizes].sort((a, b) => a - b);
    const q3 = sorted[Math.floor(0.75 * (sorted.length - 1))]!;
    if (q3 > 0) cap = factor * q3;
  }
  const kept = values.filter((v, i) => Number.isFinite(v) && sizes[i]! <= cap);
  return {
    min: kept.length ? Math.min(...kept) : 0,
    max: kept.length ? Math.max(...kept) : 0,
    clipped: sizes.flatMap((s, i) => (s > cap ? [i] : [])),
  };
}
