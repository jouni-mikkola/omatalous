import { LABEL_CHAR_W, TICK_L } from "../draw.ts";

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The plot of a chart: its outer size, the margins and the inner rectangle the marks are drawn in. */
export interface Frame {
  width: number;
  height: number;
  margin: Margin;
  innerW: number;
  innerH: number;
}

export interface FrameOptions {
  /** The height on a narrow screen. */
  minHeight?: number;
  /** The height a wide chart stops growing at. */
  tallest?: number;
  /** Height as a share of the width between the two. */
  ratio?: number;
  /** Extra room under the plot (a year line, an annotation lane). */
  extraBottom?: number;
}

/**
 * A frame for a measured width (`useWidth`). The height follows the width between `minHeight` and `tallest`, as the
 * line chart's does (240 to 320 px at a fifth of the width), so a line keeps a shape a reader can follow on a phone and
 * does not become a wall on a wide screen.
 */
export function frame(width: number, margin: Margin, { minHeight = 240, tallest = 320, ratio = 0.22, extraBottom = 0 }: FrameOptions = {}): Frame {
  const height = Math.round(Math.max(minHeight, Math.min(tallest, width * ratio)));
  return {
    width,
    height,
    margin,
    innerW: Math.max(0, width - margin.left - margin.right),
    innerH: Math.max(0, height - margin.top - margin.bottom - extraBottom),
  };
}

/** The left margin a value axis needs for its longest label: the label, 4 px of air and the long tick, never under 40 px. */
export function axisRoom(labels: readonly string[]): number {
  const longest = labels.reduce((n, l) => Math.max(n, l.length), 0);
  return Math.max(40, Math.ceil(longest * LABEL_CHAR_W + 4 + TICK_L + 2));
}

/**
 * The tick target of a value axis by the plot's height: about one labelled value per 56 px, two at least and five at
 * most, so a phone chart keeps its labels without crowding them.
 */
export function tickTarget(innerH: number): number {
  return Math.max(2, Math.min(5, Math.round(innerH / 56)));
}
