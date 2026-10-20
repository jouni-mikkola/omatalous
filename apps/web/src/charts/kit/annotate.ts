import { LABEL_CHAR_W, LABEL_GAP } from "../draw.ts";

/** An event on a time axis: a pay day, a price rise, a large purchase. `x` is its pixel on the plot. */
export interface Marker {
  key: string;
  x: number;
  label: string;
}

export interface PlacedMarker extends Marker {
  /** The label's lane under the plot (0 nearest), or -1 when no lane has room: the rule stays, the label is in the readout. */
  lane: number;
  anchor: "start" | "middle" | "end";
}

/**
 * Lays event labels into lanes so no two touch: left to right, each label in the first lane where it clears the label
 * before it by `LABEL_GAP`; one at an edge hangs inward. A label no lane holds is not printed (its marker still is).
 */
export function placeMarkers(markers: readonly Marker[], width: number, lanes = 2): PlacedMarker[] {
  const ends = new Array<number>(lanes).fill(-Infinity);
  return [...markers]
    .sort((a, b) => a.x - b.x)
    .map((m) => {
      const w = m.label.length * LABEL_CHAR_W;
      const anchor = m.x - w / 2 < 0 ? "start" : m.x + w / 2 > width ? "end" : "middle";
      const left = anchor === "start" ? m.x : anchor === "end" ? m.x - w : m.x - w / 2;
      const lane = ends.findIndex((end) => left >= end + LABEL_GAP);
      if (lane >= 0) ends[lane] = left + w;
      return { ...m, lane, anchor };
    });
}

/** A horizontal reference (the usual, a target) clipped to the plot: `null` when it falls outside it. */
export function referenceY(y: number, innerH: number): number | null {
  return y >= 0 && y <= innerH ? y : null;
}

/** A band between two values (the usual range, a projection) as a rectangle inside the plot, ends in either order. */
export function bandRect(y0: number, y1: number, innerH: number): { y: number; h: number } | null {
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(innerH, Math.max(y0, y1));
  return bottom > top ? { y: top, h: bottom - top } : null;
}

/** A label at the end of a line (a slope's side, a line's last value): its datum's pixel height. */
export interface EndLabel {
  key: string;
  y: number;
}

/**
 * Moves end labels apart vertically so none is closer than `gap` px to the next, in the order of their data, inside
 * `[0, height]`, each as near its datum as the others allow (the labels of one cluster are centred on it). A side with
 * more labels than room hides the labels farthest from the middle of their cluster; the readout carries them.
 */
export function spreadLabels(labels: readonly EndLabel[], height: number, gap = 14): (EndLabel & { at: number; hidden: boolean })[] {
  const room = Math.max(1, Math.floor(height / gap) + 1);
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  // more labels than rows: keep every k-th one in order, from the top, so the kept ones still read in order
  const keep = new Set(sorted.length <= room ? sorted.map((l) => l.key) : sorted.filter((_, i) => Math.floor((i * room) / sorted.length) !== Math.floor(((i - 1) * room) / sorted.length)).map((l) => l.key));
  const shown = sorted.filter((l) => keep.has(l.key));
  // clusters: a run of labels that would touch is set as one block centred on the mean of its data, then clamped
  type Block = { items: EndLabel[]; top: number };
  const blocks: Block[] = [];
  for (const l of shown) {
    blocks.push({ items: [l], top: l.y });
    for (;;) {
      const b = blocks[blocks.length - 1]!;
      const mean = b.items.reduce((s, x) => s + x.y, 0) / b.items.length;
      b.top = Math.max(0, Math.min(height - (b.items.length - 1) * gap, mean - ((b.items.length - 1) * gap) / 2));
      const prev = blocks[blocks.length - 2];
      if (!prev || prev.top + prev.items.length * gap <= b.top) break;
      prev.items.push(...b.items);
      blocks.pop();
    }
  }
  const at = new Map<string, number>();
  for (const b of blocks) b.items.forEach((l, i) => at.set(l.key, b.top + i * gap));
  return labels.map((l) => ({ ...l, at: at.get(l.key) ?? l.y, hidden: !keep.has(l.key) }));
}
