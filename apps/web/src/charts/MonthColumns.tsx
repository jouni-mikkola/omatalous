import { money, moneyTick, monthLabel, monthLong } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { niceTicks, roundedTop } from "./scale.ts";

const MARGIN = { top: 18, right: 4, bottom: 24, left: 56 };

/**
 * One column per month in a single colour, so heights compare directly.
 * Months outside the selected period are lighter, partial months (the
 * running one, the first one of the history) are hatched and the dashed
 * line is the average of complete months.
 * Hovering or focusing a column makes it active; a click pins it.
 */
export function MonthColumns({
  months,
  values,
  average,
  inPeriod,
  complete,
  active,
  pinned,
  onHover,
  onPick,
  height = 230,
}: {
  months: string[];
  values: number[];
  average: number | null;
  inPeriod: (month: string) => boolean;
  complete: boolean[];
  active: number;
  /** The clicked month, or -1. */
  pinned: number;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const { ticks, max } = niceTicks(Math.max(...values, average ?? 0, 0));
  const band = months.length ? innerW / months.length : 0;
  const barW = Math.min(36, band * 0.66);
  const y = (v: number) => innerH - (Math.max(0, v) / max) * innerH;
  const labelEvery = band >= 36 ? 1 : band >= 20 ? 2 : 3;
  // value labels on every column when they fit, otherwise on the active one only
  const allValues = band >= 52;

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Menot kuukausittain">
          <defs>
            <pattern id="month-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" className="bar-running-bg" />
              <line x1="0" y1="0" x2="0" y2="5" className="bar-running-line" strokeWidth="2.5" />
            </pattern>
          </defs>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line className={t === 0 ? "axis-line" : "grid-line"} x1={0} x2={innerW} />
                <text x={-8} dy="0.32em" textAnchor="end">
                  {moneyTick(t)}
                </text>
              </g>
            ))}
            {months.map((m, i) => {
              const v = values[i] ?? 0;
              const h = innerH - y(v);
              const cls = ["bar", inPeriod(m) ? "" : "bar-out", complete[i] ? "" : "bar-partial", i === active ? "bar-active" : ""].filter(Boolean).join(" ");
              return h > 0 ? <path key={m} className={cls} d={roundedTop(band * i + (band - barW) / 2, y(v), barW, h)} /> : null;
            })}
            {average !== null && average > 0 && <line className="avg-line" x1={0} x2={innerW} y1={y(average)} y2={y(average)} />}
            {months.map((m, i) => {
              const v = values[i] ?? 0;
              const isActive = i === active;
              // the outermost labels hang inward so they stay inside the card
              const anchor = isActive && !allValues ? (i === 0 ? "start" : i === months.length - 1 ? "end" : "middle") : "middle";
              const lx = anchor === "start" ? band * i : anchor === "end" ? band * (i + 1) : band * i + band / 2;
              return (
                <g key={m}>
                  {(allValues || isActive) && v > 0 && (
                    <text className={`bar-value ${isActive ? "active" : ""}`} x={lx} y={y(v) - 5} textAnchor={anchor}>
                      {allValues ? moneyTick(v).replace(" €", "") : moneyTick(v)}
                    </text>
                  )}
                  {i % labelEvery === (months.length - 1) % labelEvery && (
                    <text className={isActive ? "month-active" : undefined} x={band * i + band / 2} y={innerH + 16} textAnchor="middle">
                      {/* "tammi 2026" is wider than a narrow column band: the year only when every month has room */}
                      {monthLabel(m, labelEvery === 1 && m.endsWith("-01"))}
                    </text>
                  )}
                </g>
              );
            })}
            {months.map((m, i) => (
              <rect
                key={m}
                className="hit hit-pick"
                x={band * i}
                y={0}
                width={band}
                height={innerH}
                tabIndex={0}
                role="button"
                aria-pressed={i === pinned}
                aria-label={`${monthLong(m)}: ${money(values[i] ?? 0, false)}${complete[i] ? "" : ", vajaa kuukausi"}`}
                onPointerEnter={() => onHover(i)}
                onPointerLeave={() => onHover(null)}
                onFocus={() => onHover(i)}
                onBlur={() => onHover(null)}
                onClick={() => onPick(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPick(i);
                  }
                }}
              />
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}
