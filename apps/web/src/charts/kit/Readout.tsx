import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useSelect } from "../../components/table/selection.tsx";
import { crisp } from "../draw.ts";
import { t } from "../../text.ts";
import { nearestIndex, stepIndex } from "./readout.ts";
import "../../styles/charts.css";

/** The datum a chart reads out, and the setter its layer and its own parts (a legend, a table row) share. */
export function useReadout(): [number | null, (i: number | null) => void] {
  const [at, setAt] = useState<number | null>(null);
  return [at, setAt];
}

/**
 * The interaction layer of a chart over its plot: one transparent rect that takes the pointer (mouse, pen, a finger's
 * tap and drag), focus and the keys of `stepIndex`, with a 1 px crosshair at the datum. `xs` are the data's pixels in
 * the plot, ascending. The chart draws its own highlight and box from `at`; the sentence of the datum goes to `live`
 * (`LiveReadout`), so a screen reader hears what a sighted reader sees.
 *
 * With `keys` (one per datum, the `rowKey` of its row in the table under the chart) a click, a tap or Enter picks the
 * datum: the key goes to `onSelect`, by default the pick of the chart's `ChartWithTable`, and the table keeps that row.
 * The picked datum keeps a rule of its own after the pointer leaves. Escape lets go of the readout, and again of the pick.
 */
export function ReadoutLayer({
  xs,
  innerW,
  innerH,
  at,
  onAt,
  label,
  crosshair = true,
  focusAt,
  keys,
  onSelect,
}: {
  xs: readonly number[];
  innerW: number;
  innerH: number;
  at: number | null;
  onAt: (i: number | null) => void;
  label: string;
  /** Crosshair drawn by the layer; a chart that draws dots on the crosshair draws it itself, under them. */
  crosshair?: boolean;
  /** The datum focus starts on (the last value of a running month); by default the last one. */
  focusAt?: number;
  /** The key of each datum, in the order of `xs`. */
  keys?: readonly string[];
  /** Where a pick goes; by default the pick of the surrounding `ChartWithTable`. */
  onSelect?: (key: string) => void;
}) {
  const scope = useSelect();
  const send = keys && (onSelect ?? (scope ? (key: string) => scope.select(key) : undefined));
  const picked = keys && scope?.selected ? { first: keys.indexOf(scope.selected), last: keys.lastIndexOf(scope.selected) } : null;
  // the rect overhangs the plot by 6 px each side, so a point at an edge is easy to reach
  const pointerPx = (e: MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - box.left) / Math.max(box.width, 1)) * (innerW + 12) - 6;
  };
  const fromPointer = (e: PointerEvent<SVGRectElement>) => onAt(nearestIndex(xs, pointerPx(e)));
  const pick = (i: number | null) => {
    const key = i === null ? undefined : keys?.[i];
    if (key !== undefined) send?.(key);
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    if (send && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      pick(at);
      return;
    }
    if (e.key === "Escape" && at === null && scope?.selected) {
      e.preventDefault();
      scope.select(null);
      return;
    }
    const next = stepIndex(e.key, at, xs.length);
    if (next === undefined) return;
    e.preventDefault();
    onAt(next);
  };
  const cx = at !== null && xs[at] !== undefined ? crisp(xs[at]!) : null;
  // one datum is a rule; a key that several data share (the days of a month, the months of a tile) is a band over them
  const from = picked && picked.first >= 0 ? xs[picked.first] : undefined;
  const to = picked && picked.last >= 0 ? xs[picked.last] : undefined;
  return (
    <>
      {from !== undefined && to !== undefined && (to > from ? <rect className="sel-band" x={from} y={0} width={to - from} height={innerH} pointerEvents="none" /> : <line className="sel-line" x1={crisp(from)} x2={crisp(from)} y1={0} y2={innerH} pointerEvents="none" />)}
      {crosshair && cx !== null && <line className="axis-line" x1={cx} x2={cx} y1={0} y2={innerH} pointerEvents="none" />}
      <rect
        className={send ? "hit hit-pick" : "hit"}
        x={-6}
        y={0}
        width={innerW + 12}
        height={innerH}
        tabIndex={0}
        role="group"
        aria-label={send ? t("chart.pick_hint", { label }) : label}
        onClick={send ? (e) => pick(nearestIndex(xs, pointerPx(e))) : undefined}
        onPointerDown={fromPointer}
        onPointerMove={fromPointer}
        onPointerLeave={(e) => e.pointerType === "mouse" && onAt(null)}
        onFocus={() => onAt(at ?? focusAt ?? xs.length - 1)}
        onBlur={() => onAt(null)}
        onKeyDown={onKey}
      />
    </>
  );
}

/** The sentence of the current readout for screen readers, polite so it never cuts a sentence the reader is in. */
export function LiveReadout({ text }: { text: string }) {
  return (
    <div className="sr-only" aria-live="polite">
      {text}
    </div>
  );
}
