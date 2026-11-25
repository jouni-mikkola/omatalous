/**
 * The pure part of the table's cells: the length of an inline bar, a sparkline's geometry and the tone of a delta. The web adds up nothing here: a subtotal, a delta and the
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

/**
 * The axis of a column of spans: its lowest and highest end, with a third of their reach left below, so the bar of the
 * smallest figure still has a length and the steps stand out from the whole. Only geometry: the ends are the server's.
 */
export function spanAxis(ends: readonly number[]): { lo: number; hi: number } {
  if (!ends.length) return { lo: 0, hi: 1 };
  const hi = Math.max(...ends);
  const low = Math.min(...ends);
  const lo = Math.max(0, low - (hi - low) / 3);
  return { lo, hi: hi > lo ? hi : lo + 1 };
}

/**
 * Where a bar that starts at an offset lies in its cell, as shares of the axis (0 to 1): from `from` to `to`, whichever is
 * lower first. A bar with no `from` starts at the axis. A span too short to see keeps `MIN_SPAN` so a small step is drawn.
 */
export function spanGeometry(from: number | null, to: number, axis: { lo: number; hi: number }): { left: number; width: number } {
  const reach = axis.hi - axis.lo;
  if (!(reach > 0)) return { left: 0, width: 0 };
  const start = Math.min(from ?? axis.lo, to);
  const end = Math.max(from ?? axis.lo, to);
  const left = Math.min(1 - MIN_SPAN, Math.max(0, (start - axis.lo) / reach));
  return { left, width: Math.min(1 - left, Math.max(MIN_SPAN, (end - start) / reach)) };
}

const MIN_SPAN = 0.006;

/** What a rise means for the household: spending up is bad, income or savings up is good, a neutral figure has no tone. */
export type Meaning = "spend" | "gain" | "neutral";

/** The tone of a delta chip by its meaning, never the sign alone. Within `flat` of zero it is flat. */
export function deltaTone(delta: number, meaning: Meaning, flat = 0): "good" | "bad" | "flat" {
  if (Math.abs(delta) <= flat || meaning === "neutral") return "flat";
  return (delta > 0) === (meaning === "gain") ? "good" : "bad";
}
