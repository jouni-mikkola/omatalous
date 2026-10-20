// Months as small columns: one measure on the main axis, and up to two smaller ones in a strip under the month labels,
// side by side on one € scale of their own, so a few euros a month stay readable beside hundreds. Both share the
// months' x positions, so a column and its strip pair read as one month. A month with no value draws nothing (no zero).
// A tap picks a month.
import { useState } from "react";
import { money, moneyTick, monthLong } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { CategoryTick, hasYearLine, MonthLabel, ValueAxis, YEAR_LINE } from "./Axes.tsx";
import { crisp, keyStyle } from "./draw.ts";
import { barTicks, roundedTop } from "./scale.ts";
import { Tooltip, TooltipRow } from "./Tooltip.tsx";
import "../styles/charts.css";
import "../styles/step-charts.css";

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

const MARGIN = { top: 8, right: 4, bottom: 24, left: 56 };
/** The strip of the smaller measures: its height and the gap above it, under the month labels. */
const STRIP_H = 64;
const STRIP_GAP = 20;

/** A level each month is set against (its usual), drawn as a dashed step over the columns and named at the picked month. */
export interface ColumnLine {
  key: string;
  label: string;
  values: (number | null)[];
}

/**
 * `picked` draws its column in `pickedColor` (the legend names it), the others in the series colour; hovering dims the rest.
 */
export function LedgerColumns({ months, up, down = [], line, label, picked = null, pickedColor, pickedLabel, onPick, height = 240 }: { months: string[]; up: ColumnSeries; down?: ColumnSeries[]; line?: ColumnLine; label: string; picked?: string | null; pickedColor?: string; pickedLabel?: string; onPick?: (month: string) => void; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const band = months.length ? innerW / months.length : 0;
  const labelEvery = band >= 36 ? 1 : band >= 20 ? 2 : 3;
  const innerH = height - MARGIN.top - MARGIN.bottom - (hasYearLine(months, labelEvery) ? YEAR_LINE : 0);
  const upMax = Math.max(0, ...up.values.map((v) => v ?? 0), ...(line?.values.map((v) => v ?? 0) ?? []));
  const { ticks, max } = barTicks(upMax, 3);
  const scale = (v: number) => Math.round((v / (max || 1)) * innerH);
  const zeroY = innerH;
  const barW = Math.round(Math.min(band * 0.62, Math.max(14, band * 0.5)));
  const strip = down.length > 0;
  const stripMax = barTicks(Math.max(0, ...down.flatMap((d) => d.values.map((v) => v ?? 0))), 1);
  const stripTop = height - MARGIN.top + STRIP_GAP;
  const stripScale = (v: number) => Math.round((v / (stripMax.max || 1)) * STRIP_H);
  const pairW = Math.max(3, Math.floor((barW - 2) / Math.max(1, down.length)));
  const fullH = height + (strip ? STRIP_GAP + STRIP_H + 4 : 0);
  const at = picked ? months.indexOf(picked) : -1;
  const series = [up, ...down];
  const keys = [up, ...(at >= 0 && pickedColor ? [{ key: "picked", label: pickedLabel ?? monthLong(picked!), color: pickedColor }] : []), ...down];
  const lineAt = at >= 0 ? (line?.values[at] ?? null) : null;
  return (
    <div className="chart" ref={ref}>
      <div className="legend" aria-hidden="true">
        {keys.map((s) => (
          <span key={s.key}>
            <i className="swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        {line && (
          <span>
            <i className="line-key" style={keyStyle("var(--text-2)", "4 3")} />
            {line.label}
          </span>
        )}
      </div>
      {width > 0 && (
        <svg width={width} height={fullH} role="img" aria-label={label}>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            <ValueAxis ticks={ticks} y={(t) => zeroY - scale(t)} width={innerW} height={innerH} label={moneyTick} />
            {strip && (
              <g transform={`translate(0,${stripTop})`}>
                <ValueAxis ticks={stripMax.ticks} y={(t) => STRIP_H - stripScale(t)} width={innerW} height={STRIP_H} label={moneyTick} />
              </g>
            )}
            {months.map((m, i) => {
              const x = Math.round(band * i + (band - barW) / 2);
              const dim = hover !== null && hover !== i;
              const v = up.values[i];
              return (
                <g key={m} opacity={dim ? 0.45 : 1}>
                  {v !== null && v !== undefined && v > 0 && <path className="seg" d={roundedTop(x, zeroY - scale(v), barW, scale(v))} fill={i === at && pickedColor ? pickedColor : up.color} />}
                  {down.map((d, di) => {
                    const dv = Math.max(0, d.values[i] ?? 0);
                    if (!dv) return null;
                    const h = Math.max(1, stripScale(dv));
                    // the pair stands side by side under its column, a 2 px gap between
                    return <path key={d.key} className="seg" d={roundedTop(x + di * (pairW + 2), stripTop + STRIP_H - h, pairW, h)} fill={d.color} />;
                  })}
                  <CategoryTick x={band * i + band / 2} base={innerH} long={i % labelEvery === (months.length - 1) % labelEvery} />
                  {i % labelEvery === (months.length - 1) % labelEvery && <MonthLabel month={m} x={crisp(band * i + band / 2)} base={innerH} withYear={labelEvery === 1} />}
                </g>
              );
            })}
            {line &&
              line.values.map((lv, i) =>
                lv === null ? null : <line key={`line-${months[i]}`} className="usual-step" x1={band * i + 2} x2={band * (i + 1) - 2} y1={crisp(zeroY - scale(lv))} y2={crisp(zeroY - scale(lv))} stroke="var(--text-2)" strokeWidth={2} strokeDasharray="4 3" />,
              )}
            {lineAt !== null && (
              <text className="usual-note" x={Math.min(innerW - 4, band * (at + 1))} y={zeroY - scale(lineAt) - 6} textAnchor="end">
                {`${line!.label.toLowerCase()} ${moneyTick(lineAt)}`}
              </text>
            )}
            {months.map((m, i) => (
              <rect
                key={m}
                className="hit"
                x={band * i}
                y={0}
                width={band}
                height={strip ? stripTop + STRIP_H : innerH}
                tabIndex={0}
                role={onPick ? "button" : "group"}
                aria-pressed={onPick ? picked === m : undefined}
                aria-label={`${monthLong(m)}: ${series.map((s) => `${s.label.toLowerCase()} ${s.values[i] == null ? "ei tietoa" : money(s.values[i]!)}`).join(", ")}${line && line.values[i] != null ? `, ${line.label.toLowerCase()} ${money(line.values[i]!)}` : ""}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => onPick?.(m)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick && (e.preventDefault(), onPick(m))}
              />
            ))}
          </g>
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={MARGIN.left + band * hover + band / 2} y={MARGIN.top + 16} containerWidth={width}>
          <div className="tooltip-title">{monthLong(months[hover]!)}</div>
          {series.map((s) => (
            <TooltipRow key={s.key} color={s.color} name={s.label} value={s.values[hover] == null ? "–" : money(s.values[hover]!)} />
          ))}
          {line && line.values[hover] != null && <TooltipRow color="var(--text-2)" dash="4 3" name={line.label} value={money(line.values[hover]!)} />}
        </Tooltip>
      )}
    </div>
  );
}
