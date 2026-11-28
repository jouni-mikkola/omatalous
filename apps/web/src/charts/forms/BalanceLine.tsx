// Decision: is the buffer growing, and what took it down when it fell
import { type BalanceReport, dayNumber, fromDayNumber, monthRange } from "@banking/core";
import { useWidth } from "../../hooks.ts";
import { dayMonth, money } from "../../format.ts";
import { t } from "../../text.ts";
import { CategoryTick, ValueAxis } from "../Axes.tsx";
import { LABEL_CHAR_W, LABEL_Y } from "../draw.ts";
import { decimate } from "../kit/decimate.ts";
import { axisRoom, frame, tickTarget } from "../kit/layout.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../kit/Readout.tsx";
import { readoutText } from "../kit/readout.ts";
import { linear, points } from "../kit/scale.ts";
import { areaPath, linePath } from "../kit/path.ts";
import { moneyAxis, monthTicks } from "../kit/ticks.ts";
import { Tip } from "./parts.tsx";
import "../../styles/charts.css";
import "../../styles/question-chart.css";

/** The width the first paint draws at, before the box is measured. */
const UNMEASURED = 640;
/** Room under the axis for a month's name. */
const BOTTOM = LABEL_Y + 4;
/** The mean length of a month in days, for the room a month's name has. */
const MONTH_DAYS = 30.4;

/**
 * The accounts added up at the end of every day of the range (`daily`), so the line dips on the day money went. The
 * lowest day (`lowest`) is a `--bad` dot on the line and today's balance is labelled at the end. The axis runs from the
 * first day the balance is known to the last, and the line holds no estimate: a stretch of unknown days breaks the
 * line, and a day known between two unknown ones is a dot. Pointing at a day or stepping to it reads its balance out,
 * and a click keeps that month's row in the table under the chart. A long range is drawn decimated (four points a pixel
 * column keep every dip). Fewer than two known days draw nothing.
 */
export function BalanceLine({ r }: { r: BalanceReport }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const width = measured || UNMEASURED;
  // the days before an account was known and after the last known one are no part of the axis
  const lead = Math.max(0, r.daily.cents.findIndex((v) => v !== null));
  const end = r.daily.cents.findLastIndex((v) => v !== null);
  const days = end < 0 ? [] : r.daily.cents.slice(lead, end + 1);
  const known = days.filter((v): v is number => v !== null);
  if (known.length < 2) return <div className="chart" ref={ref} />;
  const from = dayNumber(r.daily.from) + lead;
  const iso = (i: number) => fromDayNumber(from + i);
  const options = { minHeight: 220, tallest: 300, ratio: 0.26 };
  const draft = frame(width, { top: 12, right: 16, bottom: BOTTOM, left: 48 }, options);
  const y0 = linear(known, [draft.innerH, 0], { target: tickTarget(draft.innerH) });
  const f = frame(width, { top: 12, right: 16, bottom: BOTTOM, left: axisRoom(y0.ticks.map(moneyAxis)) }, options);
  const y = linear(known, [f.innerH, 0], { target: tickTarget(f.innerH) });
  const x = points(days.length, f.innerW);
  const keep = decimate(days, f.innerW);
  const last = days.length - 1;
  // a month's name stands at its 1st; the months that begin inside the axis are the ones with a tick
  const starts = monthRange(iso(0).slice(0, 7), iso(last).slice(0, 7))
    .map((m) => ({ month: m, i: dayNumber(`${m}-01`) - from }))
    .filter((s) => s.i >= 0);
  const ticks = monthTicks(
    starts.map((s) => s.month),
    (f.innerW / Math.max(1, days.length)) * MONTH_DAYS,
  );
  // the axis starts mid-month unless the first day is a 1st: its own day is named, unless a month's name is too close
  const startLabel = dayMonth(iso(0));
  const nextPrinted = starts.find((s, k) => s.i > 0 && ticks[k]!.printed);
  const startNamed = starts[0]?.i !== 0 && (nextPrinted === undefined || x(nextPrinted.i) - x(0) >= (startLabel.length + 6) * LABEL_CHAR_W);
  const low = r.lowest ? dayNumber(r.lowest.day) - from : -1;
  const lowAt = low >= 0 && low < days.length && days[low] != null ? low : -1;
  const title = (i: number) => dayMonth(iso(i));
  const rows = (i: number) => [{ name: t("rpt.bl_balance"), value: days[i] == null ? "–" : money(days[i]!, false) }];
  const xs = days.map((_, i) => x(i));
  const before = days.slice(Math.max(0, last - 14), last).find((v) => v != null);
  const arrivedFromAbove = before != null && days[last] != null && before > days[last]!;
  return (
    <div className="chart" ref={ref}>
      <svg width={f.width} height={f.height}>
        <g transform={`translate(${f.margin.left},${f.margin.top})`}>
          <g role="img" aria-label={t("rpt.bl_aria")}>
            <ValueAxis ticks={[...y.ticks]} y={y} width={f.innerW} height={f.innerH} label={moneyAxis} />
            {starts.map((s, k) => (
              <g key={s.month}>
                <CategoryTick x={x(s.i)} base={f.innerH} long={ticks[k]!.printed} />
                {ticks[k]!.printed && (
                  <text x={x(s.i)} y={f.innerH + LABEL_Y} textAnchor="middle">
                    {ticks[k]!.text}
                  </text>
                )}
              </g>
            ))}
            {startNamed && (
              <text x={x(0)} y={f.innerH + LABEL_Y} textAnchor="start">
                {startLabel}
              </text>
            )}
            {y.domain[0] === 0 && <path className="qc-area" d={areaPath(days.map((v) => (v === null ? null : 0)), days, x, y)} />}
            <path className="qc-line qc-now" d={linePath(days, x, y, keep)} />
            {days.map((v, i) => (v !== null && i !== last && days[i - 1] == null && days[i + 1] == null ? <circle key={i} className="qc-dot" cx={x(i)} cy={y(v)} r={3} /> : null))}
            {lowAt >= 0 && <circle className="qc-low" cx={x(lowAt)} cy={y(days[lowAt]!)} r={5} />}
            {days[last] != null && (
              <g>
                <circle className="qc-dot" cx={x(last)} cy={y(days[last]!)} r={5} />
                {/* the label sits on the side the line is not: above when the balance rose into today, below when it fell */}
                <text className="qc-note" x={x(last) - 8} y={y(days[last]!) + (arrivedFromAbove ? 18 : -10)} textAnchor="end">
                  {money(days[last]!, false)}
                </text>
              </g>
            )}
            {at !== null && days[at] != null && <circle className="qc-dot" cx={x(at)} cy={y(days[at]!)} r={4} pointerEvents="none" />}
          </g>
          <ReadoutLayer xs={xs} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} keys={days.map((_, i) => iso(i).slice(0, 7))} label={t("rpt.bl_readout")} />
        </g>
      </svg>
      {at !== null && <Tip x={x(at)} left={f.margin.left} width={f.width} title={title(at)} rows={rows(at)} />}
      <LiveReadout text={at === null ? "" : readoutText(title(at), rows(at))} />
    </div>
  );
}
