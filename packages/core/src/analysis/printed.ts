/**
 * Parts printed in whole euros beside the total they make up: the one rounding of every place that prints parts and their
 * sum (a group and its categories, the earned and other income, a rise and its price split), so the euros a reader adds
 * give the euros printed under them.
 */

/** A whole euro as `formatEur(c, false)` prints it: the nearest, halves away from zero, in cents. */
export const printedEuros = (cents: number): number => Math.sign(cents) * Math.round(Math.abs(cents) / 100) * 100 || 0;

/**
 * Each part as the cents of the whole euros it prints, rounded together so they add up to the printed total: every part
 * is first rounded down, and the ones with the most cents left over go up a euro until the printed parts reach the total's
 * printed euros. A tie goes to the earlier part, so the same figures print the same way. A null part stays null and
 * outside. `target` is what the total itself prints when it is a part of a larger total and was rounded with that one
 * (a group under Yhteensä), within a euro of `total`; by default its own nearest euro. Parts that do not add up to
 * `total` to the cent are each printed on their own: forcing them would misstate one of them. Integer cents
 * throughout, so no float decides a euro.
 */
export function printedParts(parts: readonly (number | null)[], total: number, target = printedEuros(total)): (number | null)[] {
  const known = parts.filter((p): p is number => p !== null);
  if (known.reduce((s, p) => s + p, 0) !== total || Math.abs(target - total) >= 100) return parts.map((p) => (p === null ? null : printedEuros(p)));
  const down = parts.map((p) => (p === null ? null : Math.floor(p / 100) * 100));
  const floors = down.reduce<number>((s, d) => s + (d ?? 0), 0);
  const order = parts
    .flatMap((p, i) => (p !== null && p - down[i]! > 0 ? [{ i, left: p - down[i]! }] : []))
    .sort((a, b) => b.left - a.left || a.i - b.i);
  const up = new Set(order.slice(0, Math.max(0, (target - floors) / 100)).map((o) => o.i));
  return down.map((d, i) => (d === null ? null : d + (up.has(i) ? 100 : 0)));
}
