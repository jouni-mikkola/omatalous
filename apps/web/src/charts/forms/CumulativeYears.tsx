// Decision: is this year leaving more over than the last one did, by the same point of the year
import { Table } from "../../components/table/Table.tsx";
import { monthEnd, type YearToDate } from "@banking/core";
import { approxText, Why } from "../../components/Why.tsx";
import { useWidth } from "../../hooks.ts";
import type { Scope } from "../../types.ts";
import { money, monthLabel, monthLong, signedMoney } from "../../format.ts";
import { crisp } from "../draw.ts";
import { axisRoom, frame, tickTarget } from "../kit/layout.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../kit/Readout.tsx";
import { readoutText } from "../kit/readout.ts";
import { linear, points } from "../kit/scale.ts";
import { linePath } from "../kit/path.ts";
import { moneyAxis } from "../kit/ticks.ts";
import { monthGenitive } from "./BalanceLine.tsx";
import { spreadLabels, Tip, ValueGrid } from "./parts.tsx";

const MONTHS = 12;

/**
 * Tulos added up from January, this year as the strong line and last year in grey, both labelled at their ends. The
 * running month is dashed (its salary may not be in), and the server's like-for-like gap is drawn as a bracket at the
 * newest month both lines have. Every figure is a field of `cashflow.yearToDate`.
 */
export function CumulativeYears({ ytd }: { ytd: YearToDate }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const { year, current, previous, partialMonth, compared } = ytd;
  const months = Array.from({ length: MONTHS }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const values = [...current, ...previous].filter((v): v is number => v !== null);
  const narrow = width < 560;
  const right = narrow ? 72 : 112;
  const draft = frame(width, { top: 12, right, bottom: 24, left: 48 }, { minHeight: 220, tallest: 300, ratio: 0.3 });
  const y0 = linear(values, [draft.innerH, 0], { target: tickTarget(draft.innerH) });
  const f = frame(width, { top: 12, right, bottom: 24, left: axisRoom(y0.ticks.map(moneyAxis)) }, { minHeight: 220, tallest: 300, ratio: 0.3 });
  const y = linear(values, [f.innerH, 0], { target: tickTarget(f.innerH) });
  const x = points(MONTHS, f.innerW);
  const lastNow = current.findLastIndex((v) => v !== null);
  const lastThen = previous.findLastIndex((v) => v !== null);
  // the settled part solid, the running month's step dashed: an estimate is dashed (VD0)
  const solid = current.map((v, i) => (partialMonth !== null && i >= partialMonth ? null : v));
  const est = current.map((v, i) => (partialMonth !== null && (i === partialMonth || i === partialMonth - 1) ? v : null));
  // every month when there is room, else every other one from January: a regular axis reads faster than a packed one
  const pitch = f.innerW / (MONTHS - 1);
  const ticks = months.map((m, i) => ({ text: monthLabel(m), printed: pitch >= 34 || i % 2 === 0 }));
  const ends = spreadLabels(
    [
      ...(lastNow >= 0 ? [{ key: "now", y: y(current[lastNow]!), year: String(year), value: current[lastNow]!, x: x(lastNow), est: lastNow === partialMonth }] : []),
      ...(lastThen >= 0 ? [{ key: "then", y: y(previous[lastThen]!), year: String(year - 1), value: previous[lastThen]!, x: x(lastThen), est: false }] : []),
    ],
    30,
    f.innerH,
  );
  const tipRows = (i: number) => [
    ...(current[i] != null ? [{ name: String(year), value: approxText(money(current[i]!, false), i === partialMonth), key: <span className="line-key" style={{ background: "var(--series-1)" }} /> }] : []),
    ...(previous[i] != null ? [{ name: String(year - 1), value: money(previous[i]!, false), key: <span className="line-key" style={{ background: "var(--series-avg)" }} /> }] : []),
  ];
  const title = (i: number) => `${monthLong(months[i]!)} loppuun`;
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={f.width} height={f.height} role="img" aria-label={`Tulos tammikuusta alkaen, ${year} ja ${year - 1}`}>
          <g transform={`translate(${f.margin.left},${f.margin.top})`}>
            <ValueGrid y={y} innerW={f.innerW} format={moneyAxis} />
            {ticks.map((t, i) =>
              t.printed ? (
                <text key={months[i]} x={x(i)} y={f.innerH + 16} textAnchor="middle">
                  {t.text}
                </text>
              ) : null,
            )}
            <path className="qc-line qc-then" d={linePath(previous, x, y)} />
            <path className="qc-line qc-now draw" d={linePath(solid, x, y)} />
            {partialMonth !== null && <path className="qc-line est-line" d={linePath(est, x, y)} />}
            {compared && current[compared.month] != null && previous[compared.month] != null && (
              <g>
                <line className="qc-gap" x1={crisp(x(compared.month))} x2={crisp(x(compared.month))} y1={y(current[compared.month]!)} y2={y(previous[compared.month]!)} />
                <text className="qc-note" x={x(compared.month) - 6} y={(y(current[compared.month]!) + y(previous[compared.month]!)) / 2} dy="0.32em" textAnchor="end">
                  {signedMoney(compared.cents)}
                </text>
              </g>
            )}
            {lastThen >= 0 && <circle className="qc-dot-then" cx={x(lastThen)} cy={y(previous[lastThen]!)} r={4} />}
            {lastNow >= 0 && <circle className="qc-dot" cx={x(lastNow)} cy={y(current[lastNow]!)} r={4.5} />}
            {ends.map((e) => (
              <text key={e.key} x={e.x + 10} y={e.y - 2}>
                <tspan className="qc-end">{approxText(money(e.value, false), e.est)}</tspan>
                <tspan className="qc-end-sub" x={e.x + 10} dy="1.25em">
                  {e.key === "now" && e.est ? `${e.year}, ${monthLabel(months[lastNow]!)} kesken` : e.year}
                </tspan>
              </text>
            ))}
            {at !== null && <circle className="qc-dot" cx={x(at)} cy={y(current[at] ?? previous[at] ?? 0)} r={4} pointerEvents="none" />}
            <ReadoutLayer xs={months.map((_, i) => x(i))} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} label={`Tulos kuukausittain, ${year} ja ${year - 1}. Nuolinäppäimillä siirryt kuukaudesta toiseen.`} />
          </g>
        </svg>
      )}
      {at !== null && <Tip x={x(at)} left={f.margin.left} width={f.width} title={title(at)} rows={tipRows(at)} />}
      <LiveReadout text={at === null ? "" : readoutText(title(at), tipRows(at))} />
    </div>
  );
}

/**
 * The table view: the same two lines month by month, each figure the door to its rows from 1 January. The running
 * month's row is an estimate: muted, its figure with "≈" (VT5's mark).
 */
export function CumulativeYearsTable({ ytd, scope }: { ytd: YearToDate; scope: Scope }) {
  const { year, current, previous, partialMonth } = ytd;
  return (
    <Table
      caption="Tulos kuukauden loppuun, kaksi vuotta"
      rows={current.flatMap((v, i) => (v === null && previous[i] === null ? [] : [{ i, v, w: previous[i] ?? null }]))}
      rowKey={(x) => `${year}-${x.i}`}
      columns={[
        { key: "month", label: "Kuukauden loppuun", kind: "text", rowHead: true, className: (x) => (x.i === partialMonth ? "est-row" : undefined), cell: (x) => monthLong(`${year}-${String(x.i + 1).padStart(2, "0")}`).split(" ")[0] },
        { key: "current", label: String(year), kind: "money", className: (x) => (x.i === partialMonth ? "est-row" : undefined), cell: (x) => (x.v === null ? "–" : <Door year={year} month={x.i} cents={x.v} scope={scope} estimate={x.i === partialMonth} />) },
        { key: "previous", label: String(year - 1), kind: "money", className: (x) => (x.i === partialMonth ? "est-row" : undefined), cell: (x) => (x.w === null ? "–" : <Door year={year - 1} month={x.i} cents={x.w} scope={scope} estimate={false} />) },
      ]}
    />
  );
}

/** One figure of the table as the door to its rows: Tulos from 1 January to the end of the month. */
function Door({ year, month, cents, scope, estimate }: { year: number; month: number; cents: number; scope: Scope; estimate: boolean }) {
  const label = `${year}-${String(month + 1).padStart(2, "0")}`;
  const text = money(cents, false);
  return (
    <Why figure="yli_jai.month" title={`Tulos 1.1. alkaen ${monthGenitive(label)} loppuun`} range={{ from: `${year}-01-01`, to: monthEnd(label) }} scope={scope} text={text} estimate={estimate ? "approx" : undefined}>
      {text}
    </Why>
  );
}
