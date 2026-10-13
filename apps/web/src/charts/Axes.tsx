import { crisp, TICK, TICK_L } from "./draw.ts";

/**
 * The value axis: its line at the left edge, and for each labelled value a grid line (the axis line at zero),
 * an 8 px tick and the label. There is no tick between two labelled values.
 */
export function ValueAxis({ ticks, y, width, height, label }: { ticks: number[]; y: (t: number) => number; width: number; height: number; label: (t: number) => string }) {
  return (
    <>
      <line className="axis-line" x1={0.5} x2={0.5} y1={0} y2={height} />
      {ticks.map((t) => (
        <g key={t} transform={`translate(0,${crisp(y(t))})`}>
          <line className={t === 0 ? "axis-line" : "grid-line"} x1={0} x2={width} />
          <line className="tick" x1={-TICK_L} x2={0} />
          <text x={-TICK_L - 4} dy="0.32em" textAnchor="end">
            {label(t)}
          </text>
        </g>
      ))}
    </>
  );
}

/** The tick of one category (a month, a day) hanging from the axis at `base`: long where its label is printed. */
export function CategoryTick({ x, base, long }: { x: number; base: number; long: boolean }) {
  const cx = crisp(x);
  return <line className="tick" x1={cx} x2={cx} y1={base} y2={base + (long ? TICK_L : TICK)} />;
}
