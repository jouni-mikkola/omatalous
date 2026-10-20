import { crisp } from "../draw.ts";
import { bandRect, type PlacedMarker, referenceY } from "./annotate.ts";

/** The height of one lane of event labels under the plot. */
export const LANE_H = 14;

/**
 * Event markers of a time axis (`placeMarkers`): a solid rule through the plot (dashed means an estimate) and the label in its lane under the
 * axis line, below the category labels at `base`. A marker without a lane keeps its rule; its label is in the readout.
 */
export function EventMarkers({ markers, innerH, base }: { markers: readonly PlacedMarker[]; innerH: number; base: number }) {
  return (
    <g className="kit-events">
      {markers.map((m) => (
        <g key={m.key}>
          <line className="kit-event-rule" x1={crisp(m.x)} x2={crisp(m.x)} y1={0} y2={innerH} />
          {m.lane >= 0 && (
            <text className="kit-event-label" x={m.x} y={base + LANE_H * (m.lane + 1)} textAnchor={m.anchor}>
              {m.label}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

/** A reference line across the plot (the usual, a target) with its label at the right end; nothing outside the plot. */
export function ReferenceLine({ y, innerW, innerH, label }: { y: number; innerW: number; innerH: number; label?: string }) {
  const at = referenceY(y, innerH);
  if (at === null) return null;
  return (
    <g className="kit-ref">
      <line className="avg-line" x1={0} x2={innerW} y1={crisp(at)} y2={crisp(at)} />
      {label && (
        <text className="kit-ref-label" x={innerW} y={at - 4} textAnchor="end">
          {label}
        </text>
      )}
    </g>
  );
}

/** A band between two pixel heights (the usual range, a projected month end) behind the marks. */
export function ReferenceBand({ y0, y1, innerW, innerH }: { y0: number; y1: number; innerW: number; innerH: number }) {
  const r = bandRect(y0, y1, innerH);
  return r ? <rect className="kit-band" x={0} y={r.y} width={innerW} height={r.h} /> : null;
}
