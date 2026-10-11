import { useState } from "react";
import { money, moneyTick } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { niceTicks } from "./scale.ts";
import { Tooltip, TooltipRow } from "./Tooltip.tsx";
import "../styles/charts.css";

const MARGIN = { top: 12, right: 64, bottom: 24, left: 56 };
const CURRENT = "var(--series-1)";
const USUAL = "var(--series-avg)";

/** Cumulative spending this month (accent) against the usual month (gray), when there are three complete months to say what usual is. */
export function PaceChart({ current, usual, height = 220 }: { current: (number | null)[]; usual: number[] | null; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const days = current.length;
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const values = [...(usual ?? []), ...current.filter((v): v is number => v !== null)];
  const { ticks, max } = niceTicks(Math.max(...values, 0));
  const x = (i: number) => (days > 1 ? (i / (days - 1)) * innerW : 0);
  const y = (v: number) => innerH - (v / max) * innerH;
  const path = (vals: (number | null)[]) =>
    vals.reduce((d, v, i) => (v === null ? d : `${d}${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`), "");
  const lastIdx = current.reduce<number>((last, v, i) => (v !== null ? i : last), -1);
  const lastVal = lastIdx >= 0 ? current[lastIdx]! : null;
  const dayTicks = [1, 5, 10, 15, 20, 25, days].filter((d, i, a) => d <= days && a.indexOf(d) === i && !(d === 25 && days - 25 < 3));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left) / box.width) * (days - 1));
    setHover(Math.max(0, Math.min(days - 1, i)));
  };

  return (
    <div className="chart" ref={ref}>
      <div className="legend" aria-hidden="true">
        <span>
          <i className="line-key" style={{ background: CURRENT }} />
          Tämä kuukausi
        </span>
        {usual && (
          <span>
            <i className="line-key" style={{ background: USUAL }} />
            Tavallisesti
          </span>
        )}
      </div>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Kuukauden kertyvät menot verrattuna tavalliseen kuukauteen">
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line className={t === 0 ? "axis-line" : "grid-line"} x1={0} x2={innerW} />
                <text x={-8} dy="0.32em" textAnchor="end">
                  {moneyTick(t)}
                </text>
              </g>
            ))}
            {dayTicks.map((d) => (
              <text key={d} x={x(d - 1)} y={innerH + 16} textAnchor="middle">
                {d}.
              </text>
            ))}
            {usual && <path d={path(usual)} fill="none" stroke={USUAL} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            <path d={path(current)} fill="none" stroke={CURRENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {lastVal !== null && (
              <>
                <circle cx={x(lastIdx)} cy={y(lastVal)} r={4} fill={CURRENT} stroke="var(--surface)" strokeWidth={2} />
                <text x={x(lastIdx) + 8} y={y(lastVal)} dy="0.32em" style={{ fill: "var(--text)", fontWeight: 600 }}>
                  {money(lastVal, false)}
                </text>
              </>
            )}
            {hover !== null && (
              <g pointerEvents="none">
                <line className="axis-line" x1={x(hover)} x2={x(hover)} y1={0} y2={innerH} />
                {usual && <circle cx={x(hover)} cy={y(usual[hover]!)} r={4} fill={USUAL} stroke="var(--surface)" strokeWidth={2} />}
                {current[hover] != null && <circle cx={x(hover)} cy={y(current[hover]!)} r={4} fill={CURRENT} stroke="var(--surface)" strokeWidth={2} />}
              </g>
            )}
            <rect
              className="hit"
              x={-6}
              y={0}
              width={innerW + 12}
              height={innerH}
              tabIndex={0}
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
          {current[hover] != null && <TooltipRow color={CURRENT} name="Tämä kuukausi" value={money(current[hover]!, false)} />}
          {usual && <TooltipRow color={USUAL} name="Tavallisesti" value={money(usual[hover]!, false)} />}
        </Tooltip>
      )}
    </div>
  );
}
