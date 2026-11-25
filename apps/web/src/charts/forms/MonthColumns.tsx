// Decision: how the period's money moved month by month, and which months fall away from the usual level
import { useWidth } from "../../hooks.ts";
import { answerMoney, monthLabel, monthLong } from "../../format.ts";
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
  /** The month has ended and the accounts cover it from its 1st; any other is drawn lighter with a dashed edge. */
  complete: boolean;
  /** One sum per series, in the order of `series`; a column stacks them from the bottom (a negative one from zero downwards). */
  parts: readonly number[];
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
/** Under this width the axis is in thousands and a clipped sum is "21 t€". */
const NARROW = 600;

/**
 * One column a month (`months`), stacked by `series`, on one value axis that starts at 0. `usual` is the level the
 * months are read against, a dashed line across them. A month that is not whole is drawn lighter with a dashed edge and
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
}) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const width = measured || UNMEASURED;
  const narrow = width < NARROW;
  // the months that have a total come first, so an index the scale calls clipped maps back to its month
  const present = months.flatMap((m, i) => (m.totalCents === null ? [] : [i]));
  // the usual level widens the axis but does not count as a month, so a short period clips no month
  const values = present.map((i) => months[i]!.totalCents!);
  // the level's name stands in a strip above the clipped sums, so no column reaches it
  const headroom = TOP + (usual ? USUAL_STRIP : 0);
  const options = monthPlot(width, headroom + BOTTOM);
  const draft = frame(width, { top: headroom, right: 4, bottom: BOTTOM, left: 48 }, options);
  const scale = (innerH: number) => linear(values, [innerH, 0], { target: monthTickTarget(innerH), clip: OUTLIER_FACTOR, include: usual ? [usual.cents] : [] });
  const y0 = scale(draft.innerH);
  const f = frame(width, { top: headroom, right: 4, bottom: BOTTOM, left: axisRoom(y0.ticks.map(monthAxisLabels(y0.ticks, y0.step, narrow))) }, options);
  const y = scale(f.innerH);
  const axisLabel = monthAxisLabels(y.ticks, y.step, narrow);
  // cut only where the column runs out of the plot: the axis tops at a round tick that can lie above a clipped sum
  const capped = new Set(y.clipped.flatMap((k) => (y(values[k]!) < 0 || y(values[k]!) > f.innerH ? [present[k]!] : [])));
  const x = band(months.length, f.innerW, 0.72);
  const whole = (m: MonthColumn) => m.complete && m.month !== running;
  // the readout names the picked month, else the last whole one, so the series are always named next to their colours
  const restingAt = resting === null ? -1 : months.findIndex((m) => m.month === resting);
  const shown = at ?? (restingAt >= 0 ? restingAt : (lastWhole(months.map((m) => whole(m) && m.totalCents !== null)) ?? months.length - 1));
  const runningAt = months.findIndex((m) => m.month === running);
  const printed = printedMonths(months.length, x.step, new Set(runningAt < 0 ? [] : [runningAt]), shown);
  const firstPrinted = Math.min(...printed);
  const yearOf = (i: number) => (printed.has(i) && i !== runningAt && (i === firstPrinted || months[i]!.month.endsWith("-01")) ? months[i]!.month.slice(0, 4) : null);
  const rows = (m: MonthColumn) => [
    ...series.map((s, k) => ({ name: s.label, value: m.totalCents === null ? "–" : answerMoney(m.parts[k] ?? 0), swatch: <span className={`ms-key ms-s${k}`} /> })),
    ...(series.length > 1 ? [{ name: t("rpt.total"), value: m.totalCents === null ? "–" : answerMoney(m.totalCents), swatch: null }] : []),
  ];
  const note = (m: MonthColumn) => (whole(m) || m.totalCents === null ? undefined : t(m.month === running ? "home.months_running" : "home.months_partial"));
  const shownMonth = months[shown];
  const compare = (m: MonthColumn) => usualComparison(tone === "income" ? "income" : "spend", m.against, tone === "income");
  const capEnd = (sum: number) => (sum > 0 ? -CAP_OVERSHOOT : f.innerH + CAP_OVERSHOOT);
  const capDir = (sum: number) => (sum > 0 ? -1 : 1);
  const places = monthNamePlaces(months.map((_, i) => x.centre(i)), x.step, f.innerW, months.map((m) => monthLabel(m.month)), printed, shown);
  const place = (i: number) => places[i]!;
  const keys = months.map((m) => m.month);
  return (
    <div className={`chart month-columns ms-${tone}`} ref={ref}>
      {shownMonth ? (
        <ReadoutLine
          title={monthLong(shownMonth.month)}
          parts={rows(shownMonth)}
          note={note(shownMonth)}
          compare={compare(shownMonth)}
        />
      ) : (
        <div className="readout-line" />
      )}
      <svg width={f.width} height={f.height}>
        <g transform={`translate(${f.margin.left},${f.margin.top})`}>
          <g role="img" aria-label={label}>
            <ValueAxis ticks={[...y.ticks]} y={y} width={f.innerW} height={f.innerH} label={axisLabel} bare />
            {at !== null && <rect className="pick-band" x={x.step * at} y={0} width={x.step} height={f.innerH} pointerEvents="none" />}
            {months.map((m, i) => {
              // a sum above zero stacks up from zero and one below it stacks down from zero
              let up = 0;
              let down = 0;
              return (
                <g key={m.month} className={whole(m) ? "ms-month" : "ms-month ms-partial"}>
                  {m.parts.map((v, k) => {
                    if (v === 0) return null;
                    const from = v > 0 ? up : down;
                    const to = from + v;
                    if (v > 0) up = to;
                    else down = to;
                    const top = capY(y(Math.max(from, to)), f.innerH);
                    const bottom = capY(y(Math.min(from, to)), f.innerH);
                    return <rect key={series[k]!.key} className={`ms-s${k}`} x={x.x(i)} y={top} width={x.width} height={Math.max(0, bottom - top)} />;
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
            {months.map((m, i) => capped.has(i) && <CapSum key={m.month} x={x.centre(i)} end={capEnd(m.totalCents!)} dir={capDir(m.totalCents!)} text={capSum(m.totalCents!, narrow)} />)}
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
