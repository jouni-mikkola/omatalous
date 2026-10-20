// Decision: how much of each month's spending is locked in before the month starts
import type { FixedVariableReport } from "@banking/core";
import { useWidth } from "../../hooks.ts";
import { money, monthLong } from "../../format.ts";
import { axisRoom, frame, tickTarget } from "../kit/layout.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../kit/Readout.tsx";
import { readoutText } from "../kit/readout.ts";
import { linear, points } from "../kit/scale.ts";
import { areaPath, linePath } from "../kit/path.ts";
import { moneyAxis, monthTicks } from "../kit/ticks.ts";
import { spreadLabels, Tip, ValueGrid } from "./parts.tsx";

/** The layers bottom up, each in a fixed slot (VD0: a part keeps its slot on every page). */
export const LAYERS = [
  { key: "fixedCents", label: "Kiinteät", color: "var(--series-1)" },
  { key: "habitCents", label: "Arkiostot", color: "var(--series-3)" },
  { key: "variableCents", label: "Satunnaiset", color: "var(--series-4)" },
  { key: "debtCents", label: "Muu velanhoito", color: "var(--series-7)" },
] as const;

/** The layers that hold money in `rows`: a layer of nothing is not drawn, so the legend and the table do not name it. */
export const layersOf = (rows: FixedVariableReport["rows"]) => LAYERS.filter((l) => rows.some((r) => r[l.key] !== 0));

const soft = (color: string) => `color-mix(in srgb, ${color} 60%, var(--surface))`;

/**
 * Spending by month as four stacked layers, each top a server field (`tops`), so the chart adds up nothing. The fixed
 * layer is the strong one at the bottom; every layer is named at the right end with its share of the newest month
 * (`shares`, rounded by the server to add up to 100), and a legend names the layers that hold money (at most four series). The running month is left out: its bills are in
 * but its everyday spending is not.
 */
export function StackedArea({ rows, complete }: { rows: FixedVariableReport["rows"]; complete: boolean[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const shown = rows.filter((_, i) => complete[i]);
  const months = shown.map((r) => r.month);
  const narrow = width < 560;
  const right = narrow ? 8 : 132;
  const all = shown.map((r) => r.tops[3]);
  const draft = frame(width, { top: 16, right, bottom: 24, left: 48 }, { minHeight: 220, tallest: 300, ratio: 0.28 });
  const y0 = linear(all, [draft.innerH, 0], { target: tickTarget(draft.innerH) });
  const f = frame(width, { top: 16, right, bottom: 24, left: axisRoom(y0.ticks.map(moneyAxis)) }, { minHeight: 220, tallest: 300, ratio: 0.28 });
  const y = linear(all, [f.innerH, 0], { target: tickTarget(f.innerH) });
  const x = points(months.length, f.innerW);
  const top = (k: number) => shown.map((r) => r.tops[k]!);
  const zero = shown.map(() => 0);
  const last = shown.length - 1;
  // each layer named at its end with its share of the month, the server's whole percents that add up to 100
  const shareText = (k: number) => {
    const share = shown[last]!.shares[k];
    return share === null || share === undefined ? "" : ` ${share} %`;
  };
  const ends = last < 0 || narrow ? [] : spreadLabels(LAYERS.map((l, k) => ({ key: l.key, label: `${l.label}${shareText(k)}`, y: (y(k ? shown[last]!.tops[k - 1]! : 0) + y(shown[last]!.tops[k]!)) / 2 })).filter((_, k) => shown[last]![LAYERS[k]!.key] > 0), 14, f.innerH);
  const ticks = monthTicks(months, f.innerW / Math.max(months.length - 1, 1));
  const title = (i: number) => monthLong(months[i]!);
  const drawn = layersOf(shown);
  const tipRows = (i: number) => [...drawn].reverse().map((l) => ({ name: l.label, value: money(shown[i]![l.key], false), key: <span className="swatch" style={{ background: soft(l.color) }} /> }));
  return (
    <div className="chart" ref={ref}>
      <p className="use-key" aria-hidden="true">
        {drawn.map((l) => (
          <span key={l.key}>
            <i className="swatch" style={{ background: soft(l.color) }} />
            {l.label}
          </span>
        ))}
      </p>
      {width > 0 && last >= 0 && (
        <svg width={f.width} height={f.height} role="img" aria-label={`Menot kuukausittain päällekkäin: ${drawn.map((l) => l.label.toLowerCase()).join(", ")}`}>
          <g transform={`translate(${f.margin.left},${f.margin.top})`}>
            <ValueGrid y={y} innerW={f.innerW} format={moneyAxis} />
            {LAYERS.map((l, k) => (
              <path key={l.key} d={areaPath(k ? top(k - 1) : zero, top(k), x, y)} fill={soft(l.color)} stroke="var(--surface)" strokeWidth={1} />
            ))}
            <path className="qc-line qc-now" d={linePath(top(0), x, y)} />
            {ticks.map((t, i) =>
              t.printed ? (
                <text key={months[i]} x={x(i)} y={f.innerH + 16} textAnchor="middle">
                  {t.text}
                </text>
              ) : null,
            )}
            {/* a phone has no room at the right: the fixed share sits in its layer */}
            {narrow && shown[last]!.shares[0] !== null && (
              <text className="qc-note" x={x(last) - 6} y={y(shown[last]!.tops[0]) + 18} textAnchor="end">
                {`kiinteät ${shown[last]!.shares[0]} %`}
              </text>
            )}
            {ends.map((e) => (
              <text key={e.key} className="qc-end-sub" x={f.innerW + 8} y={e.y} dy="0.32em">
                {e.label}
              </text>
            ))}
            <ReadoutLayer xs={months.map((_, i) => x(i))} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} label="Menot kuukausittain osina. Nuolinäppäimillä siirryt kuukaudesta toiseen." />
          </g>
        </svg>
      )}
      {at !== null && <Tip x={x(at)} left={f.margin.left} width={f.width} title={title(at)} rows={tipRows(at)} />}
      <LiveReadout text={at === null ? "" : readoutText(title(at), tipRows(at))} />
    </div>
  );
}
