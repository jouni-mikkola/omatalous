// Decision: did the cost the tip is about really change, and when: the months before and after the change side by side
/**
 * The monthly sums of what a tip measures as a step line on CE1's kit: a sum holds for its month, the change the tip is
 * about (a new price) is a marked rule with its label under the axis. One axis from zero; the readout reads a month by
 * pointer, tap and keys. The sums are the server's; the web draws them.
 */
import { monthOf } from "@banking/core";
import { date, money, monthLong } from "../../format.ts";
import { DataTable } from "../table/DataTable.tsx";
import { useWidth } from "../../hooks.ts";
import { EventMarkers, LANE_H } from "../../charts/kit/Annotations.tsx";
import { placeMarkers } from "../../charts/kit/annotate.ts";
import { axisRoom, frame, tickTarget } from "../../charts/kit/layout.ts";
import { stepPath } from "../../charts/kit/path.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../../charts/kit/Readout.tsx";
import { readoutText } from "../../charts/kit/readout.ts";
import { linear, points } from "../../charts/kit/scale.ts";
import { moneyAxis, monthTicks } from "../../charts/kit/ticks.ts";
import { Tip, ValueGrid } from "../../charts/forms/parts.tsx";

export interface StepSums {
  sums: readonly { month: string; cents: number }[];
  change: { date: string; label: string } | null;
}

/** The index of the month a change falls in, or -1 when the sums do not hold it. */
export const changeAt = ({ sums, change }: StepSums): number => (change ? sums.findIndex((s) => s.month === monthOf(change.date)) : -1);

export function MonthSteps({ sums, change, label }: StepSums & { label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const values = sums.map((s) => s.cents);
  const months = sums.map((s) => s.month);
  const marked = changeAt({ sums, change });
  const room = { top: 12, right: 12, bottom: 20 + (marked >= 0 ? LANE_H : 0) };
  const draft = frame(width, { ...room, left: 48 }, { minHeight: 160, tallest: 200, ratio: 0.22 });
  const y0 = linear(values, [draft.innerH, 0], { target: tickTarget(draft.innerH) });
  const f = frame(width, { ...room, left: axisRoom(y0.ticks.map(moneyAxis)) }, { minHeight: 160, tallest: 200, ratio: 0.22 });
  const y = linear(values, [f.innerH, 0], { target: tickTarget(f.innerH) });
  // a step holds its month: the line runs from each month's start, one more point closes the last month
  const x = points(months.length + 1, f.innerW);
  const ticks = monthTicks(months, f.innerW / Math.max(months.length, 1), new Set(marked >= 0 ? [marked] : []));
  const markers = marked >= 0 && change ? placeMarkers([{ key: "change", x: x(marked), label: `${change.label} ${date(change.date)}` }], f.innerW, 1) : [];
  const rows = (i: number) => [{ name: label, value: money(values[i]!) }, ...(i === marked && change ? [{ name: change.label, value: date(change.date) }] : [])];
  const mid = (i: number) => (x(i) + x(i + 1)) / 2;
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={f.width} height={f.height} role="img" aria-label={`${label} kuukausittain${change ? `, ${change.label.toLocaleLowerCase("fi")} ${date(change.date)}` : ""}`}>
          <g transform={`translate(${f.margin.left},${f.margin.top})`}>
            <ValueGrid y={y} innerW={f.innerW} format={moneyAxis} />
            {ticks.map((t, i) =>
              t.printed ? (
                <text key={months[i]} x={mid(i)} y={f.innerH + 14} textAnchor="middle">
                  {t.text}
                </text>
              ) : null,
            )}
            <EventMarkers markers={markers} innerH={f.innerH} base={f.innerH + 14} />
            <path className="qc-line qc-now draw" d={stepPath([...values, values[values.length - 1] ?? null], x, y)} />
            <ReadoutLayer xs={months.map((_, i) => mid(i))} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} label={`${label} kuukausittain. Nuolinäppäimillä siirryt kuukaudesta toiseen.`} />
          </g>
        </svg>
      )}
      {at !== null && <Tip x={mid(at)} left={f.margin.left} width={f.width} title={monthLong(months[at]!)} rows={rows(at)} />}
      <LiveReadout text={at === null ? "" : readoutText(monthLong(months[at]!), rows(at))} />
    </div>
  );
}

/** The step line's table view: a month a row, the change month named. */
export function MonthStepsTable({ sums, change, label }: StepSums & { label: string }) {
  const marked = changeAt({ sums, change });
  return (
    <DataTable
      id="month-steps"
      caption={`${label} kuukausittain`}
      rows={[...sums]}
      rowKey={(s) => s.month}
      phone="cards"
      columns={[
        {
          key: "month",
          label: "Kuukausi",
          kind: "text",
          rowHead: true,
          cell: (s) => `${monthLong(s.month)}${s.month === sums[marked]?.month && change ? ` (${change.label.toLocaleLowerCase("fi")} ${date(change.date)})` : ""}`,
        },
        { key: "sum", label, kind: "money", precision: "cents", main: true, cents: (s) => s.cents },
      ]}
    />
  );
}
