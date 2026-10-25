// Decision: which debt to pay down first, and whether the payments hold when the reference rate moves
import type { LoansReport } from "@banking/core";
import { useWidth } from "../../hooks.ts";
import { Table } from "../../components/table/Table.tsx";
import { approxText } from "../../components/Why.tsx";
import { money, monthLong } from "../../format.ts";
import { crisp } from "../draw.ts";
import { axisRoom, frame, tickTarget } from "../kit/layout.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../kit/Readout.tsx";
import { readoutText } from "../kit/readout.ts";
import { linear, points } from "../kit/scale.ts";
import { areaPath, linePath } from "../kit/path.ts";
import { moneyAxis } from "../kit/ticks.ts";
import { spreadLabels, Tip, ValueGrid } from "./parts.tsx";

type Path = LoansReport["path"];

/** The two layers bottom up: what is owed, and the interest still to come on top of it. */
const LAYERS = [
  { key: "balance", label: "Velka", color: "var(--series-1)" },
  { key: "interest", label: "Korko", color: "var(--series-4)" },
] as const;

/** "marraskuussa 2041": the month of a day in the inessive (every month's name ends in -kuu). */
const inMonth = (day: string) => {
  const [name, year] = monthLong(day.slice(0, 7)).split(" ");
  return `${name}ssa ${year}`;
};

const soft = (color: string) => `color-mix(in srgb, ${color} 60%, var(--surface))`;

/** A move of the reference rate as a line's short label; the answer and the table name its size. */
const moveLabel = (shiftBp: number) => (shiftBp > 0 ? "jos korko nousee" : "jos korko laskee");
/** A move of the reference rate in full, as the readout and the table name it: every move the report draws is one point. */
const moveName = (shiftBp: number) => `Jos viitekorko ${shiftBp > 0 ? "nousee" : "laskee"} prosenttiyksikön`;

/**
 * The loans from today to the day they are paid (`loans.path`): what is owed at the bottom and the interest still to
 * come on top, both server fields stacked by the server (`tops`), so the chart adds up nothing. The payoff date is a
 * rule with its month; each move of the reference rate is a dashed line of what is still to pay at that rate (an
 * estimate: a bank sets the real payment), labelled where the lines stand furthest apart, at the start.
 */
export function DebtPath({ path }: { path: Path }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const n = path.days.length;
  const all = [...path.tops, ...path.moves.flatMap((m) => m.tops)];
  const narrow = width < 560;
  const draft = frame(width, { top: 20, right: 16, bottom: 24, left: 48 }, { minHeight: 220, tallest: 300, ratio: 0.28 });
  const y0 = linear(all, [draft.innerH, 0], { target: tickTarget(draft.innerH) });
  const f = frame(width, { top: 20, right: 16, bottom: 24, left: axisRoom(y0.ticks.map(moneyAxis)) }, { minHeight: 220, tallest: 300, ratio: 0.28 });
  const y = linear(all, [f.innerH, 0], { target: tickTarget(f.innerH) });
  const x = points(n, f.innerW);
  const zero = path.tops.map(() => 0);
  const month = (i: number) => path.days[i]!.slice(0, 7);
  // a year a tick, every second or fifth one when the years are narrow
  const yearPx = (f.innerW / Math.max(n - 1, 1)) * 12;
  const everyYears = yearPx >= 44 ? 1 : yearPx * 2 >= 44 ? 2 : 5;
  const ticks = path.days.flatMap((d, i) => (d.slice(5, 7) === "01" && Number(d.slice(0, 4)) % everyYears === 0 ? [i] : []));
  const payoff = path.payoff === null ? -1 : path.days.findIndex((d) => d >= path.payoff!);
  // the layers named where they are thickest, at the start; the moves beside them, at a fifth of the way
  const layerLabels = narrow
    ? []
    : spreadLabels(
        [
          { key: "balance", label: LAYERS[0].label, y: (y(0) + y(path.balanceCents[0]!)) / 2 },
          { key: "interest", label: LAYERS[1].label, y: (y(path.balanceCents[0]!) + y(path.tops[0]!)) / 2 },
        ],
        14,
        f.innerH,
      );
  const fifth = Math.min(n - 1, Math.round((n - 1) / 5));
  const title = (i: number) => (i === 0 ? `${monthLong(month(i))} (nyt)` : monthLong(month(i)));
  const tipRows = (i: number) => [
    { name: "Velkaa", value: money(path.balanceCents[i]!, false), key: <span className="swatch" style={{ background: soft(LAYERS[0].color) }} /> },
    { name: "Korkoa vielä", value: money(path.interestCents[i]!, false), key: <span className="swatch" style={{ background: soft(LAYERS[1].color) }} /> },
    { name: "Yhteensä", value: money(path.tops[i]!, false) },
    ...path.moves.map((m) => ({ name: moveName(m.shiftBp), value: approxText(money(m.tops[i]!, false), true) })),
  ];
  return (
    <div className="chart" ref={ref}>
      {narrow && (
        <p className="use-key" aria-hidden="true">
          {LAYERS.map((l) => (
            <span key={l.key}>
              <i className="swatch" style={{ background: soft(l.color) }} />
              {l.label}
            </span>
          ))}
        </p>
      )}
      {width > 0 && n > 1 && (
        <svg width={f.width} height={f.height} role="img" aria-label="Velka ja maksettava korko kuukausittain siihen asti, kun lainat on maksettu">
          <g transform={`translate(${f.margin.left},${f.margin.top})`}>
            <ValueGrid y={y} innerW={f.innerW} format={moneyAxis} />
            <path d={areaPath(zero, path.balanceCents, x, y)} fill={soft(LAYERS[0].color)} stroke="var(--surface)" strokeWidth={1} />
            <path d={areaPath(path.balanceCents, path.tops, x, y)} fill={soft(LAYERS[1].color)} stroke="var(--surface)" strokeWidth={1} />
            <path className="qc-line qc-now" d={linePath(path.balanceCents, x, y)} />
            {path.moves.map((m) => (
              <g key={m.shiftBp}>
                <path className="qc-line est-line" d={linePath(m.tops, x, y)} />
                {/* a phone has no room between the lines: the readout and the table name the move */}
                {!narrow && (
                  <text className="qc-end-sub" x={x(fifth) + 4} y={y(m.tops[fifth]!) + (m.shiftBp > 0 ? -6 : 14)}>
                    {moveLabel(m.shiftBp)}
                  </text>
                )}
              </g>
            ))}
            {ticks.map((i) => (
              <text key={i} x={x(i)} y={f.innerH + 16} textAnchor="middle">
                {path.days[i]!.slice(0, 4)}
              </text>
            ))}
            {layerLabels.map((l) => (
              <text key={l.key} className="qc-end-sub" x={6} y={l.y} dy="0.32em">
                {l.label}
              </text>
            ))}
            {payoff >= 0 && (
              <g>
                <line className="kit-event-rule" x1={crisp(x(payoff))} x2={crisp(x(payoff))} y1={0} y2={f.innerH} />
                <text className="qc-note" x={x(payoff) - 6} y={10} textAnchor="end">
                  {`maksettu ${inMonth(path.payoff!)}`}
                </text>
              </g>
            )}
            {at !== null && <circle className="qc-dot" cx={x(at)} cy={y(path.tops[at]!)} r={4} pointerEvents="none" />}
            <ReadoutLayer xs={path.days.map((_, i) => x(i))} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} label="Velka ja korko kuukausittain. Nuolinäppäimillä siirryt kuukaudesta toiseen." />
          </g>
        </svg>
      )}
      {at !== null && <Tip x={x(at)} left={f.margin.left} width={f.width} title={title(at)} rows={tipRows(at)} />}
      <LiveReadout text={at === null ? "" : readoutText(title(at), tipRows(at))} />
    </div>
  );
}

/** The chart's table view: the path a year at a time from today, and each move's line. */
export function DebtPathTable({ path }: { path: Path }) {
  const rows = path.days.flatMap((_, i) => (i % 12 === 0 || i === path.days.length - 1 ? [i] : []));
  return (
    <Table
      caption="Velkapolku vuosi kerrallaan taulukkona"
      rows={rows}
      rowKey={(i) => path.days[i]!}
      columns={[
        { key: "month", label: "Kuukausi", kind: "text", rowHead: true, cell: (i) => monthLong(path.days[i]!.slice(0, 7)) },
        { key: "balance", label: "Velkaa", kind: "money", cents: (i) => path.balanceCents[i]! },
        { key: "interest", label: "Korkoa vielä", kind: "money", cents: (i) => path.interestCents[i]! },
        { key: "tops", label: "Yhteensä", kind: "money", main: true, cell: (i) => <strong>{money(path.tops[i]!, false)}</strong> },
        ...path.moves.map((m) => ({
          key: `move${m.shiftBp}`,
          label: moveName(m.shiftBp),
          kind: "money" as const,
          cell: (i: number) => approxText(money(m.tops[i]!, false), true),
        })),
      ]}
    />
  );
}
