import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { crisp } from "../draw.ts";
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
}) {
  const fromPointer = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    // the rect overhangs the plot by 6 px each side, so a point at an edge is easy to reach
    const px = ((e.clientX - box.left) / Math.max(box.width, 1)) * (innerW + 12) - 6;
    onAt(nearestIndex(xs, px));
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    const next = stepIndex(e.key, at, xs.length);
    if (next === undefined) return;
    e.preventDefault();
    onAt(next);
  };
  const cx = at !== null && xs[at] !== undefined ? crisp(xs[at]!) : null;
  return (
    <>
      {crosshair && cx !== null && <line className="axis-line" x1={cx} x2={cx} y1={0} y2={innerH} pointerEvents="none" />}
      <rect
        className="hit"
        x={-6}
        y={0}
        width={innerW + 12}
        height={innerH}
        tabIndex={0}
        role="group"
        aria-label={label}
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
