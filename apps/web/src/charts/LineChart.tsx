import { useState } from "react";
import { money, moneyTick } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { CategoryTick, ValueAxis } from "./Axes.tsx";
import { crisp, dashOf, keyStyle, LABEL_Y, labelPrinted } from "./draw.ts";
import { valueAxis, wholeTicks } from "./scale.ts";
import { Tooltip, TooltipRow } from "./Tooltip.tsx";
import "../styles/charts.css";

interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

const MARGIN = { top: 12, right: 16, bottom: 24, left: 64 };
const RING = 3.5;

/**
 * Multi-series line chart with a crosshair: 2px lines (the second dashed `6 3`, the third `2 3`), the last point a
 * ring, and from it a drop line to the day it belongs to. Negative values are supported (credit card balances).
 */
export function LineChart({ labels, series, height = 240, format = (v: number) => money(v, false) }: { labels: string[]; series: LineSeries[]; height?: number; format?: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const axis = valueAxis(series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const ticks = wholeTicks(axis.ticks);
  const { at } = axis;
  const n = labels.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
  const y = (v: number) => innerH - at(v) * innerH;
  const path = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 56))));
  const lastOf = (s: LineSeries) => s.values.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);
  // the days the drop lines end at: printed whatever the regular labels do, which give way within two days of one
  const drops = new Set(series.map(lastOf).filter((i) => i >= 0));
  const printed = (i: number) => labelPrinted(i, i % labelEvery === (n - 1) % labelEvery, drops);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1)))));
  };

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 && (
        <div className="legend" aria-hidden="true">
          {series.map((s, si) => (
            <span key={s.key}>
              <i className="line-key" style={keyStyle(s.color, dashOf(si))} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(", ")}>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            <ValueAxis ticks={ticks} y={y} width={innerW} height={innerH} label={(t) => (t < 0 ? `−${moneyTick(-t)}` : moneyTick(t))} />
            {labels.map((l, i) => (
              <g key={l + i}>
                <CategoryTick x={x(i)} base={innerH} long={printed(i)} />
                {printed(i) && (
                  <text x={crisp(x(i))} y={innerH + LABEL_Y} textAnchor="middle">
                    {l}
                  </text>
                )}
              </g>
            ))}
            <g className="draw">
              {series.map((s, si) => {
                const last = lastOf(s);
                const dash = dashOf(si);
                const cx = last >= 0 ? crisp(x(last)) : 0;
                const cy = last >= 0 ? y(s.values[last]!) : 0;
                return (
                  <g key={s.key}>
                    <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap={dash ? "butt" : "round"} strokeDasharray={dash} />
                    {last >= 0 && cy + RING + 4 < innerH && <line className="tick" x1={cx} x2={cx} y1={cy + RING + 4} y2={innerH} />}
                    {last >= 0 && <circle cx={cx} cy={cy} r={RING} fill="var(--surface)" stroke={s.color} strokeWidth={2} />}
                  </g>
                );
              })}
            </g>
            {hover !== null && (
              <g pointerEvents="none">
                <line className="axis-line" x1={crisp(x(hover))} x2={crisp(x(hover))} y1={0} y2={innerH} />
                {series.map((s) =>
                  s.values[hover] != null ? <circle key={s.key} cx={crisp(x(hover))} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null,
                )}
              </g>
            )}
            <rect
              className="hit"
              x={-6}
              y={0}
              width={innerW + 12}
              height={innerH}
              tabIndex={0}
              aria-label="Siirry nuolinäppäimillä"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(n - 1)}
              onBlur={() => setHover(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
                if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? 1) - 1));
              }}
            />
          </g>
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={MARGIN.left + x(hover)} y={MARGIN.top + 8} containerWidth={width}>
          <div className="tooltip-title">{labels[hover]}</div>
          {series.map((s, si) => (s.values[hover] != null ? <TooltipRow key={s.key} color={s.color} dash={dashOf(si)} name={s.label} value={format(s.values[hover]!)} /> : null))}
        </Tooltip>
      )}
    </div>
  );
}
