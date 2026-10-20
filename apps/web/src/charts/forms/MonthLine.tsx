// Decision: is a monthly figure holding at its usual level, and which month broke from it
import { approxText } from "../../components/Why.tsx";
import { useWidth } from "../../hooks.ts";
import { ChartTable } from "../../components/table/ChartTable.tsx";
import { money, monthLong } from "../../format.ts";
import { crisp } from "../draw.ts";
import { axisRoom, frame, tickTarget } from "../kit/layout.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../kit/Readout.tsx";
import { readoutText } from "../kit/readout.ts";
import { linear, points } from "../kit/scale.ts";
import { linePath } from "../kit/path.ts";
import { moneyAxis, monthTicks } from "../kit/ticks.ts";
import { Tip, ValueGrid } from "./parts.tsx";

export interface MonthMark {
  /** Index of the month in `months`. */
  at: number;
  label: string;
}

/**
 * A month line against its usual level (a server figure, dashed and labelled at the right), each month a dot, the marked
 * months labelled at their dot (the weakest month, a windfall). A month that has not ended is dashed and its figure wears
 * "≈". The axis hugs the values with the usual inside it, so a month 5 % off is seen to be off.
 */
export function MonthLine({ months, values, complete, usual, usualLabel, marks, label }: { months: string[]; values: (number | null)[]; complete: boolean[]; usual: number | null; usualLabel: string; marks: MonthMark[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const known = values.filter((v): v is number => v !== null);
  // the axis hugs the values, but never closer than a sixth of the usual level: a 10 % month must not fill the plot
  const spread = [...known, ...(usual !== null ? [usual, Math.round(usual * 0.85), Math.round(usual * 1.15)] : [])];
  const draft = frame(width, { top: 20, right: 16, bottom: 24, left: 48 }, { minHeight: 200, tallest: 260, ratio: 0.24 });
  const y0 = linear(spread, [draft.innerH, 0], { target: tickTarget(draft.innerH), zero: false });
  const f = frame(width, { top: 20, right: 16, bottom: 24, left: axisRoom(y0.ticks.map(moneyAxis)) }, { minHeight: 200, tallest: 260, ratio: 0.24 });
  const y = linear(spread, [f.innerH, 0], { target: tickTarget(f.innerH), zero: false });
  const x = points(months.length, f.innerW);
  const last = values.findLastIndex((v) => v !== null);
  const settled = values.map((v, i) => (complete[i] ? v : null));
  const running = values.map((v, i) => (!complete[i] || (i < months.length - 1 && !complete[i + 1]) ? v : null));
  const ticks = monthTicks(months, f.innerW / Math.max(months.length - 1, 1), new Set(marks.map((m) => m.at)));
  const marked = new Map(marks.map((m) => [m.at, m.label]));
  const figure = (i: number) => approxText(money(values[i]!, false), !complete[i]);
  const title = (i: number) => monthLong(months[i]!);
  const tipRows = (i: number) => [
    { name: label, value: values[i] === null ? "–" : figure(i) },
    ...(usual !== null ? [{ name: "Tavallisesti", value: money(usual, false) }] : []),
    ...(marked.has(i) ? [{ name: marked.get(i)!, value: "" }] : []),
  ];
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={f.width} height={f.height} role="img" aria-label={`${label} kuukausittain ja tavallinen taso`}>
          <g transform={`translate(${f.margin.left},${f.margin.top})`}>
            <ValueGrid y={y} innerW={f.innerW} format={moneyAxis} />
            {usual !== null && (
              <g>
                <line className="qc-mid" x1={0} x2={f.innerW} y1={crisp(y(usual))} y2={crisp(y(usual))} />
                <text className="kit-ref-label" x={4} y={y(usual) + 14}>
                  {usualLabel}
                </text>
              </g>
            )}
            {ticks.map((t, i) =>
              t.printed ? (
                <text key={months[i]} x={x(i)} y={f.innerH + 16} textAnchor="middle">
                  {t.text}
                </text>
              ) : null,
            )}
            <path className="qc-line qc-now draw" d={linePath(settled, x, y)} />
            <path className="qc-line est-line" d={linePath(running, x, y)} />
            {values.map((v, i) =>
              v === null ? null : <circle key={months[i]} className={marked.has(i) ? "qc-low" : "qc-dot"} cx={x(i)} cy={y(v)} r={marked.has(i) || i === last ? 4.5 : 3} />,
            )}
            {[...marked].map(([i, text]) =>
              values[i] == null ? null : (
                <text key={`m${i}`} className="qc-note" x={x(i)} y={y(values[i]!) + (values[i]! < (usual ?? Infinity) ? 18 : -10)} textAnchor={i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"}>
                  {`${text} ${figure(i)}`}
                </text>
              ),
            )}
            {last >= 0 && !marked.has(last) && (
              <text className="qc-note" x={x(last)} y={y(values[last]!) - 10} textAnchor="end">
                {figure(last)}
              </text>
            )}
            <ReadoutLayer xs={months.map((_, i) => x(i))} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} label={`${label} kuukausittain. Nuolinäppäimillä siirryt kuukaudesta toiseen.`} />
          </g>
        </svg>
      )}
      {at !== null && <Tip x={x(at)} left={f.margin.left} width={f.width} title={title(at)} rows={tipRows(at)} />}
      <LiveReadout text={at === null ? "" : readoutText(title(at), tipRows(at))} />
    </div>
  );
}

/** The month line's table view. */
export function MonthLineTable({ months, values, complete, label }: { months: string[]; values: (number | null)[]; complete: boolean[]; label: string }) {
  return (
    <ChartTable
      id={`monthline-${label}`}
      xLabel="Kuukausi"
      series={[{ key: "v", label }]}
      rows={months.map((m, i) => ({ key: m, label: `${monthLong(m)}${complete[i] ? "" : " (vajaa)"}`, values: [values[i] ?? null] }))}
    />
  );
}
