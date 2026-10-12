import { useState } from "react";
import { money, moneyTick, monthLabel, monthLong } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { niceTicks, roundedTop } from "./scale.ts";
import { Tooltip, TooltipRow } from "./Tooltip.tsx";
import "../styles/charts.css";

export interface DivergingSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

const MARGIN = { top: 8, right: 4, bottom: 24, left: 60 };
const GAP = 2;

/**
 * Money in stacked above the baseline, money out stacked below it. One axis,
 * polarity carried by position. Used for the monthly cash flow.
 */
export function DivergingColumns({ months, up, down, height = 300 }: { months: string[]; up: DivergingSeries[]; down: DivergingSeries[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const totalsOf = (stack: DivergingSeries[]) => months.map((_, i) => stack.reduce((s, d) => s + Math.max(0, d.values[i] ?? 0), 0));
  const upTotals = totalsOf(up);
  const downTotals = totalsOf(down);
  const upMax = Math.max(...upTotals, 0);
  const downMax = Math.max(...downTotals, 0);
  const { ticks, max } = niceTicks(Math.max(upMax, downMax, 1), 3);
  const total = 2 * max;
  const zeroY = innerH / 2;
  const scale = (v: number) => (v / total) * innerH;
  const band = months.length ? innerW / months.length : 0;
  const barW = Math.min(24, band * 0.62);
  const labelEvery = band >= 36 ? 1 : band >= 20 ? 2 : 3;

  return (
    <div className="chart" ref={ref}>
      <div className="legend" aria-hidden="true">
        {[...up, ...down].map((s) => (
          <span key={s.key}>
            <i className="swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Tulot ja menot kuukausittain">
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {[...ticks.slice(1).map((t) => -t), ...ticks].map((t) => (
              <g key={t} transform={`translate(0,${zeroY - scale(t)})`}>
                <line className={t === 0 ? "axis-line" : "grid-line"} x1={0} x2={innerW} />
                <text x={-8} dy="0.32em" textAnchor="end">
                  {t < 0 ? `−${moneyTick(-t)}` : moneyTick(t)}
                </text>
              </g>
            ))}
            {months.map((m, i) => {
              const x = band * i + (band - barW) / 2;
              const dim = hover !== null && hover !== i;
              let acc = 0;
              let accUp = 0;
              return (
                <g key={m} opacity={dim ? 0.45 : 1}>
                  {up.map((u, ui) => {
                    const v = Math.max(0, u.values[i] ?? 0);
                    if (!v) return null;
                    const y1 = zeroY - 1 - scale(accUp) - (accUp ? GAP : 0);
                    accUp += v;
                    const h = Math.max(0, y1 - (zeroY - scale(accUp)));
                    // rounded data-end at the top of the last segment
                    return up.slice(ui + 1).some((n) => (n.values[i] ?? 0) > 0) ? <rect key={u.key} x={x} y={y1 - h} width={barW} height={h} fill={u.color} /> : <path key={u.key} d={roundedTop(x, y1 - h, barW, h)} fill={u.color} />;
                  })}
                  {down.map((d, di) => {
                    const v = Math.max(0, d.values[i] ?? 0);
                    if (!v) return null;
                    const y0 = zeroY + 1 + scale(acc) + (acc ? GAP : 0);
                    acc += v;
                    const h = Math.max(0, zeroY + scale(acc) - y0);
                    const last = !down.slice(di + 1).some((n) => (n.values[i] ?? 0) > 0);
                    // rounded data-end at the bottom of the last segment
                    return last ? (
                      <path key={d.key} d={roundedTop(x, y0, barW, h)} transform={`translate(0 ${2 * y0 + h}) scale(1 -1)`} fill={d.color} />
                    ) : (
                      <rect key={d.key} x={x} y={y0} width={barW} height={h} fill={d.color} />
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
                aria-label={`${monthLong(m)}: ${up.map((u) => `${u.label.toLowerCase()} ${money(u.values[i] ?? 0, false)}`).join(", ")}, menot ${money(downTotals[i] ?? 0, false)}`}
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
        <Tooltip x={MARGIN.left + band * hover + band / 2} y={MARGIN.top + 16} containerWidth={width}>
          <div className="tooltip-title">{monthLong(months[hover]!)}</div>
          {up.map((u) => (
            <TooltipRow key={u.key} color={u.color} name={u.label} value={money(u.values[hover] ?? 0, false)} />
          ))}
          {down.map((d) => (
            <TooltipRow key={d.key} color={d.color} name={d.label} value={money(d.values[hover] ?? 0, false)} />
          ))}
          <TooltipRow name="Erotus" value={money((upTotals[hover] ?? 0) - (downTotals[hover] ?? 0), false)} />
        </Tooltip>
      )}
    </div>
  );
}
