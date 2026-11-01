// Decision: how far the net worth can fall or grow over the years, so how much room the household has to plan on
import type { ForecastMonth } from "@banking/core";
import { useWidth } from "../../hooks.ts";
import { money, monthLong, moneyTick } from "../../format.ts";
import { t } from "../../text.ts";
import { axisRoom, frame, tickTarget } from "../kit/layout.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../kit/Readout.tsx";
import { areaPath, linePath } from "../kit/path.ts";
import { readoutText } from "../kit/readout.ts";
import { linear, points } from "../kit/scale.ts";
import { evenMonthTicks } from "../kit/ticks.ts";
import { Tip, ValueGrid } from "./parts.tsx";

/**
 * The expected course of the net worth (or, without a balance, of the savings built up) as one line over the range
 * of the simulation as a band, month by month for the years ahead. One value axis; the legend is in the section and the
 * rows stand in the table beside it.
 */
export function ForecastBand({ months, worth }: { months: readonly ForecastMonth[]; worth: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const rows = months.map((m) => (worth ? m.netWorth! : m.total));
  const low = rows.map((r) => r.lowCents);
  const mid = rows.map((r) => r.midCents);
  const high = rows.map((r) => r.highCents);
  const labels = months.map((m) => m.month);
  const values = [...low, ...high];
  const draft = frame(width, { top: 16, right: 16, bottom: 38, left: 44 }, { minHeight: 220, tallest: 320, ratio: 0.32 });
  const y0 = linear(values, [draft.innerH, 0], { target: tickTarget(draft.innerH), zero: false });
  const f = frame(width, { top: 16, right: 16, bottom: 38, left: axisRoom(y0.ticks.map((v) => moneyTick(v))) }, { minHeight: 220, tallest: 320, ratio: 0.32 });
  const y = linear(values, [f.innerH, 0], { target: tickTarget(f.innerH), zero: false });
  const x = points(months.length, f.innerW);
  // one even step over five years: a label forced at the last month, or fitted by its width, breaks the cadence
  const ticks = evenMonthTicks(labels, f.innerW / Math.max(months.length - 1, 1));
  const title = (i: number) => monthLong(labels[i]!);
  const tipRows = (i: number) => [
    { name: t("forecast.legend_mid"), value: money(mid[i]!, false) },
    { name: t("forecast.col_low"), value: money(low[i]!, false) },
    { name: t("forecast.col_high"), value: money(high[i]!, false) },
  ];
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={f.width} height={f.height}>
          <g transform={`translate(${f.margin.left},${f.margin.top})`}>
            <g role="img" aria-label={t("forecast.chart_label")}>
            <ValueGrid y={y} innerW={f.innerW} format={moneyTick} />
            <path className="qc-band" d={areaPath(low, high, x, y)} />
            <path className="qc-line qc-now draw" d={linePath(mid, x, y)} />
            {ticks.map((tick, i) =>
              tick.printed ? (
                <text key={labels[i]} x={x(i)} y={f.innerH + 16} textAnchor="middle">
                  {tick.text}
                  {tick.year && (
                    <tspan x={x(i)} dy={14}>
                      {tick.year}
                    </tspan>
                  )}
                </text>
              ) : null,
            )}
            </g>
            <ReadoutLayer xs={labels.map((_, i) => x(i))} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} keys={labels} label={t("forecast.chart_label")} />
          </g>
        </svg>
      )}
      {at !== null && <Tip x={x(at)} left={f.margin.left} width={f.width} title={title(at)} rows={tipRows(at)} />}
      <LiveReadout text={at === null ? "" : readoutText(title(at), tipRows(at))} />
    </div>
  );
}
