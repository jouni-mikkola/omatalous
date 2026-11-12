// Decision: is the buffer growing, and what took it down when it fell
import type { BalanceReport } from "@banking/core";
import { useWidth } from "../../hooks.ts";
import { date, dayMonth, money, monthLabel } from "../../format.ts";
import { t } from "../../text.ts";
import { crisp, LABEL_CHAR_W, LABEL_GAP } from "../draw.ts";
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
import { color } from "../../design/tokens.ts";
import { css } from "../../css.ts";

const LANES = 2;
/** The height of a label's line, for telling whether two labels touch. */
const LINE_H = 12;

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The box of a label of `text` whose baseline is at `y`, anchored at `x` as SVG anchors it. */
const boxOf = (x: number, y: number, text: string, anchor: "start" | "middle" | "end"): Box => {
  const w = text.length * LABEL_CHAR_W;
  const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
  return { x0, x1: x0 + w, y0: y - LINE_H, y1: y };
};

/** Whether two label boxes keep 4 px of air between them. */
const apart = (a: Box, b: Box) => a.x1 + 4 <= b.x0 || b.x1 + 4 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;

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
 * (`payDays`) are grey dots on the line, the one nearest the middle whose word clears the other labels and the chart's
 * edges named. Today's balance is labelled at the end. When the balance is known only from a later day, the empty part
 * before it names that day; with one known day a sentence stands in for the chart. A long range is drawn decimated
 * (four points a pixel column keep every dip).
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
  const startTexts = starts.map((s) => monthLabel(s.slice(0, 7), s.slice(5, 7) === "01"));
  const half = (k: number) => (startTexts[k]!.length * LABEL_CHAR_W) / 2;
  // a month's name stands under the days of it the chart has, and inside the chart: the running month has only a few
  const monthX = (k: number) => {
    const a = Math.max(0, indexOf(starts[k]!));
    const b = k + 1 < starts.length ? indexOf(starts[k + 1]!) - 1 : days.length - 1;
    return Math.max(half(k), Math.min(f.innerW + f.margin.right - half(k) - 1, (x(a) + x(b)) / 2));
  };
  // from the newest month back, a name is printed where it clears the one after it, so a pushed-in running month
  // (a January's name carries its year) never lands on the month before it
  const printedStarts = new Set<number>();
  for (let k = starts.length - 1, next = -1; k >= 0; k--) {
    if (next >= 0 && monthX(next) - monthX(k) < half(next) + half(k) + LABEL_GAP) continue;
    printedStarts.add(k);
    next = k;
  }
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
  const low = r.lowest && indexOf(r.lowest.day) >= 0 && days[indexOf(r.lowest.day)] != null ? r.lowest : null;
  const lowLabel = low && (() => {
    const lx = x(indexOf(low.day));
    const text = t("rpt.bl_low", { day: dayMonth(low.day), amount: money(low.cents, false) });
    // under the dot, or over it when the dot sits on the axis's labels
    const ly = y(low.cents) + 18 > f.innerH - 2 ? y(low.cents) - 10 : y(low.cents) + 18;
    const anchor = lx > f.innerW - 90 ? "end" : lx < 90 ? "start" : "middle";
    return { x: lx, y: ly, text, anchor } as const;
  })();
  const endText = last >= 0 ? money(days[last]!, false) : "";
  // the labels already set: a pay day's word is named only where it touches neither
  const taken = [...(last >= 0 ? [boxOf(x(last) - 8, y(days[last]!) - 10, endText, "end")] : []), ...(lowLabel ? [boxOf(lowLabel.x, lowLabel.y, lowLabel.text, lowLabel.anchor)] : [])];
  const title = (i: number) => (i === last ? t("rpt.bl_latest", { day: dayMonth(iso(i)) }) : dayMonth(iso(i)));
  const tipRows = (i: number) => [
    { name: t("rpt.bl_balance"), value: days[i] === null ? "–" : money(days[i]!, false), key: <span className="line-key" ref={css({ background: color["series-1"] })} /> },
    ...(pays.some((d) => indexOf(d) === i) ? [{ name: t("rpt.bl_payday"), value: "" }] : []),
    ...events.filter((e) => indexOf(e.day) === i).map((e) => ({ name: e.label, value: money(e.cents, false) })),
  ];
  // one pay day named, the one nearest the middle whose word clears the labels of today and of the lowest day and
  // stays inside the svg
  const payBox = (d: string) => boxOf(x(indexOf(d)), y(days[indexOf(d)]!) - 8, t("rpt.bl_pay"), "middle");
  const inside = (b: Box) => b.x0 >= -f.margin.left && b.x1 <= f.innerW + f.margin.right;
  const namedPay = pays
    .filter((d) => inside(payBox(d)) && taken.every((b) => apart(b, payBox(d))))
    .reduce<string | undefined>((best, d) => (best === undefined || Math.abs(indexOf(d) - days.length / 2) < Math.abs(indexOf(best) - days.length / 2) ? d : best), undefined);
  // the days before an account was known are left empty, and the empty part says from which day the line runs: in its
  // middle, else higher or lower where it touches no label of the line; the year is named when it is not the last day's
  const knownText = first > 0 ? t("rpt.bl_known_from", { day: date(iso(first), iso(days.length - 1)) }) : null;
  const knownAt =
    knownText && knownText.length * LABEL_CHAR_W + 16 <= x(first)
      ? [0.5, 0.25, 0.75].map((share) => f.innerH * share).find((ky) => {
          const box = boxOf(x(first) / 2, ky + 4, knownText, "middle");
          return [...taken, ...(namedPay ? [payBox(namedPay)] : [])].every((b) => apart(b, box));
        })
      : undefined;
  // the readout steps by day, every day one stop: the pixel of each day is its index
  const xs = days.map((_, i) => x(i));
  return (
    <div className="chart" ref={ref}>
      {width > 0 && known.length > 1 && (
        <svg width={f.width} height={f.height}>
          <g transform={`translate(${f.margin.left},${f.margin.top})`}>
            <g role="img" aria-label={t("rpt.bl_aria")}>
            <ValueGrid y={y} innerW={f.innerW} format={moneyAxis} />
            {starts.map((s, k) =>
              printedStarts.has(k) ? (
                <text key={s} x={monthX(k)} y={f.innerH + 16} textAnchor="middle">
                  {startTexts[k]}
                </text>
              ) : null,
            )}
            {knownText && knownAt !== undefined && (
              <text className="qc-end-sub bl-known-from" x={x(first) / 2} y={knownAt} dy="0.32em" textAnchor="middle">
                {knownText}
              </text>
            )}
            {y.domain[0] === 0 && first >= 0 && <path className="qc-area" d={`${linePath(days, x, y, keep)}L${x(last).toFixed(1)},${y(0)}L${x(first).toFixed(1)},${y(0)}Z`} />}
            <path className="qc-line qc-now draw" d={linePath(days, x, y, keep)} />
            {pays.map((d) => (
              <circle key={d} className="qc-dot-then" cx={x(indexOf(d))} cy={y(days[indexOf(d)]!)} r={3} />
            ))}
            {namedPay && (
              <text className="qc-end-sub" x={x(indexOf(namedPay))} y={y(days[indexOf(namedPay)]!) - 8} textAnchor="middle">
                {t("rpt.bl_pay")}
              </text>
            )}
            {markers.map((m, k) => {
              const e = ticked[k]!;
              return (
                <g key={m.key}>
                  {/* the step the purchase took: from the day before's balance to the day's */}
                  <line className="qc-line qc-bad" x1={crisp(m.x)} x2={crisp(m.x)} y1={y(e.step!.beforeCents)} y2={y(e.step!.afterCents)} />
                  <line className="kit-event-rule" x1={crisp(m.x)} x2={crisp(m.x)} y1={y(e.step!.afterCents)} y2={f.innerH} />
                  {m.lane >= 0 && (
                    <text className="kit-event-label" x={m.x} y={f.innerH + 20 + LANE_H * (m.lane + 1)} textAnchor={m.anchor}>
                      {m.label}
                    </text>
                  )}
                </g>
              );
            })}
            {low && lowLabel && (
              <g>
                <circle className="qc-low" cx={lowLabel.x} cy={y(low.cents)} r={5} />
                <text className="qc-note" x={lowLabel.x} y={lowLabel.y} textAnchor={lowLabel.anchor}>
                  {lowLabel.text}
                </text>
              </g>
            )}
            {last >= 0 && (
              <g>
                <circle className="qc-dot" cx={x(last)} cy={y(days[last]!)} r={5} />
                <text className="qc-note" x={x(last) - 8} y={y(days[last]!) - 10} textAnchor="end">
                  {endText}
                </text>
              </g>
            )}
            {at !== null && days[at] != null && <circle className="qc-dot" cx={x(at)} cy={y(days[at]!)} r={4} pointerEvents="none" />}
            </g>
            <ReadoutLayer xs={xs} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} keys={days.map((_, i) => iso(i).slice(0, 7))} label={t("rpt.bl_readout")} />
          </g>
        </svg>
      )}
      {/* one known day draws no line: the day's balance is the panel's figure, and this says why the chart is not there */}
      {known.length === 1 && <p className="qc-a">{t("rpt.bl_one_day")}</p>}
      {at !== null && <Tip x={x(at)} left={f.margin.left} width={f.width} title={title(at)} rows={tipRows(at)} />}
      <LiveReadout text={at === null ? "" : readoutText(title(at), tipRows(at))} />
    </div>
  );
}
