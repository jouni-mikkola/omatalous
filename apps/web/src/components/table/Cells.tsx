import type { ReactNode } from "react";
import { barShare, deltaTone, type Meaning, sparkGeometry } from "./cells.ts";
import type { SortDir } from "./sort.ts";
import { MerchantAvatar } from "../MerchantAvatar.tsx";
import "../../styles/rich-table.css";

/** An inline bar anchored at the left of its cell; the figure itself stands in its own cell, the bar is hidden from readers. */
export function BarCell({ value, max, color }: { value: number; max: number; color?: string }) {
  return (
    <span className="rt-bar-track" aria-hidden="true">
      <span style={{ width: `${(barShare(value, max) * 100).toFixed(1)}%`, ...(color ? { background: color } : {}) }} />
    </span>
  );
}

/** A sparkline with no axis: a 2 px line, a dot at the last value and the usual level dashed. `label` is its sentence; `scale` the table's shared one. */
export function SparkCell({ values, usual, label, scale, width = 72, height = 22 }: { values: readonly (number | null)[]; usual?: number | null; label: string; scale?: { lo: number; hi: number }; width?: number; height?: number }) {
  const g = sparkGeometry(values, width, height, usual, scale);
  return (
    <svg className="rt-spark" width={width} height={height} role="img" aria-label={label}>
      {g.usualY !== null && <line className="rt-spark-usual" x1={0} x2={width} y1={g.usualY} y2={g.usualY} />}
      <path d={g.d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {g.dot && <circle cx={g.dot.x} cy={g.dot.y} r={2.5} />}
    </svg>
  );
}

/**
 * A delta chip: an arrow, the figure as the server or `format` wrote it, and a tone that follows its meaning (spending
 * up is bad). The arrow carries the direction, so the colour is never alone.
 */
export function DeltaChip({ delta, text, meaning, flat = 0 }: { delta: number; text: string; meaning: Meaning; flat?: number }) {
  const tone = deltaTone(delta, meaning, flat);
  const arrow = Math.abs(delta) <= flat ? "→" : delta > 0 ? "↑" : "↓";
  return (
    <span className={`tc-delta rt-delta-${tone}`}>
      <span className="rt-delta-arrow" aria-hidden="true">{arrow}</span>
      {text}
    </span>
  );
}

/**
 * A payee's mark: the given logo (the bank's, a chain's), else MerchantAvatar (a person glyph for a person's name,
 * or two initials on a tint of their own); the name beside it.
 */
export function MarkCell({ name, mark, person, size, children }: { name: string; mark?: ReactNode; person?: boolean; size?: "s" | "m" | "l"; children?: ReactNode }) {
  return (
    <span className="tc-mark">
      {mark ?? <MerchantAvatar name={name} person={person} size={size} />}
      <span className="tc-name">{children ?? name}</span>
    </span>
  );
}

/**
 * A column head that sorts: a button inside the `th`, which carries `aria-sort` while its column orders the rows. The
 * mark is drawn by the stylesheet (↕ until pressed, so it is no text of the head) so a reader sees that the column sorts.
 */
export function SortHead({ label, dir, numeric, className, onSort }: { label: ReactNode; dir: SortDir | null; numeric?: boolean; className?: string; onSort: () => void }) {
  return (
    <th className={className ?? (numeric ? "num" : undefined)} aria-sort={dir ?? "none"} scope="col">
      <button type="button" className="rt-sort" onClick={onSort}>
        {label}
      </button>
    </th>
  );
}
