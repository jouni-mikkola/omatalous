/**
 * The arithmetic behind the marks that assert something about money: a bracket (the rows add up to the sum), a share
 * track (a row's place in its block) and a bar ruler (euros along the bars). Money is integer cents; a mark is drawn
 * only when the numbers it claims hold, and every helper answers "no mark" (false, null) when they do not.
 */
import { valueAxis } from "./charts/scale.ts";
import { money } from "./format.ts";

type Cents = number | null | undefined;

function known(parts: readonly Cents[]): number[] {
  return parts.filter((p): p is number => p != null);
}

/** True only with two or more known parts that add up to `total` to the cent. A refund (negative part) adds like any other. */
export function addsUp(parts: readonly Cents[], total: number): boolean {
  const ps = known(parts);
  if (ps.length < 2 || !Number.isSafeInteger(total) || !ps.every(Number.isSafeInteger)) return false;
  return ps.reduce((a, b) => a + b, 0) === total;
}

/** A whole euro as the page prints it (`money(c, false)`): the nearest, halves away from zero. */
export const printedEuroCents = (cents: number): number => Math.sign(cents) * Math.round(Math.abs(cents) / 100) * 100;

/**
 * `addsUp` for a column printed in whole euros: the bracket asserts that the figures a reader adds give the total
 * printed under them, so it is the euros as printed that are compared. Rows that add up to the cent can miss by a euro
 * (three of 0,40 € print 0 € under 1 €), and rows that miss to the cent can add up as printed.
 */
export function addsUpPrinted(parts: readonly Cents[], total: number): boolean {
  return addsUp(parts.map((p) => (p == null ? p : printedEuroCents(p))), printedEuroCents(total));
}

/**
 * Whole percents by the largest remainder, so they add up to exactly 100, one per part (null for a part that is not
 * known). Null, no track on any row, unless every known part is zero or more, `total > 0` and the parts add up to
 * `total` to the cent. A part under half a percent is 0: the track resolves 1 %.
 */
export function shares(parts: readonly Cents[], total: number): (number | null)[] | null {
  const ps = known(parts);
  if (!(total > 0) || ps.some((p) => p < 0) || !addsUp(ps, total)) return null;
  const floors = parts.map((p) => (p == null ? null : Math.floor((p * 100) / total)));
  // a part under half a percent keeps 0 and takes no part of the remainder
  const eligible = parts
    .map((p, i) => ({ i, rem: p == null || p * 200 < total ? -1 : (p * 100) % total }))
    .filter((e) => e.rem >= 0)
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  if (eligible.length === 0) return null;
  const out = floors.map((f, i) => (f != null && parts[i]! * 200 < total ? 0 : f));
  let left = 100 - out.reduce<number>((a, b) => a + (b ?? 0), 0);
  for (let k = 0; left > 0; k++, left--) out[eligible[k % eligible.length]!.i]! += 1;
  return out;
}

/**
 * The ruler of a column of bars: the ticks of the value axis that are not above the longest row, as a percent of it
 * (two decimals). The label is `0` on the first, the sum on the last, null between. Null (no ruler) when there is no
 * longest row or under two ticks are left.
 */
export function barScale(maxCents: number): { at: number; label: string | null }[] | null {
  if (!(maxCents > 0)) return null;
  const values = valueAxis([0, maxCents]).ticks.filter((v) => v <= maxCents);
  if (values.length < 2) return null;
  return values.map((v, i) => ({
    at: Math.round((v / maxCents) * 10000) / 100,
    label: i === 0 ? "0" : i === values.length - 1 ? money(v, false) : null,
  }));
}
