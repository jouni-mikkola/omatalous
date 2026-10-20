/**
 * The pure part of the rich table's cells: the length of an inline bar, a sparkline's geometry, the tone of a delta,
 * a payee's initials and the window of rows drawn. The web adds up nothing here: a subtotal, a delta and the
 * usual level come from the server; what is computed is geometry and order.
 */

/** The share of its cell an inline bar fills: `|value| / max`, 0 to 1. `max` is the column's scale, stated in its head. */
export function barShare(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.abs(value) / max);
}

/**
 * A sparkline in a `w` × `h` box: the path, the end dot at the last value and the usual level's height when given.
 * `scale` is the table's shared one (its lowest and highest value), so a line's height reads the same in every row.
 */
export function sparkGeometry(values: readonly (number | null)[], w: number, h: number, usual?: number | null, scale?: { lo: number; hi: number }): { d: string; dot: { x: number; y: number } | null; usualY: number | null } {
  const seen = values.filter((v): v is number => v !== null);
  if (usual !== null && usual !== undefined) seen.push(usual);
  if (!seen.length) return { d: "", dot: null, usualY: null };
  const lo = scale ? Math.min(scale.lo, ...seen) : Math.min(...seen);
  const hi = scale ? Math.max(scale.hi, ...seen) : Math.max(...seen);
  // 2 px of air top and bottom so the 2 px line and the dot are not cut
  const y = (v: number) => (hi === lo ? h / 2 : 2 + (1 - (v - lo) / (hi - lo)) * (h - 4));
  const x = (i: number) => (values.length > 1 ? 2 + (i / (values.length - 1)) * (w - 4) : w / 2);
  let d = "";
  let pen = false;
  let dot: { x: number; y: number } | null = null;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
    dot = { x: x(i), y: y(v) };
  });
  return { d, dot, usualY: usual === null || usual === undefined ? null : y(usual) };
}

/** What a rise means for the household: spending up is bad, income or savings up is good, a neutral figure has no tone. */
export type Meaning = "spend" | "gain" | "neutral";

/** The tone of a delta chip by its meaning, never the sign alone. Within `flat` of zero it is flat. */
export function deltaTone(delta: number, meaning: Meaning, flat = 0): "good" | "bad" | "flat" {
  if (Math.abs(delta) <= flat || meaning === "neutral") return "flat";
  return (delta > 0) === (meaning === "gain") ? "good" : "bad";
}

export { type SortDir, sortRows } from "./sort.ts";

/** From this many rows on a table draws only the rows in sight (and `overscan` either side). */
export const VIRTUAL_FROM = 500;

/**
 * The rows a scrolled table draws: `[start, end)` and the empty height above and below them, so the scroll bar keeps
 * the whole table's length. Under `VIRTUAL_FROM` rows every row is drawn.
 */
export function rowWindow(count: number, rowH: number, scrollTop: number, viewH: number, overscan = 8): { start: number; end: number; padTop: number; padBottom: number } {
  if (count < VIRTUAL_FROM || rowH <= 0) return { start: 0, end: count, padTop: 0, padBottom: 0 };
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewH) / rowH) + overscan);
  return { start, end, padTop: start * rowH, padBottom: (count - end) * rowH };
}

/** Rows in groups by a key, in the order the groups first appear; the group's subtotal is the server's, not summed here. */
export function groupRows<T>(rows: readonly T[], keyOf: (row: T) => string): { key: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return [...groups].map(([key, rs]) => ({ key, rows: rs }));
}
