import type { CSSProperties } from "react";

/** A unit of an axis: 4 px; a unit whose value is printed: 8 px (the `--tick` and `--tick-l` of the scale). */
export const TICK = 4;
export const TICK_L = 8;
/** Baseline of a category label under its axis: the long tick, 4 px of air, the label's 11 px. */
export const LABEL_Y = TICK_L + 4 + 11;

/** The place a 1 px line is drawn at, so that it fills one pixel row or column instead of two half ones. */
export function crisp(v: number): number {
  return Math.round(v) + 0.5;
}

const DASHES = ["", "6 3", "2 3"];

/** The dash of the n-th series of a chart (0 is the first): solid, `6 3`, then `2 3`, so a line is not told apart by colour alone. */
export function dashOf(index: number): string | undefined {
  return DASHES[Math.min(index, DASHES.length - 1)] || undefined;
}

/** The legend key of a line: the same dashes as the line itself. */
export function keyStyle(color: string, dash?: string): CSSProperties {
  if (!dash) return { background: color };
  const [on = 0, off = 0] = dash.split(" ").map(Number);
  return { background: `repeating-linear-gradient(90deg, ${color} 0 ${on}px, transparent ${on}px ${on + off}px)` };
}

/**
 * Whether the label of one unit of a category axis is printed. The unit a last value falls on (`drops`) always
 * prints its label; a regular label within two units of one of them gives way to it (its tick stays, short).
 */
export function labelPrinted(unit: number, regular: boolean, drops: ReadonlySet<number>): boolean {
  if (drops.has(unit)) return true;
  return regular && ![...drops].some((d) => Math.abs(d - unit) <= 2);
}

/** Pixels a printed label takes per character, and the air kept between two labels. */
export const LABEL_CHAR_W = 6.5;
export const LABEL_GAP = 8;

/**
 * The units of a category axis whose label is printed, by room in pixels: the units a last value falls on (`drops`) print
 * first, then every unit from the last to the first whose label clears each printed one by `LABEL_GAP`. Two printed
 * labels never touch, and a unit with room always has its label.
 */
export function labelsWithRoom(texts: readonly string[], pitch: number, drops: ReadonlySet<number>): Set<number> {
  const half = (i: number) => (texts[i]!.length * LABEL_CHAR_W) / 2;
  const printed = new Set<number>();
  const fits = (i: number) => [...printed].every((j) => Math.abs(i - j) * pitch >= half(i) + half(j) + LABEL_GAP);
  for (const d of drops) if (d < texts.length) printed.add(d);
  for (let i = texts.length - 1; i >= 0; i--) if (!printed.has(i) && fits(i)) printed.add(i);
  return printed;
}
