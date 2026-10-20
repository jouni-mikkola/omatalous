/**
 * The indices of a long series worth drawing at `pixels` columns: per column its first, lowest, highest and last
 * value, in order, and the first gap. The drawn line keeps every peak and trough a pixel can show, and a series of any
 * length becomes at most four points a column, which keeps a 2 000 point chart inside a frame's 16 ms.
 */
export function decimate(values: readonly (number | null)[], pixels: number): number[] {
  const n = values.length;
  const cols = Math.max(1, Math.floor(pixels));
  if (n <= cols * 4) return [...values.keys()];
  const out: number[] = [];
  for (let c = 0; c < cols; c++) {
    const a = Math.floor((c * n) / cols);
    const b = Math.floor(((c + 1) * n) / cols);
    let lo = -1;
    let hi = -1;
    let gap = -1;
    let first = -1;
    let last = -1;
    for (let i = a; i < b; i++) {
      const v = values[i];
      if (v === null || v === undefined) {
        if (gap < 0) gap = i;
        continue;
      }
      if (first < 0) first = i;
      last = i;
      if (lo < 0 || v < values[lo]!) lo = i;
      if (hi < 0 || v > values[hi]!) hi = i;
    }
    const picked = new Set([first, lo, hi, last, gap].filter((i) => i >= 0));
    out.push(...[...picked].sort((p, q) => p - q));
  }
  return out;
}
