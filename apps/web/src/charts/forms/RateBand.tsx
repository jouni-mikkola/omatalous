// Decision: is the share of income we keep holding, or slipping below what is usual for us
import type { CashflowReport } from "@banking/core";
import { useWidth } from "../../hooks.ts";
import { monthLong, percent } from "../../format.ts";
import { crisp } from "../draw.ts";
import { axisRoom, frame, tickTarget } from "../kit/layout.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../kit/Readout.tsx";
import { readoutText } from "../kit/readout.ts";
import { linear, points } from "../kit/scale.ts";
import { linePath } from "../kit/path.ts";
import { monthTicks } from "../kit/ticks.ts";
import { Tip, ValueGrid } from "./parts.tsx";

/** "tavallisesti 9–13 %", or "tavallisesti 11 %" when the band's ends print the same. */
export function rateRange(u: NonNullable<CashflowReport["usualRate"]>): string {
  const [low, high] = [Math.round(u.low * 100), Math.round(u.high * 100)];
  return low === high ? `tavallisesti ${percent(u.mid)}` : `tavallisesti ${low}–${percent(u.high)}`;
}

/** Every complete month's rate prints inside the band as printed: the chart would have nothing to say, the answer says it. */
export function rateStaysUsual(rows: CashflowReport["rows"], u: CashflowReport["usualRate"]): boolean {
  if (!u) return false;
  const [low, high] = [Math.round(u.low * 100), Math.round(u.high * 100)];
  return rows.every((r) => !r.complete || r.savingsRate === null || (Math.round(r.savingsRate * 100) >= low && Math.round(r.savingsRate * 100) <= high));
}

/**
 * The savings rate of each complete month as a line over the usual band (the middle half of the months, `usualRate`)
 * with its median dashed. The newest month, the best and the weakest are labelled; a month under the band wears a
 * `--bad` dot, so the slip is seen with no legend. Months the range cuts have no rate and leave a gap.
 */
export function RateBand({ rows, usual }: { rows: CashflowReport["rows"]; usual: CashflowReport["usualRate"] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  // in percent points: the scale's steps are whole units, so a rate of 0.11 is drawn as 11
  const rates = rows.map((r) => (r.complete && r.savingsRate !== null ? r.savingsRate * 100 : null));
  const band = usual && { low: usual.low * 100, mid: usual.mid * 100, high: usual.high * 100 };
  const pct = (v: number) => percent(v / 100);
  const months = rows.map((r) => r.month);
  // zoomed to the band and five points either side (critic 2): a rate that moves a point must be seen to move
  const values = [...rates.filter((v): v is number => v !== null), ...(band ? [band.low - 5, band.high + 5] : [])];
  const draft = frame(width, { top: 16, right: 16, bottom: 24, left: 44 }, { minHeight: 220, tallest: 300, ratio: 0.3 });
  const y0 = linear(values, [draft.innerH, 0], { target: tickTarget(draft.innerH), zero: false });
  const f = frame(width, { top: 16, right: 16, bottom: 24, left: axisRoom(y0.ticks.map((v) => pct(v))) }, { minHeight: 220, tallest: 300, ratio: 0.3 });
  const y = linear(values, [f.innerH, 0], { target: tickTarget(f.innerH), zero: false });
  const x = points(months.length, f.innerW);
  const known = rates.flatMap((v, i) => (v === null ? [] : [i]));
  const newest = known[known.length - 1];
  // the extremes are picked, not computed: each is one of the server's rates
  const best = known.reduce<number | undefined>((b, i) => (b === undefined || rates[i]! > rates[b]! ? i : b), undefined);
  const worst = known.reduce<number | undefined>((b, i) => (b === undefined || rates[i]! < rates[b]! ? i : b), undefined);
  const labelled = [...new Set([newest, best, worst].filter((i): i is number => i !== undefined))];
  const ticks = monthTicks(months, f.innerW / Math.max(months.length - 1, 1), new Set(labelled));
  // under the band as printed: a month that reads 11 % is never marked under a band that reads 11 %
  const under = (i: number) => band !== null && Math.round(rates[i]!) < Math.round(band.low);
  const usualText = usual && rateRange(usual);
  const title = (i: number) => monthLong(months[i]!);
  const tipRows = (i: number) => [
    { name: "Säästöaste", value: rates[i] === null ? "–" : pct(rates[i]!) },
    ...(usualText ? [{ name: "Tavallinen taso", value: usualText.replace("tavallisesti ", "") }] : []),
  ];
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={f.width} height={f.height} role="img" aria-label="Säästöaste kuukausittain ja tavallinen vaihteluväli">
          <g transform={`translate(${f.margin.left},${f.margin.top})`}>
            {/* a band whose ends print the same is no band: the median alone is drawn */}
            {band && Math.round(band.low) !== Math.round(band.high) && <rect className="qc-band" x={0} width={f.innerW} y={y(band.high)} height={Math.max(0, y(band.low) - y(band.high))} />}
            <ValueGrid y={y} innerW={f.innerW} format={(v) => pct(v)} />
            {band && (
              <>
                <line className="qc-mid" x1={0} x2={f.innerW} y1={crisp(y(band.mid))} y2={crisp(y(band.mid))} />
                <text className="kit-ref-label" x={f.innerW / 2} y={y(band.high) - 12} textAnchor="middle">
                  {usualText}
                </text>
              </>
            )}
            {ticks.map((t, i) =>
              t.printed ? (
                <text key={months[i]} x={x(i)} y={f.innerH + 16} textAnchor="middle">
                  {t.text}
                </text>
              ) : null,
            )}
            <path className="qc-line qc-now draw" d={linePath(rates, x, y)} />
            {known.map((i) => (
              <circle key={months[i]} className={under(i) ? "qc-low" : "qc-dot"} cx={x(i)} cy={y(rates[i]!)} r={labelled.includes(i) ? 4.5 : 3} />
            ))}
            {labelled.map((i) => (
              <text key={`l${months[i]}`} className="qc-note" x={x(i)} y={y(rates[i]!) + (i === worst && i !== best ? 16 : -10)} textAnchor={i === newest ? "end" : "middle"}>
                {pct(rates[i]!)}
              </text>
            ))}
            <ReadoutLayer xs={months.map((_, i) => x(i))} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} label="Säästöaste kuukausittain. Nuolinäppäimillä siirryt kuukaudesta toiseen." />
          </g>
        </svg>
      )}
      {at !== null && <Tip x={x(at)} left={f.margin.left} width={f.width} title={title(at)} rows={tipRows(at)} />}
      <LiveReadout text={at === null ? "" : readoutText(title(at), tipRows(at))} />
    </div>
  );
}
