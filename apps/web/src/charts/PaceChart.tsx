import { useState } from "react";
import { money, moneyTick } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { CategoryTick, ValueAxis } from "./Axes.tsx";
import { crisp, dashOf, keyStyle, LABEL_Y, labelPrinted } from "./draw.ts";
import { valueAxis, wholeTicks } from "./scale.ts";
import { Tooltip, TooltipRow } from "./Tooltip.tsx";
import "../styles/charts.css";

const MARGIN = { top: 12, right: 64, bottom: 24, left: 56 };
const RING = 3.5;
const CURRENT = "var(--series-1)";
const PREVIOUS = "var(--series-avg)";

/**
 * Cumulative spending of this month (accent) against the month before (gray), both of real rows, by day of the month.
 * The names are the months', for the legend and the tooltip. The month before has no line when the history does not reach it.
 */
export function PaceChart({
  current,
  previous,
  names,
  height = 220,
}: {
  current: (number | null)[];
  previous: number[] | null;
  names: { current: string; previous: string };
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  // one axis for both months: a longer month before still ends on its last day
  const days = Math.max(current.length, previous?.length ?? 0);
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  // the axis holds the lowest point too: a month that starts with a refund runs below zero, inside the frame
  const axis = valueAxis([...(previous ?? []), ...current.filter((v): v is number => v !== null)]);
  const ticks = wholeTicks(axis.ticks);
  const { at } = axis;
  const x = (i: number) => (days > 1 ? (i / (days - 1)) * innerW : 0);
  const y = (v: number) => innerH - at(v) * innerH;
  const path = (vals: (number | null)[]) =>
    vals.reduce((d, v, i) => (v === null ? d : `${d}${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`), "");
  const lastIdx = current.reduce<number>((last, v, i) => (v !== null ? i : last), -1);
  const lastVal = lastIdx >= 0 ? current[lastIdx]! : null;
  const lastDay = lastIdx + 1;
  // a regular label within two days of the last value's own day gives way to it; its tick stays, short
  const dayTicks = [1, 5, 10, 15, 20, 25, days].filter((d, i, a) => d <= days && a.indexOf(d) === i && !(d === 25 && days - 25 < 3));
  const drops = new Set(lastIdx >= 0 ? [lastDay] : []);
  const printed = (d: number) => labelPrinted(d, dayTicks.includes(d), drops);
  const ringX = lastIdx >= 0 ? crisp(x(lastIdx)) : 0;
  const ringY = lastVal !== null ? y(lastVal) : 0;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left) / box.width) * (days - 1));
    setHover(Math.max(0, Math.min(days - 1, i)));
  };

  return (
    <div className="chart" ref={ref}>
      <div className="legend" aria-hidden="true">
        <span>
          <i className="line-key" style={keyStyle(CURRENT)} />
          {names.current}
        </span>
        {previous && (
          <span>
            <i className="line-key" style={keyStyle(PREVIOUS, dashOf(1))} />
            {names.previous}
          </span>
        )}
      </div>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={previous ? "Kuukauden kertyvät menot verrattuna edelliseen kuukauteen" : "Kuukauden kertyvät menot"}>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            <ValueAxis ticks={ticks} y={y} width={innerW} height={innerH} label={moneyTick} />
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
              <g key={d}>
                <CategoryTick x={x(d - 1)} base={innerH} long={printed(d)} />
                {printed(d) && (
                  <text x={crisp(x(d - 1))} y={innerH + LABEL_Y} textAnchor="middle">
                    {d}.
                  </text>
                )}
              </g>
            ))}
            <g className="draw">
              {previous && <path d={path(previous)} fill="none" stroke={PREVIOUS} strokeWidth={2} strokeLinejoin="round" strokeDasharray={dashOf(1)} />}
              <path d={path(current)} fill="none" stroke={CURRENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {lastVal !== null && (
                <>
                  {ringY + RING + 4 < innerH && <line className="tick" x1={ringX} x2={ringX} y1={ringY + RING + 4} y2={innerH} />}
                  <circle cx={ringX} cy={ringY} r={RING} fill="var(--surface)" stroke={CURRENT} strokeWidth={2} />
                  <text x={ringX + 8} y={ringY} dy="0.32em" style={{ fill: "var(--text)", fontWeight: 600 }}>
                    {money(lastVal, false)}
                  </text>
                </>
              )}
            </g>
            {hover !== null && (
              <g pointerEvents="none">
                <line className="axis-line" x1={crisp(x(hover))} x2={crisp(x(hover))} y1={0} y2={innerH} />
                {previous?.[hover] != null && <circle cx={crisp(x(hover))} cy={y(previous[hover]!)} r={4} fill={PREVIOUS} stroke="var(--surface)" strokeWidth={2} />}
                {current[hover] != null && <circle cx={crisp(x(hover))} cy={y(current[hover]!)} r={4} fill={CURRENT} stroke="var(--surface)" strokeWidth={2} />}
              </g>
            )}
            <rect
              className="hit"
              x={-6}
              y={0}
              width={innerW + 12}
              height={innerH}
              tabIndex={0}
              role="group"
              aria-label="Siirry päivien välillä nuolinäppäimillä"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(lastIdx >= 0 ? lastIdx : 0)}
              onBlur={() => setHover(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") setHover((h) => Math.min(days - 1, (h ?? -1) + 1));
                if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? 1) - 1));
              }}
            />
          </g>
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={MARGIN.left + x(hover)} y={MARGIN.top + 8} containerWidth={width}>
          <div className="tooltip-title">{hover + 1}. päivä</div>
          {current[hover] != null && <TooltipRow color={CURRENT} name={names.current} value={money(current[hover]!, false)} />}
          {previous?.[hover] != null && <TooltipRow color={PREVIOUS} dash={dashOf(1)} name={names.previous} value={money(previous[hover]!, false)} />}
        </Tooltip>
      )}
    </div>
  );
}
