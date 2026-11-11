/**
 * The one way every chart is read: the pointer or the arrow keys move from mark to mark, the readout says the value and
 * what it is set against (a sentence a screen reader hears at once, `aria-live="polite"`), a click or Enter sends the
 * mark's key to the table under the chart, and Escape lets go. This file is the pure part, `Readout.tsx` draws it.
 */

/** Under this screen width a chart with a mark per month is drawn as a dot plot: one dot a month, no bars or steps. */
export const DOT_PLOT_BELOW = 600;

/** The index of the position nearest to `px` in `xs` (ascending pixels). Binary search: 2 000 points take 11 steps. */
export function nearestIndex(xs: readonly number[], px: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= px) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[hi]! - px) < Math.abs(xs[lo]! - px) ? hi : lo;
}

/**
 * The index a key moves the readout to among `n` data, or `undefined` when the key is not the chart's. Arrows step one,
 * Page keys step `page`, Home and End go to the ends; from no readout an arrow starts at the nearer end.
 */
export function stepIndex(key: string, at: number | null, n: number, page = 6): number | null | undefined {
  if (n <= 0) return undefined;
  const clamp = (i: number) => Math.max(0, Math.min(n - 1, i));
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return at === null ? 0 : clamp(at + 1);
    case "ArrowLeft":
    case "ArrowDown":
      return at === null ? n - 1 : clamp(at - 1);
    case "PageUp":
      return clamp((at ?? 0) + page);
    case "PageDown":
      return clamp((at ?? n - 1) - page);
    case "Home":
      return 0;
    case "End":
      return n - 1;
    case "Escape":
      return null;
    default:
      return undefined;
  }
}

/** Where the readout box stands: right of the datum, or left of it when it would run over the right edge, never off the left. */
export function boxPlace(x: number, containerWidth: number, boxWidth = 190, gap = 12): { left: number } | { right: number } {
  if (x + gap + boxWidth <= containerWidth || x - gap - boxWidth < 0) return { left: Math.max(0, Math.min(x + gap, containerWidth - boxWidth)) };
  return { right: containerWidth - x + gap };
}

/**
 * The sentence of one readout for `aria-live`: "loka 2026: Menot 1 234,00 €, Tulot 2 000,00 €". A row with no value
 * (a note on the month) is its name alone.
 */
export function readoutText(title: string, rows: readonly { name: string; value: string }[]): string {
  return rows.length ? `${title}: ${rows.map((r) => (r.value ? `${r.name} ${r.value}` : r.name)).join(", ")}` : title;
}

/** A cell of a grid chart (a calendar's week and weekday). */
export interface Cell {
  col: number;
  row: number;
}

/**
 * The cell a key moves a grid readout to among `cols` × `rows` cells, or `undefined` when the key is not the chart's:
 * arrows step one cell, Page keys a column of `page` (a calendar's month, about four weeks), Home and End the first
 * and the last cell. From no readout any arrow starts at the last cell (today's week).
 */
export function gridStep(key: string, at: Cell | null, cols: number, rows: number, page = 4): Cell | null | undefined {
  if (cols <= 0 || rows <= 0) return undefined;
  const last = { col: cols - 1, row: rows - 1 };
  const clamp = (c: Cell) => ({ col: Math.max(0, Math.min(cols - 1, c.col)), row: Math.max(0, Math.min(rows - 1, c.row)) });
  if (key === "Escape") return null;
  if (key === "Home") return { col: 0, row: 0 };
  if (key === "End") return last;
  const moves: Record<string, Cell> = { ArrowRight: { col: 1, row: 0 }, ArrowLeft: { col: -1, row: 0 }, ArrowDown: { col: 0, row: 1 }, ArrowUp: { col: 0, row: -1 }, PageDown: { col: page, row: 0 }, PageUp: { col: -page, row: 0 } };
  const m = moves[key];
  if (!m) return undefined;
  if (!at) return last;
  return clamp({ col: at.col + m.col, row: at.row + m.row });
}

/** A stop of a calendar's readout: a day, the sum under a column of weeks, or the mean beside a row of weekdays. */
export type CalendarStop = { kind: "day"; cell: Cell } | { kind: "week" | "mean"; i: number };

/**
 * `gridStep` for a calendar with sums on its edges: of `weeks` sums under the columns and `means` beside the rows (0 for
 * a reading the calendar does not draw). From the last row the down arrow goes to the sum of that column, from the last
 * column the right arrow to the mean of that row. Left and right walk the sums and up goes back to the last row; up and
 * down walk the means and left goes back to the last column. Home and End are the ends of the reading the readout is on.
 */
export function calendarStep(key: string, at: CalendarStop | null, cols: number, rows: number, sums: { weeks: number; means: number }, page = 4): CalendarStop | null | undefined {
  if (cols <= 0 || rows <= 0) return undefined;
  if (!at || at.kind === "day") {
    const cell = at?.cell ?? null;
    if (cell && key === "ArrowDown" && cell.row === rows - 1 && cell.col < sums.weeks) return { kind: "week", i: cell.col };
    if (cell && key === "ArrowRight" && cell.col === cols - 1 && cell.row < sums.means) return { kind: "mean", i: cell.row };
    const next = gridStep(key, cell, cols, rows, page);
    return next && { kind: "day", cell: next };
  }
  if (key === "Escape") return null;
  const week = at.kind === "week";
  const n = week ? sums.weeks : sums.means;
  const to = (i: number): CalendarStop => ({ kind: at.kind, i: Math.max(0, Math.min(n - 1, i)) });
  // along the reading: left and right for the sums under the columns, up and down for the means beside the rows
  const along: Record<string, number> = week ? { ArrowLeft: -1, ArrowRight: 1, PageUp: -page, PageDown: page } : { ArrowUp: -1, ArrowDown: 1 };
  if (Object.hasOwn(along, key)) return to(at.i + along[key]!);
  if (key === "Home") return to(0);
  if (key === "End") return to(n - 1);
  if (key === (week ? "ArrowUp" : "ArrowLeft")) return { kind: "day", cell: week ? { col: Math.min(at.i, cols - 1), row: rows - 1 } : { col: cols - 1, row: Math.min(at.i, rows - 1) } };
  // the arrow that points off the calendar and the Page keys beside the rows are the chart's, and stay where they are
  return key === "ArrowDown" || key === "ArrowRight" || key === "PageUp" || key === "PageDown" ? at : undefined;
}
