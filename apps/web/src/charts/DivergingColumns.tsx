import { useState } from "react";
import { money, moneyTick, monthLong } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { CategoryTick, hasYearLine, MonthLabel, ValueAxis, YEAR_LINE } from "./Axes.tsx";
import { crisp } from "./draw.ts";
import { barTicks, roundedTop } from "./scale.ts";
import { Tooltip, TooltipRow } from "./Tooltip.tsx";
import "../styles/charts.css";

interface DivergingSeries {
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
  const band = months.length ? innerW / months.length : 0;
  const labelEvery = band >= 36 ? 1 : band >= 20 ? 2 : 3;
  const innerH = height - MARGIN.top - MARGIN.bottom - (hasYearLine(months, labelEvery) ? YEAR_LINE : 0);
  const totalsOf = (stack: DivergingSeries[]) => months.map((_, i) => stack.reduce((s, d) => s + Math.max(0, d.values[i] ?? 0), 0));
  const upTotals = totalsOf(up);
  const downTotals = totalsOf(down);
  const upMax = Math.max(...upTotals, 0);
  const downMax = Math.max(...downTotals, 0);
  const { ticks, max } = barTicks(Math.max(upMax, downMax), 3);
  const total = 2 * max;
  const zeroY = Math.round(innerH / 2);
  // a length is rounded to the nearest whole pixel
  const scale = (v: number) => Math.round((v / total) * innerH);
  // 24 px at most on a narrow slot; on a wide one a bar stays 40 % of its slot instead of floating in air
  const barW = Math.round(Math.min(band * 0.62, Math.max(24, band * 0.4)));

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
            <ValueAxis
              ticks={[...ticks.slice(1).map((t) => -t), ...ticks]}
              y={(t) => zeroY - scale(t)}
              width={innerW}
              height={innerH}
              label={(t) => (t < 0 ? `−${moneyTick(-t)}` : moneyTick(t))}
            />
            {months.map((m, i) => {
              const x = Math.round(band * i + (band - barW) / 2);
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
                    return up.slice(ui + 1).some((n) => (n.values[i] ?? 0) > 0) ? <rect key={u.key} className="seg" x={x} y={y1 - h} width={barW} height={h} fill={u.color} /> : <path key={u.key} className="seg" d={roundedTop(x, y1 - h, barW, h)} fill={u.color} />;
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
                      <path key={d.key} className="seg" d={roundedTop(x, y0, barW, h)} transform={`translate(0 ${2 * y0 + h}) scale(1 -1)`} fill={d.color} />
                    ) : (
                      <rect key={d.key} className="seg" x={x} y={y0} width={barW} height={h} fill={d.color} />
                    );
                  })}
                  <CategoryTick x={band * i + band / 2} base={innerH} long={i % labelEvery === (months.length - 1) % labelEvery} />
                  {i % labelEvery === (months.length - 1) % labelEvery && (
                    <MonthLabel month={m} x={crisp(band * i + band / 2)} base={innerH} withYear={labelEvery === 1} />
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
