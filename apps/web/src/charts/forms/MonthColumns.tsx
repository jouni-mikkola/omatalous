// Decision: how the period's money moved month by month, and which months fall away from the usual level
import { useId } from "react";
import { useWidth } from "../../hooks.ts";
import { daysInMonth } from "@banking/core";
import { answerMoney, dayMonth, monthLabel, monthLong } from "../../format.ts";
import { t } from "../../text.ts";
import { CategoryTick, ValueAxis } from "../Axes.tsx";
import { crisp, LABEL_Y } from "../draw.ts";
import { CAP_OVERSHOOT, capSum, capY, CapBreak, CapSum } from "../kit/cap.tsx";
import { axisRoom, frame, monthPlot } from "../kit/layout.ts";
import { monthNamePlaces, printedMonths } from "../kit/label.ts";
import { type Against, LiveReadout, ReadoutLayer, ReadoutLine, UsualLabel, USUAL_STRIP, useReadout, usualComparison } from "../kit/Readout.tsx";
import { lastWhole, readoutText } from "../kit/readout.ts";
import { band, linear } from "../kit/scale.ts";
import { monthAxisLabels, monthTickTarget } from "../kit/ticks.ts";
import "../../styles/charts.css";
import "../../styles/month-columns.css";

interface MonthColumnsSeries {
  key: string;
  label: string;
}

interface MonthColumn {
  month: string;
  /** The month has ended and the accounts cover it from its 1st; any other is drawn hatched with a dashed edge. */
  complete: boolean;
  /** One sum per series, in the order of `series`; a column stacks them from the bottom (a negative one from zero downwards). */
  parts: readonly number[];
  /** The part of each series already paid, in the order of `series`: drawn filled under `parts`, which are then what is still to come and drawn hatched with a dashed edge. A month whose `paid` is set is never drawn as a month that is not whole. */
  paid?: readonly number[];
  /** The month's total as the report gives it: the axis and the readout read it, nothing is added up here for them. Null in a month the data does not reach: no column, and the readout says "–". */
  totalCents: number | null;
  /** The month's gap to `usual` as the report gives it (null in a month that is not whole or the same to the euro); the readout words it. */
  against?: Against | null;
}

/** The width the first paint draws at, before the box is measured. */
const UNMEASURED = 640;
/** Room under the axis for a month's name and the line that carries its year. */
const BOTTOM = LABEL_Y + 16;
/** Room above the plot for the sum written over a clipped column. */
const TOP = 22;
/** A month's sum is an outlier when it is more than this many times the third quartile of the months' sums (`robustDomain`). */
const OUTLIER_FACTOR = 2;
/** Under this width the chart uses the short label of the usual line. */
const NARROW = 600;

/**
 * One column a month (`months`), stacked by `series`, on one value axis that starts at 0. `usual` is the level the
 * months are read against, a dashed line across them. A month that is not whole is drawn hatched with a dashed edge and
 * says why in its readout. Pointing at a month or stepping to it with the keys reads its sums out, and a click or
 * Enter keeps that month's row in the table under the chart (`rowKey` of that table is the month). Every figure is a
 * field of the report: only the stack's total is added up here, for the axis. A month far above the others (more than
 * twice the third quartile) does not set the axis: its column is cut 6 px past the top with a break, and its sum is
 * written above it.
 */
export function MonthColumns({
  months,
  series,
  tone,
  usual,
  running,
  resting = null,
  label,
  today = null,
  states = null,
  keepHeight = false,
  low = false,
}: {
  months: readonly MonthColumn[];
  series: readonly MonthColumnsSeries[];
  /** The colours of the stack: spending is one series in its role colour, income is stacked in the series colours. */
  tone: "spending" | "income";
  usual: { cents: number; label: string; short: string } | null;
  /** The month that has not ended yet (`YYYY-MM`). */
  running: string | null;
  /** The month the readout names while nothing is pointed at (`YYYY-MM`); with none, or one the chart lacks, the last whole month. */
  resting?: string | null;
  /** What the chart is, for a screen reader's name of it. */
  label: string;
  /** The day (`YYYY-MM-DD`) a rule is drawn at, with the ground right of it tinted. The month of the day must be one of `months`. */
  today?: string | null;
  /** The words of a column's paid and coming parts, for the readout, when the months have `paid`. */
  states?: { paid: string; coming: string } | null;
  /** The strip for the usual level's name is taken out of the plot, so the chart is as tall as it is without that level (a page with a height limit). */
  keepHeight?: boolean;
  /** The plot is half as high: the chart stands under the list that tells its figures. */
  low?: boolean;
}) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const hatch = `ms-${useId().replace(/\W/g, "")}`;
  const width = measured || UNMEASURED;
  const narrow = width < NARROW;
  // the months that have a total come first, so an index the scale calls clipped maps back to its month
  const present = months.flatMap((m, i) => (m.totalCents === null ? [] : [i]));
  // the usual level widens the axis but does not count as a month, so a short period clips no month
  const values = present.map((i) => months[i]!.totalCents!);
  // the level's name stands in a strip above the clipped sums, so no column reaches it
  const headroom = TOP + (usual ? USUAL_STRIP : 0);
  const options = monthPlot(width, (keepHeight ? TOP : headroom) + BOTTOM, low);
  const draft = frame(width, { top: headroom, right: 4, bottom: BOTTOM, left: 48 }, options);
  const scale = (innerH: number) => linear(values, [innerH, 0], { target: monthTickTarget(innerH), clip: OUTLIER_FACTOR, include: usual ? [usual.cents] : [] });
  const y0 = scale(draft.innerH);
  const f = frame(width, { top: headroom, right: 4, bottom: BOTTOM, left: axisRoom(y0.ticks.map(monthAxisLabels(y0.ticks))) }, options);
  const y = scale(f.innerH);
  const axisLabel = monthAxisLabels(y.ticks);
  // cut only where the column runs out of the plot: the axis tops at a round tick that can lie above a clipped sum
  const capped = new Set(y.clipped.flatMap((k) => (y(values[k]!) < 0 || y(values[k]!) > f.innerH ? [present[k]!] : [])));
  const x = band(months.length, f.innerW, 0.72);
  const whole = (m: MonthColumn) => m.complete && m.month !== running;
  // a month with its paid parts shows its state in its parts, so it is never drawn as a month that is not whole
  const apart = (m: MonthColumn) => !whole(m) && !m.paid;
  // the readout names the picked month, else the last whole one, so the series are always named next to their colours
  const restingAt = resting === null ? -1 : months.findIndex((m) => m.month === resting);
  const shown = at ?? (restingAt >= 0 ? restingAt : (lastWhole(months.map((m) => whole(m) && m.totalCents !== null)) ?? months.length - 1));
  const runningAt = months.findIndex((m) => m.month === running);
  const printed = printedMonths(months.length, x.step, new Set(runningAt < 0 ? [] : [runningAt]), shown);
  const firstPrinted = Math.min(...printed);
  const yearOf = (i: number) => (printed.has(i) && i !== runningAt && (i === firstPrinted || months[i]!.month.endsWith("-01")) ? months[i]!.month.slice(0, 4) : null);
  const rows = (m: MonthColumn) =>
    m.paid && states
      ? [
          ...(["paid", "coming"] as const).flatMap((state) =>
            series.flatMap((s, k) => {
              const value = (state === "paid" ? m.paid : m.parts)![k] ?? 0;
              return value === 0 ? [] : [{ name: `${s.label}, ${states[state].toLowerCase()}`, value: answerMoney(value), swatch: <span className={`ms-key ms-s${k}${state === "coming" ? " ms-coming" : ""}`} /> }];
            }),
          ),
        ]
      : [
    ...series.map((s, k) => ({ name: s.label, value: m.totalCents === null ? "–" : answerMoney(m.parts[k] ?? 0), swatch: <span className={`ms-key ms-s${k}`} /> })),
    ...(series.length > 1 ? [{ name: t("rpt.total"), value: m.totalCents === null ? "–" : answerMoney(m.totalCents), swatch: null }] : []),
        ];
  const note = (m: MonthColumn) => (whole(m) || m.totalCents === null ? undefined : t(m.month === running ? "home.months_running" : "home.months_partial"));
  const shownMonth = months[shown];
  const compare = (m: MonthColumn) => usualComparison(tone === "income" ? "income" : "spend", m.against, tone === "income");
  const capEnd = (sum: number) => (sum > 0 ? -CAP_OVERSHOOT : f.innerH + CAP_OVERSHOOT);
  const capDir = (sum: number) => (sum > 0 ? -1 : 1);
  const places = monthNamePlaces(months.map((_, i) => x.centre(i)), x.step, f.innerW, months.map((m) => monthLabel(m.month)), printed);
  const place = (i: number) => places[i]!;
  const keys = months.map((m) => m.month);
  // the day's place in its month's band: the rule stands where the day falls between the month's first and last day
  const todayAt = today === null ? -1 : months.findIndex((m) => m.month === today.slice(0, 7));
  const todayX = todayAt < 0 ? 0 : x.step * (todayAt + (Number(today!.slice(8, 10)) - 0.5) / daysInMonth(today!.slice(0, 7)));
  return (
    <div className={`chart month-columns ms-${tone}`} ref={ref}>
      {shownMonth ? (
        <ReadoutLine
          title={monthLong(shownMonth.month)}
          parts={rows(shownMonth)}
          note={note(shownMonth)}
          compare={compare(shownMonth)}
          partialKey={months.some((m) => apart(m) && m.totalCents !== null)}
        />
      ) : (
        <div className="readout-line" />
      )}
      <svg width={f.width} height={f.height}>
        <g transform={`translate(${f.margin.left},${f.margin.top})`}>
          <g role="img" aria-label={label}>
            <defs>
              {series.map((s, k) => (
                <pattern key={s.key} id={`${hatch}-${k}`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line className={`ms-hatch ms-s${k}`} x1={0} y1={0} x2={0} y2={5} />
                </pattern>
              ))}
            </defs>
            <ValueAxis ticks={[...y.ticks]} y={y} width={f.innerW} height={f.innerH} label={axisLabel} bare />
            {todayAt >= 0 && <rect className="ms-ground" x={todayX} y={0} width={Math.max(0, f.innerW - todayX)} height={f.innerH} pointerEvents="none" />}
            {at !== null && <rect className="pick-band" x={x.step * at} y={0} width={x.step} height={f.innerH} pointerEvents="none" />}
            {months.map((m, i) => {
              // a sum above zero stacks up from zero and one below it stacks down from zero
              let up = 0;
              let down = 0;
              // paid parts first, filled, then the parts to come on top, hatched
              const segments = [...(m.paid ?? []).map((v, k) => ({ v, k, coming: false })), ...m.parts.map((v, k) => ({ v, k, coming: m.paid ? true : apart(m) }))];
              return (
                <g key={m.month} className={apart(m) ? "ms-month ms-partial" : "ms-month"}>
                  {segments.map(({ v, k, coming }) => {
                    if (v === 0) return null;
                    const from = v > 0 ? up : down;
                    const to = from + v;
                    if (v > 0) up = to;
                    else down = to;
                    const top = capY(y(Math.max(from, to)), f.innerH);
                    const bottom = capY(y(Math.min(from, to)), f.innerH);
                    return <rect key={`${series[k]!.key}${coming ? "-coming" : ""}`} className={coming ? `ms-s${k} ms-coming` : `ms-s${k}`} fill={coming ? `url(#${hatch}-${k})` : undefined} x={x.x(i)} y={top} width={x.width} height={Math.max(0, bottom - top)} />;
                  })}
                  {capped.has(i) && <CapBreak x={x.x(i)} width={x.width} end={capEnd(m.totalCents!)} dir={capDir(m.totalCents!)} />}
                  <CategoryTick x={x.centre(i)} base={f.innerH} long={printed.has(i)} />
                  {printed.has(i) && (
                    <text className={i === shown ? "ms-pick" : undefined} x={place(i).x} y={f.innerH + LABEL_Y} textAnchor={place(i).anchor}>
                      <tspan>{monthLabel(m.month)}</tspan>
                      {i === runningAt ? (
                        <tspan x={place(i).x} dy={12}>
                          {t("home.months_running")}
                        </tspan>
                      ) : (
                        yearOf(i) && (
                          <tspan x={place(i).x} dy={12}>
                            {yearOf(i)}
                          </tspan>
                        )
                      )}
                    </text>
                  )}
                </g>
              );
            })}
            {/* after every column, so a neighbour never covers a sum */}
            {months.map((m, i) => capped.has(i) && <CapSum key={m.month} x={x.centre(i)} end={capEnd(m.totalCents!)} dir={capDir(m.totalCents!)} text={capSum(m.totalCents!)} />)}
            {todayAt >= 0 && <line className="ms-today" x1={crisp(todayX)} x2={crisp(todayX)} y1={-TOP / 2} y2={f.innerH} />}
            {todayAt >= 0 && (
              <text className="ms-today-label" x={todayX + 4} y={-(TOP / 2) + 4} pointerEvents="none">
                {t("kind.now")} {dayMonth(today!)}
              </text>
            )}
            {usual && <line className="ms-usual" x1={0} x2={f.innerW} y1={crisp(capY(y(usual.cents), f.innerH))} y2={crisp(capY(y(usual.cents), f.innerH))} />}
            {usual && <UsualLabel innerW={f.innerW} above={TOP} text={narrow ? usual.short : usual.label} />}
          </g>
          <ReadoutLayer xs={months.map((_, i) => x.centre(i))} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} keys={keys} label={label} />
        </g>
      </svg>
      <LiveReadout text={at === null || !months[at] ? "" : readoutText(monthLong(months[at]!.month), [...rows(months[at]!), ...[note(months[at]!), compare(months[at]!)].flatMap((name) => (name ? [{ name, value: "" }] : []))])} />
    </div>
  );
}
