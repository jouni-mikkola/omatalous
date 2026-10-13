import { monthLabel } from "../format.ts";
import { crisp, LABEL_Y, TICK, TICK_L } from "./draw.ts";

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

/** Height of the second line that carries a year under its month. */
export const YEAR_LINE = 12;

/** Whether a row of month labels prints the year of a January: only when every month has a label (`every` is 1). */
export function hasYearLine(months: string[], every: number): boolean {
  return every === 1 && months.some((m) => m.endsWith("-01"));
}

/** The label of one month under the axis at `base`; the year of a January stands as a second line, never beside the month. */
export function MonthLabel({ month, x, base, withYear, className }: { month: string; x: number; base: number; withYear: boolean; className?: string }) {
  const year = withYear && month.endsWith("-01") ? month.slice(0, 4) : null;
  return (
    <text className={className} x={x} y={base + LABEL_Y} textAnchor="middle">
      <tspan x={x}>{monthLabel(month)}</tspan>
      {year && (
        <tspan x={x} dy={YEAR_LINE}>
          {year}
        </tspan>
      )}
    </text>
  );
}
