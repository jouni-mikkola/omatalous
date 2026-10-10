import { useState } from "react";
import { money, moneyTick } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { niceTicks } from "./scale.ts";
import { Tooltip, TooltipRow } from "./Tooltip.tsx";
import "../styles/charts.css";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

const MARGIN = { top: 12, right: 16, bottom: 24, left: 64 };

/**
 * Multi-series line chart with a crosshair: 2px lines, end dots with a
 * surface ring, one axis. Negative values are supported (credit card balances).
 */
export function LineChart({ labels, series, height = 240, format = (v: number) => money(v, false) }: { labels: string[]; series: LineSeries[]; height?: number; format?: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  // one step for the whole span: a step taken from the positive side alone becomes tiny when
  // everything is negative (a credit card only) and the tick loop never ends
  const step = niceTicks(Math.max(hi - lo, 1), 4).ticks[1]!;
  const minV = Math.floor(lo / step) * step || 0; // avoid a "−0 €" tick
  const maxV = Math.max(Math.ceil(hi / step) * step, minV + step);
  const ticks: number[] = [];
  for (let v = minV; v <= maxV + step / 2 && ticks.length < 12; v += step) ticks.push(v);
  const n = labels.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
  const y = (v: number) => innerH - ((v - minV) / (maxV - minV || 1)) * innerH;
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

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1)))));
  };

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 && (
        <div className="legend" aria-hidden="true">
          {series.map((s) => (
            <span key={s.key}>
              <i className="line-key" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(", ")}>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line className={t === 0 ? "axis-line" : "grid-line"} x1={0} x2={innerW} />
                <text x={-8} dy="0.32em" textAnchor="end">
                  {t < 0 ? `−${moneyTick(-t)}` : moneyTick(t)}
                </text>
              </g>
            ))}
            {labels.map((l, i) =>
              i % labelEvery === (n - 1) % labelEvery ? (
                <text key={l + i} x={x(i)} y={innerH + 16} textAnchor="middle">
                  {l}
                </text>
              ) : null,
            )}
            {series.map((s) => {
              const last = s.values.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);
              return (
                <g key={s.key}>
                  <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {last >= 0 && <circle cx={x(last)} cy={y(s.values[last]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
                </g>
              );
            })}
            {hover !== null && (
              <g pointerEvents="none">
                <line className="axis-line" x1={x(hover)} x2={x(hover)} y1={0} y2={innerH} />
                {series.map((s) =>
                  s.values[hover] != null ? <circle key={s.key} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null,
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
          {series.map((s) => (s.values[hover] != null ? <TooltipRow key={s.key} color={s.color} name={s.label} value={format(s.values[hover]!)} /> : null))}
        </Tooltip>
      )}
    </div>
  );
}
