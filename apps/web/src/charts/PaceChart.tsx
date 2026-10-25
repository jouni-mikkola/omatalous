// Decision: is the month's spending on its usual course, or should the household slow down before payday
import type { CSSProperties } from "react";
import { money, moneyTick } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { approxText } from "../components/Why.tsx";
import type { DashboardData } from "../types.ts";
import { CategoryTick, ValueAxis } from "./Axes.tsx";
import { crisp, labelPrinted, LABEL_Y } from "./draw.ts";
import { wholeTicks } from "./scale.ts";
import { placeMarkers } from "./kit/annotate.ts";
import { EventMarkers, LANE_H } from "./kit/Annotations.tsx";
import { axisRoom, frame, tickTarget } from "./kit/layout.ts";
import { areaPath, linePath } from "./kit/path.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "./kit/Readout.tsx";
import { boxPlace, readoutText } from "./kit/readout.ts";
import { linear } from "./kit/scale.ts";
import { dayTicks, moneyAxis } from "./kit/ticks.ts";
import "../styles/charts.css";

type Pace = DashboardData["pace"];

/** The width the first paint draws at, before the box is measured. */
const UNMEASURED = 800;
/** Under this width the line ends lose their labels: the key and the readout carry them. */
const NARROW = 600;
const RING = 3.5;

/** An estimate's range, the unit once ("5 200–5 900 €"), marked as an estimate the one way Why.tsx marks one. */
export const estimateRange = (lo: number, hi: number) => approxText(`${money(lo, false).replace(/\s€$/, "")}–${money(hi, false)}`, true);

/** One row of the readout and the table: a day and what each line says on it. */
export interface PaceDay {
  day: number;
  current: number | null;
  usual: number | null;
  previous: number | null;
  /** The estimate's low and high from today on. */
  projection: [number, number] | null;
}

/** The lines of `pace` on day `d` (1-based), as the readout and the table read them; nothing is worked out. */
export function paceDay(pace: Pace, d: number): PaceDay {
  const { projection } = pace;
  const at = projection ? d - projection.fromDay : -1;
  return {
    day: d,
    current: pace.current[d - 1] ?? null,
    usual: pace.usual?.curve[d - 1] ?? null,
    previous: pace.previous?.curve[d - 1] ?? null,
    projection: projection && at >= 0 && at < projection.low.length ? [projection.low[at]!, projection.high[at]!] : null,
  };
}

/**
 * The running month's cumulative spending (accent, 2.5 px) against the household's usual month: its median as a line and
 * the middle half of the complete months as a band, last month dotted, the rest of this month as the usual months spent
 * it (an estimate: a lighter dashed band), and the pay days and the largest purchase as events on the day axis. Every
 * value is a field of `pace`; `payday` is the day of the coming pay when it falls in this month.
 */
export function PaceChart({ pace, goal, payday, names }: { pace: Pace; goal: number | null; payday: number | null; names: { current: string; previous: string } }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const width = measured || UNMEASURED;
  const [at, setAt] = useReadout();
  const { usual, projection, previous, largest } = pace;
  const days = pace.daysInMonth;
  const lastDay = pace.current.reduce<number>((n, v, i) => (v === null ? n : i + 1), 0);
  const narrow = width < NARROW;
  const all = [...pace.current.filter((v): v is number => v !== null), ...(usual?.high ?? []), ...(usual?.low ?? []), ...(previous?.curve ?? []), ...(projection?.high ?? []), ...(goal === null ? [] : [goal])];
  const left = axisRoom(linear(all, [0, 1]).ticks.map(moneyAxis));
  const f = frame(width, { top: 16, right: narrow ? 12 : 112, bottom: 24, left }, { minHeight: 220, tallest: 300, ratio: 0.26, extraBottom: LANE_H * 2 });
  const y = linear(all, [f.innerH, 0], { target: tickTarget(f.innerH) });
  const ticks = wholeTicks(y.ticks);
  const x = (i: number) => (days <= 1 ? 0 : (i / (days - 1)) * f.innerW);
  const xs = Array.from({ length: days }, (_, i) => x(i));
  // the estimate's first point stands on today's day
  const px = (i: number) => x((projection?.fromDay ?? 1) - 1 + i);
  const markers = placeMarkers(
    [
      ...(largest ? [{ key: "largest", x: x(largest.day - 1), label: `Suurin meno ${largest.name}` }] : []),
      ...pace.payDays.map((d) => ({ key: `pay:${d}`, x: x(d - 1), label: `Palkka ${d}.` })),
      ...(payday && !pace.payDays.includes(payday) ? [{ key: "payday", x: x(payday - 1), label: `Palkka ${payday}.` }] : []),
    ],
    f.innerW,
  );
  const now = lastDay ? pace.current[lastDay - 1]! : null;
  const endLow = projection?.low.at(-1) ?? null;
  const endHigh = projection?.high.at(-1) ?? null;
  const usualEnd = usual ? y(usual.curve.at(-1)!) : null;
  // the estimate's end label clears the usual's by a line
  const estY = endHigh === null ? 0 : usualEnd !== null && Math.abs(y(endHigh) - usualEnd) < 14 ? usualEnd + 14 : y(endHigh);
  const printed = (d: number) => labelPrinted(d, dayTicks(days).includes(d), new Set(lastDay ? [lastDay] : []));

  const title = (i: number) => `${i + 1}.${Number(pace.month.slice(5, 7))}.`;
  const rows = (i: number) => {
    const p = paceDay(pace, i + 1);
    return [
      ...(p.current !== null ? [{ name: names.current, value: money(p.current) }] : []),
      ...(p.usual !== null ? [{ name: "Tavallisesti", value: money(p.usual) }] : []),
      ...(p.previous !== null ? [{ name: names.previous, value: money(p.previous) }] : []),
      ...(p.projection && i + 1 > lastDay ? [{ name: "Arvio", value: estimateRange(p.projection[0], p.projection[1]) }] : []),
      ...(goal === null ? [] : [{ name: "Tavoite", value: money(goal) }]),
    ];
  };

  return (
    <div ref={ref} className="chart pace-chart">
      <svg width={f.width} height={f.height} role="img" aria-label={`Kuukauden kertyvät menot${usual ? " tavalliseen kuuhun verrattuna" : ""}${goal === null ? "" : " ja menotavoite"}`}>
        <g transform={`translate(${f.margin.left},${f.margin.top})`}>
          <ValueAxis ticks={ticks} y={y} width={f.innerW} height={f.innerH} label={moneyTick} />
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
            <g key={d}>
              <CategoryTick x={x(d - 1)} base={f.innerH} long={printed(d)} />
              {printed(d) && (
                <text x={crisp(x(d - 1))} y={f.innerH + LABEL_Y} textAnchor="middle">
                  {d}.
                </text>
              )}
            </g>
          ))}
          <EventMarkers markers={markers} innerH={f.innerH} base={f.innerH + LABEL_Y} />
          <g className="draw">
            {usual && <path className="pace-usual-band" d={areaPath(usual.low, usual.high, x, y)} />}
            {usual && <path className="pace-usual" d={linePath(usual.curve, x, y)} />}
            {previous && <path className="pace-prev" d={linePath(previous.curve.slice(0, days), x, y)} />}
            {goal !== null && (
              <>
                <line className="pace-goal-line" x1={0} x2={f.innerW} y1={crisp(y(goal))} y2={crisp(y(goal))} />
                <text className="pace-goal-label" x={4} y={y(goal) - 6}>
                  Tavoite {money(goal, false)}
                </text>
              </>
            )}
            {projection && <path className="pace-est" d={areaPath(projection.low, projection.high, px, y)} />}
            <path className="pace-now" d={linePath(pace.current, x, y)} />
            {now !== null && (
              <>
                <circle className="pace-dot" cx={crisp(x(lastDay - 1))} cy={y(now)} r={RING} />
                <text className="pace-now-label" x={x(lastDay - 1)} y={y(now) - 10} textAnchor={lastDay > days - 3 ? "end" : "middle"}>
                  {money(now, false)}
                </text>
              </>
            )}
            {!narrow && usualEnd !== null && (
              <text className="pace-end" x={f.innerW + 8} y={usualEnd} dy="0.32em">
                Tavallisesti
              </text>
            )}
            {!narrow && endLow !== null && endHigh !== null && (
              <text className="pace-end pace-end-est" x={f.innerW + 8} y={estY} dy="0.32em">
                {estimateRange(endLow, endHigh)}
              </text>
            )}
          </g>
          <ReadoutLayer xs={xs} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} label="Menot päivittäin. Siirry päivien välillä nuolinäppäimillä" focusAt={lastDay ? lastDay - 1 : 0} />
        </g>
      </svg>
      {at !== null && (
        <div className="tooltip pace-readout" style={{ ...boxPlace(f.margin.left + xs[at]!, f.width), top: 8 } as CSSProperties}>
          <div className="tooltip-title">{title(at)}</div>
          {rows(at).map((r) => (
            <div key={r.name} className="pace-readout-row">
              <span>{r.name}</span>
              <span className="num">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <LiveReadout text={at === null ? "" : readoutText(title(at), rows(at))} />
      <ul className="pace-key" aria-hidden="true">
        <li>
          <span className="pace-key-now" />
          {names.current}
        </li>
        {usual && (
          <li>
            <span className="pace-key-usual" />
            Tavallinen kuu, keskimmäinen puolet
          </li>
        )}
        {previous && (
          <li>
            <span className="pace-key-prev" />
            {names.previous}
          </li>
        )}
        {goal !== null && (
          <li>
            <span className="pace-key-goal" />
            Menotavoite
          </li>
        )}
        {projection && (
          <li>
            <span className="pace-key-est" />
            Arvio loppukuusta
          </li>
        )}
      </ul>
    </div>
  );
}
