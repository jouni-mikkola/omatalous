/** `n / d` rounded down, for integers: no float quotient decides it. */
const quotient = (n: number, d: number): number => (n - (n % d)) / d;

/**
 * Shares of one whole that are printed side by side, as whole units of the last printed digit (`decimals` digits after
 * the comma): each is its true value rounded down or up, and the ones with the largest lost fractions go up until the
 * units add up to `target`. The target is the whole's own printed share, by default the nearest unit to the parts' true
 * sum (100 when they are the whole). A tie goes to the earlier row, so the same data prints the same way. A part of
 * exactly 0 stays 0; a part that is null or below zero comes back null and stands outside the rounding. The sums are
 * integers (cents against cents), so no float decides a digit.
 */
export function roundedShares(parts: readonly (number | null)[], whole: number, decimals = 0, target?: number): (number | null)[] {
  const scale = 100 * 10 ** decimals;
  const valid = parts.map((p) => (p != null && p >= 0 ? p : null));
  if (!(whole > 0)) return valid.map((p) => (p === null ? null : 0));
  const down = valid.map((p) => (p === null ? null : { units: quotient(p * scale, whole), lost: (p * scale) % whole }));
  const sum = valid.reduce<number>((s, p) => s + (p ?? 0), 0);
  const nearest = quotient(2 * sum * scale + whole, 2 * whole);
  const floors = down.reduce((s, d) => s + (d?.units ?? 0), 0);
  const order = down
    .flatMap((d, i) => (d && d.lost > 0 ? [{ i, lost: d.lost }] : []))
    .sort((a, b) => b.lost - a.lost || a.i - b.i);
  const up = new Set(order.slice(0, Math.max(0, (target ?? nearest) - floors)).map((o) => o.i));
  return down.map((d, i) => (d ? d.units + (up.has(i) ? 1 : 0) : null));
}
