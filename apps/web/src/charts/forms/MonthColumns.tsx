// Decision: how the period's money moved month by month, and which months fall away from the usual level
import { useWidth } from "../../hooks.ts";
import { money, monthLong } from "../../format.ts";
import { t } from "../../text.ts";
import { CategoryTick, ValueAxis } from "../Axes.tsx";
import { crisp, LABEL_Y } from "../draw.ts";
import { axisRoom, frame, tickTarget } from "../kit/layout.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../kit/Readout.tsx";
import { readoutText } from "../kit/readout.ts";
import { band, linear } from "../kit/scale.ts";
import { moneyAxis, monthTicks } from "../kit/ticks.ts";
import { Tip } from "./parts.tsx";
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
}

/** The width the first paint draws at, before the box is measured. */
const UNMEASURED = 640;
/** Room under the axis for a month's name and the line that carries its year. */
const BOTTOM = LABEL_Y + 16;

/**
 * One column a month (`months`), stacked by `series`, on one value axis that starts at 0. `usual` is the level the
 * months are read against, a dashed line across them. A month that is not whole is drawn lighter with a dashed edge and
 * says why in its readout. Pointing at a month or stepping to it with the keys reads its sums out, and a click or
 * Enter keeps that month's row in the table under the chart (`rowKey` of that table is the month). Every figure is a
 * field of the report: only the stack's total is added up here, for the axis.
 */
export function MonthColumns({
  months,
  series,
  tone,
  usual,
  running,
  label,
}: {
  months: readonly MonthColumn[];
  series: readonly MonthColumnsSeries[];
  /** The colours of the stack: spending is one series in its role colour, income is stacked in the series colours. */
  tone: "spending" | "income";
  usual: { cents: number; label: string } | null;
  /** The month that has not ended yet (`YYYY-MM`). */
  running: string | null;
  /** What the chart is, for a screen reader's name of it. */
  label: string;
}) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const width = measured || UNMEASURED;
  const values = [...months.flatMap((m) => (m.totalCents === null ? [] : [m.totalCents])), ...(usual ? [usual.cents] : [])];
  const options = { minHeight: 200, tallest: 260, ratio: 0.3 };
  const draft = frame(width, { top: 8, right: 4, bottom: BOTTOM, left: 48 }, options);
  const y0 = linear(values, [draft.innerH, 0], { target: tickTarget(draft.innerH) });
  const f = frame(width, { top: 8, right: 4, bottom: BOTTOM, left: axisRoom(y0.ticks.map(moneyAxis)) }, options);
  const y = linear(values, [f.innerH, 0], { target: tickTarget(f.innerH) });
  const x = band(months.length, f.innerW, 0.72);
  const ticks = monthTicks(
    months.map((m) => m.month),
    x.step,
    new Set(months.flatMap((m, i) => (m.month === running ? [i] : []))),
  );
  const first = ticks.findIndex((tick) => tick.printed);
  const yearOf = (i: number) => (ticks[i]!.printed && (i === first || months[i]!.month.endsWith("-01")) ? months[i]!.month.slice(0, 4) : null);
  const whole = (m: MonthColumn) => m.complete && m.month !== running;
  const rows = (m: MonthColumn) => [
    ...series.map((s, k) => ({ name: s.label, value: m.totalCents === null ? "–" : money(m.parts[k] ?? 0, false), key: <span className={`ms-key ms-s${k}`} /> })),
    ...(series.length > 1 ? [{ name: t("rpt.total"), value: m.totalCents === null ? "–" : money(m.totalCents, false) }] : []),
    ...(whole(m) || m.totalCents === null ? [] : [{ name: t(m.month === running ? "home.months_running" : "home.months_partial"), value: "" }]),
  ];
  const keys = months.map((m) => m.month);
  return (
    <div className={`chart month-columns ms-${tone}`} ref={ref}>
      {(series.length > 1 || usual) && (
        <ul className="ms-legend" aria-hidden="true">
          {series.length > 1 &&
            series.map((s, k) => (
              <li key={s.key}>
                <span className={`ms-key ms-s${k}`} />
                {s.label}
              </li>
            ))}
          {usual && (
            <li>
              <span className="ms-key-usual" />
              {usual.label}
            </li>
          )}
        </ul>
      )}
      <svg width={f.width} height={f.height}>
        <g transform={`translate(${f.margin.left},${f.margin.top})`}>
          <g role="img" aria-label={label}>
            <ValueAxis ticks={[...y.ticks]} y={y} width={f.innerW} height={f.innerH} label={moneyAxis} />
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
                    return <rect key={series[k]!.key} className={`ms-s${k}`} x={x.x(i)} y={y(Math.max(from, to))} width={x.width} height={Math.max(0, Math.abs(y(from) - y(to)))} />;
                  })}
                  <CategoryTick x={x.centre(i)} base={f.innerH} long={ticks[i]!.printed} />
                  {ticks[i]!.printed && (
                    <text className={m.month === running ? "ms-now" : undefined} x={x.centre(i)} y={f.innerH + LABEL_Y} textAnchor="middle">
                      <tspan>{ticks[i]!.text}</tspan>
                      {yearOf(i) && (
                        <tspan x={x.centre(i)} dy={12}>
                          {yearOf(i)}
                        </tspan>
                      )}
                    </text>
                  )}
                </g>
              );
            })}
            {usual && <line className="ms-usual" x1={0} x2={f.innerW} y1={crisp(y(usual.cents))} y2={crisp(y(usual.cents))} />}
          </g>
          <ReadoutLayer xs={months.map((_, i) => x.centre(i))} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} keys={keys} label={label} />
        </g>
      </svg>
      {at !== null && months[at] && <Tip x={x.centre(at)} left={f.margin.left} width={f.width} title={monthLong(months[at]!.month)} rows={rows(months[at]!)} />}
      <LiveReadout text={at === null || !months[at] ? "" : readoutText(monthLong(months[at]!.month), rows(months[at]!))} />
    </div>
  );
}
