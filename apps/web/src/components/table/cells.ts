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

/** What a rise means for the household: spending up is bad, income or savings up is good, a neutral figure has no tone. */
export type Meaning = "spend" | "gain" | "neutral";

/** The tone of a delta chip by its meaning, never the sign alone. Within `flat` of zero it is flat. */
export function deltaTone(delta: number, meaning: Meaning, flat = 0): "good" | "bad" | "flat" {
  if (Math.abs(delta) <= flat || meaning === "neutral") return "flat";
  return (delta > 0) === (meaning === "gain") ? "good" : "bad";
}
