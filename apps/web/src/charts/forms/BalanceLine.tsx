// Decision: is the buffer growing, and what took it down when it fell
import type { BalanceReport } from "@banking/core";
import { useWidth } from "../../hooks.ts";
import { dayMonth, money, monthLabel, monthLong } from "../../format.ts";
import { crisp } from "../draw.ts";
import { decimate } from "../kit/decimate.ts";
import { LANE_H } from "../kit/Annotations.tsx";
import { placeMarkers } from "../kit/annotate.ts";
import { axisRoom, frame, tickTarget } from "../kit/layout.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../kit/Readout.tsx";
import { readoutText } from "../kit/readout.ts";
import { dayNumber, isoDay, linear, monthStarts, points } from "../kit/scale.ts";
import { linePath } from "../kit/path.ts";
import { moneyAxis } from "../kit/ticks.ts";
import { Tip, ValueGrid } from "./parts.tsx";

const LANES = 2;

/** "2026-09" → "syyskuun 2026": the month name in the genitive, as "lopussa" asks. */
export const monthGenitive = (m: string) => {
  const [name, year] = monthLong(m).split(" ");
  return `${name}n ${year}`;
};

/** A payee short enough for a lane: its first word, cut at twelve letters. */
const short = (label: string) => {
  const word = label.split(/\s+/)[0] ?? label;
  return word.length > 12 ? `${word.slice(0, 11)}…` : word;
};

/**
 * The accounts added up at the end of every day of the range (`daily`), so the line dips on the day money went: the
 * lowest day (`lowest`) is a `--bad` dot on the line with its date and figure, each large purchase (`events`) whose day
 * stepped the line down by it a `--bad` tick over that step (`step`, the day before to the day) with its payee and sum
 * in a lane under the month names; one the same day's pay hid, or one beyond the lanes, is in the readout. Pay days
 * (`payDays`) are grey dots on the line, the one nearest the middle named. Today's balance is labelled at the end. A long range is drawn decimated (four points a pixel column keep every dip).
 */
export function BalanceLine({ r }: { r: BalanceReport }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const days = r.daily.cents;
  const from = dayNumber(r.daily.from);
  const iso = (i: number) => isoDay(from + i);
  const known = days.filter((v): v is number => v !== null);
  const bottom = 24 + (r.events.length ? LANE_H * LANES + 4 : 0);
  const draft = frame(width, { top: 20, right: 16, bottom, left: 48 }, { minHeight: 260, tallest: 340, ratio: 0.28 });
  const y0 = linear(known, [draft.innerH, 0], { target: tickTarget(draft.innerH) });
  const f = frame(width, { top: 20, right: 16, bottom, left: axisRoom(y0.ticks.map(moneyAxis)) }, { minHeight: 260, tallest: 340, ratio: 0.28 });
  const y = linear(known, [f.innerH, 0], { target: tickTarget(f.innerH) });
  const x = points(days.length, f.innerW);
  const keep = decimate(days, f.innerW);
  const indexOf = (day: string) => dayNumber(day) - from;
  const last = days.findLastIndex((v) => v !== null);
  const first = days.findIndex((v) => v !== null);
  const starts = monthStarts(r.daily.from, iso(days.length - 1));
  const every = f.innerW / Math.max(starts.length, 1) < 44 ? 2 : 1;
  const inDays = (day: string) => indexOf(day) >= 0 && indexOf(day) < days.length && days[indexOf(day)] !== null;
  const events = r.events.filter((e) => inDays(e.day));
  // a tick only where the line steps down by the purchase (critic round 2); the rest are told in the readout
  const ticked = events.filter((e) => e.step !== null);
  const pays = r.payDays.filter(inDays);
  const markers = placeMarkers(
    ticked.map((e) => ({ key: `${e.day}${e.label}`, x: x(indexOf(e.day)), label: `${short(e.label)} ${money(e.cents, false)}` })),
    f.innerW,
    LANES,
  );
  const low = r.lowest && indexOf(r.lowest.day) >= 0 ? r.lowest : null;
  const title = (i: number) => (i === last ? `${dayMonth(iso(i))} (viimeisin)` : dayMonth(iso(i)));
  const tipRows = (i: number) => [
    { name: "Tilit yhteensä", value: days[i] === null ? "–" : money(days[i]!, false), key: <span className="line-key" style={{ background: "var(--series-1)" }} /> },
    ...(pays.some((d) => indexOf(d) === i) ? [{ name: "Palkkapäivä", value: "" }] : []),
    ...events.filter((e) => indexOf(e.day) === i).map((e) => ({ name: e.label, value: money(e.cents, false) })),
  ];
  // one pay day named, the one nearest the middle: the ends carry today's balance and often the lowest day
  const namedPay = pays.reduce<string | undefined>((best, d) => (best === undefined || Math.abs(indexOf(d) - days.length / 2) < Math.abs(indexOf(best) - days.length / 2) ? d : best), undefined);
  // the readout steps by day, every day one stop: the pixel of each day is its index
  const xs = days.map((_, i) => x(i));
  return (
    <div className="chart" ref={ref}>
      {width > 0 && known.length > 1 && (
        <svg width={f.width} height={f.height} role="img" aria-label="Tilien saldo päivittäin, alin päivä ja suuret ostot">
          <g transform={`translate(${f.margin.left},${f.margin.top})`}>
            <ValueGrid y={y} innerW={f.innerW} format={moneyAxis} />
            {starts.map((s, k) =>
              k % every === 0 ? (
                <text key={s} x={x(Math.min(days.length - 1, indexOf(s) + 14))} y={f.innerH + 16} textAnchor="middle">
                  {monthLabel(s.slice(0, 7), s.slice(5, 7) === "01")}
                </text>
              ) : null,
            )}
            {y.domain[0] === 0 && first >= 0 && <path className="qc-area" d={`${linePath(days, x, y, keep)}L${x(last).toFixed(1)},${y(0)}L${x(first).toFixed(1)},${y(0)}Z`} />}
            <path className="qc-line qc-now draw" d={linePath(days, x, y, keep)} />
            {pays.map((d) => (
              <circle key={d} className="qc-dot-then" cx={x(indexOf(d))} cy={y(days[indexOf(d)]!)} r={3} />
            ))}
            {namedPay && (
              <text className="qc-end-sub" x={x(indexOf(namedPay))} y={y(days[indexOf(namedPay)]!) - 8} textAnchor="middle">
                palkka
              </text>
            )}
            {markers.map((m, k) => {
              const e = ticked[k]!;
              return (
                <g key={m.key}>
                  {/* the step the purchase took: from the day before's balance to the day's */}
                  <line className="qc-line" style={{ stroke: "var(--bad)" }} x1={crisp(m.x)} x2={crisp(m.x)} y1={y(e.step!.beforeCents)} y2={y(e.step!.afterCents)} />
                  <line className="kit-event-rule" x1={crisp(m.x)} x2={crisp(m.x)} y1={y(e.step!.afterCents)} y2={f.innerH} />
                  {m.lane >= 0 && (
                    <text className="kit-event-label" x={m.x} y={f.innerH + 20 + LANE_H * (m.lane + 1)} textAnchor={m.anchor}>
                      {m.label}
                    </text>
                  )}
                </g>
              );
            })}
            {low && days[indexOf(low.day)] != null && (
              <g>
                <circle className="qc-low" cx={x(indexOf(low.day))} cy={y(low.cents)} r={5} />
                {/* under the dot, or over it when the dot sits on the axis's labels */}
                <text className="qc-note" x={x(indexOf(low.day))} y={y(low.cents) + 18 > f.innerH - 2 ? y(low.cents) - 10 : y(low.cents) + 18} textAnchor={x(indexOf(low.day)) > f.innerW - 90 ? "end" : x(indexOf(low.day)) < 90 ? "start" : "middle"}>
                  {`alin ${dayMonth(low.day)} ${money(low.cents, false)}`}
                </text>
              </g>
            )}
            {last >= 0 && (
              <g>
                <circle className="qc-dot" cx={x(last)} cy={y(days[last]!)} r={5} />
                <text className="qc-note" x={x(last) - 8} y={y(days[last]!) - 10} textAnchor="end">
                  {money(days[last]!, false)}
                </text>
              </g>
            )}
            {at !== null && days[at] != null && <circle className="qc-dot" cx={x(at)} cy={y(days[at]!)} r={4} pointerEvents="none" />}
            <ReadoutLayer xs={xs} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} label="Tilien saldo päivittäin. Nuolinäppäimillä siirryt päivästä toiseen." />
          </g>
        </svg>
      )}
      {at !== null && <Tip x={x(at)} left={f.margin.left} width={f.width} title={title(at)} rows={tipRows(at)} />}
      <LiveReadout text={at === null ? "" : readoutText(title(at), tipRows(at))} />
    </div>
  );
}
