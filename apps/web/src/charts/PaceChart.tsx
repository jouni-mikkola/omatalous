// Decision: is the month's spending on its usual course, or should the household slow down before payday
import { joinRange } from "@banking/core";
import { money, moneyTick } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { approxText } from "../approx.ts";
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
import "../styles/pace-chart.css";
import { css } from "../css.ts";
import { t } from "../text.ts";

type Pace = DashboardData["pace"];

/** The width the first paint draws at, before the box is measured. */
const UNMEASURED = 800;
/** Under this width the line ends lose their labels: the key and the readout carry them. */
const NARROW = 600;
const RING = 3.5;

/** An estimate's range, the unit once ("5 200–5 900 €"), marked as an estimate the one way Why.tsx marks one. */
const estimateRange = (lo: number, hi: number) => approxText(joinRange(money(lo, false), money(hi, false)), true);

/** One row of the readout and the table: a day and what each line says on it. */
export interface PaceDay {
  day: number;
  current: number | null;
  expected: number | null;
  previous: number | null;
  /** The estimate's low and high from today on. */
  projection: [number, number] | null;
}

/** The lines of `pace` on day `d` (1-based), as the readout and the table read them; nothing is worked out. */
function paceDay(pace: Pace, d: number): PaceDay {
  const { projection } = pace;
  const at = projection ? d - projection.fromDay : -1;
  return {
    day: d,
    current: pace.current[d - 1] ?? null,
    expected: pace.expected?.curve[d - 1] ?? null,
    previous: pace.previous?.curve[d - 1] ?? null,
    projection: projection && at >= 0 && at < projection.low.length ? [projection.low[at]!, projection.high[at]!] : null,
  };
}

/**
 * The running month's cumulative spending (accent, 2.5 px) against the household's expected month: the sum of its categories as a line and
 * the middle half of the complete months as a band, last month dotted, the rest of this month as the base months spent
 * it (an estimate: a lighter dashed band), and the pay days and the largest purchase as events on the day axis. Every
 * value is a field of `pace`; `payday` is the day of the coming pay when it falls in this month.
 */
export function PaceChart({ pace, goal, payday, names }: { pace: Pace; goal: number | null; payday: number | null; names: { current: string; previous: string } }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const width = measured || UNMEASURED;
  const [at, setAt] = useReadout();
  const { expected, projection, previous, largest } = pace;
  const days = pace.daysInMonth;
  const lastDay = pace.current.reduce<number>((n, v, i) => (v === null ? n : i + 1), 0);
  const narrow = width < NARROW;
  const all = [...pace.current.filter((v): v is number => v !== null), ...(expected?.high ?? []), ...(expected?.low ?? []), ...(previous?.curve ?? []), ...(projection?.high ?? []), ...(goal === null ? [] : [goal])];
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
      ...(largest ? [{ key: "largest", x: x(largest.day - 1), label: t("chart.largest", { name: largest.name }) }] : []),
      ...pace.payDays.map((d) => ({ key: `pay:${d}`, x: x(d - 1), label: t("chart.pay_day", { day: d }) })),
      ...(payday && !pace.payDays.includes(payday) ? [{ key: "payday", x: x(payday - 1), label: t("chart.pay_day", { day: payday }) }] : []),
    ],
    f.innerW,
  );
  const now = lastDay ? pace.current[lastDay - 1]! : null;
  const endLow = projection?.low.at(-1) ?? null;
  const endHigh = projection?.high.at(-1) ?? null;
  const expectedEnd = expected ? y(expected.curve.at(-1)!) : null;
  // the estimate's end label clears the expected one's by a line
  const estY = endHigh === null ? 0 : expectedEnd !== null && Math.abs(y(endHigh) - expectedEnd) < 14 ? expectedEnd + 14 : y(endHigh);
  const printed = (d: number) => labelPrinted(d, dayTicks(days).includes(d), new Set(lastDay ? [lastDay] : []));

  const title = (i: number) => `${i + 1}.${Number(pace.month.slice(5, 7))}.`;
  const rows = (i: number) => {
    const p = paceDay(pace, i + 1);
    return [
      ...(p.current !== null ? [{ name: names.current, value: money(p.current) }] : []),
      ...(p.expected !== null ? [{ name: t("home.col_expected"), value: money(p.expected) }] : []),
      ...(p.previous !== null ? [{ name: names.previous, value: money(p.previous) }] : []),
      ...(p.projection && i + 1 > lastDay ? [{ name: t("home.col_estimate"), value: estimateRange(p.projection[0], p.projection[1]) }] : []),
      ...(goal === null ? [] : [{ name: t("chart.goal"), value: money(goal) }]),
    ];
  };

  return (
    <div ref={ref} className="chart pace-chart">
      <svg width={f.width} height={f.height}>
        <g transform={`translate(${f.margin.left},${f.margin.top})`}>
          <g role="img" aria-label={t("chart.aria_pace", { expected: expected ? t("chart.aria_expected") : "", goal: goal === null ? "" : t("chart.aria_goal") })}>
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
            {expected && <path className="pace-usual-band" d={areaPath(expected.low, expected.high, x, y)} />}
            {expected && <path className="pace-usual" d={linePath(expected.curve, x, y)} />}
            {previous && <path className="pace-prev" d={linePath(previous.curve.slice(0, days), x, y)} />}
            {goal !== null && (
              <>
                <line className="pace-goal-line" x1={0} x2={f.innerW} y1={crisp(y(goal))} y2={crisp(y(goal))} />
                <text className="pace-goal-label" x={4} y={y(goal) - 6}>
                  {t("chart.goal_at", { sum: money(goal, false) })}
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
            {!narrow && expectedEnd !== null && (
              <text className="pace-end" x={f.innerW + 8} y={expectedEnd} dy="0.32em">
                {t("home.col_expected")}
              </text>
            )}
            {!narrow && endLow !== null && endHigh !== null && (
              <text className="pace-end pace-end-est" x={f.innerW + 8} y={estY} dy="0.32em">
                {estimateRange(endLow, endHigh)}
              </text>
            )}
          </g>
          </g>
          <ReadoutLayer xs={xs} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} keys={xs.map((_, i) => String(i + 1))} label={t("chart.arrows")} focusAt={lastDay ? lastDay - 1 : 0} />
        </g>
      </svg>
      {at !== null && (
        <div className="tooltip pace-readout" ref={css({ left: undefined, right: undefined, ...boxPlace(f.margin.left + xs[at]!, f.width), top: 8 })}>
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
        {expected && (
          <li>
            <span className="pace-key-usual" />
            {t("chart.expected_range")}
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
            {t("chart.spending_goal")}
          </li>
        )}
        {projection && (
          <li>
            <span className="pace-key-est" />
            {t("chart.estimate_end")}
          </li>
        )}
      </ul>
    </div>
  );
}
