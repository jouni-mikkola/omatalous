// A price over time: one stepped line per series (a price holds until the next purchase), a marker at each purchase and a
// ring where the price changed. One axis; the series keep their order's colour and dash, and a legend names them.
import { useState } from "react";
import { date, money } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { ValueAxis } from "./Axes.tsx";
import { dashOf, keyStyle } from "./draw.ts";
import { valueAxis } from "./scale.ts";
import { Tooltip, TooltipRow } from "./Tooltip.tsx";
import "../styles/charts.css";

export interface PriceSeries {
  key: string;
  label: string;
  color: string;
  points: { day: string; cents: number }[];
}

const MARGIN = { top: 12, right: 12, bottom: 28, left: 64 };
const HEIGHT = 200;

const dayOf = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

export function PriceLine({ series, label, unit }: { series: readonly PriceSeries[]; label: string; unit: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ s: number; p: number } | null>(null);
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const days = all.map((p) => dayOf(p.day));
  const first = Math.min(...days);
  const last = Math.max(...days, first + 1);
  const axis = valueAxis(all.map((p) => p.cents), 3);
  const x = (iso: string) => ((dayOf(iso) - first) / (last - first)) * innerW;
  const y = (v: number) => innerH - axis.at(v) * innerH;
  const firstDay = all.reduce((a, p) => (p.day < a ? p.day : a), all[0]!.day);
  const lastDay = all.reduce((a, p) => (p.day > a ? p.day : a), all[0]!.day);
  return (
    <div className="chart" ref={ref}>
      {series.length > 1 && (
        <div className="legend" aria-hidden="true">
          {series.map((s, i) => (
            <span key={s.key}>
              <i className="line-key" style={keyStyle(s.color, dashOf(i))} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={label}>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            <ValueAxis ticks={axis.ticks} y={y} width={innerW} height={innerH} label={(t) => `${money(t)}`} />
            <text className="axis-note" x={0} y={innerH + 20}>
              {date(firstDay)}
            </text>
            <text className="axis-note" x={innerW} y={innerH + 20} textAnchor="end">
              {date(lastDay)}
            </text>
            {series.map((s, si) => {
              const pts = [...s.points].sort((a, b) => a.day.localeCompare(b.day));
              const d = pts.map((p, i) => (i === 0 ? `M${x(p.day)},${y(p.cents)}` : `H${x(p.day)}V${y(p.cents)}`)).join("");
              return (
                <g key={s.key}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={dashOf(si)} />
                  {pts.map((p, i) => {
                    const changed = i > 0 && p.cents !== pts[i - 1]!.cents;
                    const on = hover?.s === si && hover.p === i;
                    return (
                      <circle
                        key={`${p.day}:${i}`}
                        cx={x(p.day)}
                        cy={y(p.cents)}
                        r={changed || on ? 4.5 : 2.5}
                        fill={changed ? "var(--surface)" : s.color}
                        stroke={s.color}
                        strokeWidth={changed ? 2 : 0}
                        tabIndex={0}
                        aria-label={`${s.label} ${date(p.day)}: ${money(p.cents)} / ${unit}`}
                        onPointerEnter={() => setHover({ s: si, p: i })}
                        onPointerLeave={() => setHover(null)}
                        onFocus={() => setHover({ s: si, p: i })}
                        onBlur={() => setHover(null)}
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {hover && (() => {
        const s = series[hover.s]!;
        const p = [...s.points].sort((a, b) => a.day.localeCompare(b.day))[hover.p]!;
        return (
          <Tooltip x={MARGIN.left + x(p.day)} y={MARGIN.top + y(p.cents) - 8} containerWidth={width}>
            <div className="tooltip-title">{date(p.day)}</div>
            <TooltipRow color={s.color} dash={dashOf(hover.s)} name={s.label} value={`${money(p.cents)} / ${unit}`} />
          </Tooltip>
        );
      })()}
    </div>
  );
}
