import { useState } from "react";
import { money, moneyTick, monthLabel, monthLong } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { niceTicks, roundedTop } from "./scale.ts";
import { Tooltip, TooltipRow } from "./Tooltip.tsx";
import "../styles/charts.css";

export interface StackSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

const MARGIN = { top: 8, right: 4, bottom: 24, left: 56 };
const GAP = 2;

/** Monthly columns stacked by category; months outside `highlight` are dimmed. */
export function StackedColumns({
  months,
  series,
  highlight,
  height = 260,
  label,
}: {
  months: string[];
  series: StackSeries[];
  highlight?: (month: string) => boolean;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const totals = months.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const { ticks, max } = niceTicks(Math.max(...totals, 0));
  const band = months.length ? innerW / months.length : 0;
  const barW = Math.min(24, band * 0.62);
  const y = (v: number) => innerH - (v / max) * innerH;
  const labelEvery = band >= 36 ? 1 : band >= 20 ? 2 : 3;

  return (
    <div className="chart" ref={ref}>
      <div className="legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.key}>
            <i className="swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
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
              const x = band * i + (band - barW) / 2;
              const dim = (highlight && !highlight(m)) || (hover !== null && hover !== i);
              let acc = 0;
              const segments = series.map((s) => {
                const v = s.values[i] ?? 0;
                const y0 = y(acc);
                acc += v;
                return { key: s.key, color: s.color, v, y0, y1: y(acc) };
              });
              const visible = segments.filter((s) => s.v > 0 && s.y0 - s.y1 > GAP);
              return (
                <g key={m} opacity={dim ? 0.42 : 1}>
                  {visible.map((s, si) => {
                    const bottomGap = si === 0 ? 0 : GAP;
                    const h = s.y0 - s.y1 - bottomGap;
                    return si === visible.length - 1 ? (
                      <path key={s.key} d={roundedTop(x, s.y1, barW, h)} fill={s.color} />
                    ) : (
                      <rect key={s.key} x={x} y={s.y1} width={barW} height={h} fill={s.color} />
                    );
                  })}
                  {i % labelEvery === (months.length - 1) % labelEvery && (
                    <text x={band * i + band / 2} y={innerH + 16} textAnchor="middle">
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
                className="hit"
                x={band * i}
                y={0}
                width={band}
                height={innerH}
                tabIndex={0}
                aria-label={`${monthLong(m)}: ${money(totals[i] ?? 0, false)}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={MARGIN.left + band * hover + band / 2} y={MARGIN.top + 24} containerWidth={width}>
          <div className="tooltip-title">{monthLong(months[hover]!)}</div>
          <TooltipRow name="Yhteensä" value={money(totals[hover] ?? 0, false)} />
          {[...series]
            .reverse()
            .filter((s) => (s.values[hover] ?? 0) > 0)
            .map((s) => (
              <TooltipRow key={s.key} color={s.color} name={s.label} value={money(s.values[hover] ?? 0, false)} />
            ))}
        </Tooltip>
      )}
    </div>
  );
}
