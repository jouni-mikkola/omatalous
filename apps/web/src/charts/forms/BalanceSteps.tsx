// Decision: on which day before the payday the money is tightest, and which bill takes it there
import { useId } from "react";
import { addDays, moneyEnds } from "@banking/core";
import { useWidth } from "../../hooks.ts";
import { answerMoney, dayMonth, signedMoney } from "../../format.ts";
import { rangeText } from "../../format-range.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { CategoryTick, ValueAxis } from "../Axes.tsx";
import { crisp, LABEL_CHAR_W, LABEL_Y } from "../draw.ts";
import { axisRoom, frame, tickTarget } from "../kit/layout.ts";
import { LiveReadout, ReadoutLayer, ReadoutLine, useReadout } from "../kit/Readout.tsx";
import { readoutText } from "../kit/readout.ts";
import { linear, time } from "../kit/scale.ts";
import { areaPath, linePath } from "../kit/path.ts";
import { moneyAxis } from "../kit/ticks.ts";
import "../../styles/charts.css";
import "../../styles/question-chart.css";
import "../../styles/estimate.css";

export type KnownLowPoint = Extract<NonNullable<DashboardData["home"]["lowPoint"]>, { known: true }>;
export type PastPeriods = NonNullable<DashboardData["home"]["pastPeriods"]>;
type Corner = KnownLowPoint["line"][number];
type Step = KnownLowPoint["steps"][number];

/** The width the first paint draws at, before the box is measured. */
const UNMEASURED = 640;
/** Under this width the labels take their short form. */
const NARROW = 480;
/** Room under the axis for a day's label. */
const BOTTOM = LABEL_Y + 4;
/** The room a day's label takes on the axis, in px. */
const DAY_LABEL_W = 48;
/** How many payments are named on a phone; the rest are dots, and the readout and the table hold them. */
const NAMED_STEPS = 2;
/** A payment's name and sum are set at 14 px, wider than the 12 px of the axes. */
const BILL_CHAR_W = 7.9;
/** The room a payment's name takes above or below its dot, in px, and the dots' radii. */
const BILL_H = 18;
const BILL_DOT = 5;
const BREAK_DOT = 8;

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The name of a payment or a pay, with its estimate said. */
export function stepName(s: Step): string {
  return s.estimate ? t("home.days_estimate", { payee: s.payee }) : s.payee;
}

/**
 * The balance of the everyday accounts from today to the last day core's `lowPoint` looks at, as a line of its corners
 * (`line`): a bill is a step down, a pay a step up and the expected everyday spending the slope between days, with the
 * range of that spending (`lowCents`–`highCents`) as the shaded band. The lowest corner, the figure of `lowPoint`, has a
 * ring and its sum; the payday is a rule with its date; the two biggest payments are named at their step. Every figure
 * is core's; nothing is added up here. The readout line above stays empty until a day is pointed at, then reads out
 * that day: its balance after the day's payments, the range and the payments and pays of the day.
 * Each payment of the walk is a dot on its step with its name and sum beside it, the one that takes the balance below zero
 * (core's `moneyEnds`) larger and in the problem colour; on a phone only the two biggest are named. The line is drawn
 * once from today to the payday and again when the walk changes.
 * Behind it, when core has the household's past pay periods (`past`), each is a thin muted line of its balance aligned by days
 * before the payday, and under the picture one count says in how many of them the money held out. The scale is the walk's,
 * so a past line outside it is cut at the frame.
 */
export function BalanceSteps({ low, payday, past }: { low: KnownLowPoint; payday: string | null; past: PastPeriods | null }) {
  const clipId = useId().replace(/:/g, "");
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const width = measured || UNMEASURED;
  const { line, steps } = low;
  const today = line[0]!.date;
  const first = today;
  const last = line[line.length - 1]!.date;
  const narrow = width < NARROW;
  const values = line.flatMap((c) => [c.cents, c.lowCents, c.highCents]);
  // a phone gets a lower plot, so the page stays short
  const options = narrow ? { minHeight: 160, tallest: 160, ratio: 0.3 } : { minHeight: 200, tallest: 280, ratio: 0.3 };
  const margin = { top: 20, right: 8, bottom: BOTTOM };
  const draft = frame(width, { ...margin, left: 48 }, options);
  const y0 = linear(values, [draft.innerH, 0], { target: tickTarget(draft.innerH) });
  const f = frame(width, { ...margin, left: axisRoom(y0.ticks.map(moneyAxis)) }, options);
  const y = linear(values, [f.innerH, 0], { target: tickTarget(f.innerH) });
  const x = time(first, last, f.innerW);
  const days = Array.from({ length: x.days }, (_, i) => addDays(first, i));
  const cornerX = (i: number) => x.x(line[i]!.date);
  // a day reads out its lowest corner: the balance after its payments and before its pay, the figure's own measure
  const cornersOf = (day: string) => line.filter((c) => c.date === day);
  const dayCorner = (day: string): Corner | undefined => cornersOf(day).reduce<Corner | undefined>((min, c) => (min === undefined || c.cents < min.cents ? c : min), undefined);
  const stepsOf = (day: string) => steps.filter((s) => s.date === day);
  const lowCorner = line.find((c) => c.date === low.date && c.cents === low.cents);
  const parts = (day: string) => {
    const c = dayCorner(day);
    if (!c) return [];
    return [
      { name: t("home.days_balance"), value: answerMoney(c.cents), swatch: <span className="swatch bs-key-line" /> },
      ...(c.lowCents === c.highCents ? [] : [{ name: t("home.days_usually"), value: rangeText(c.lowCents, c.highCents), swatch: <span className="swatch bs-key-band" /> }]),
      ...stepsOf(day).map((s) => ({ name: stepName(s), value: signedMoney(s.cents), swatch: null })),
    ];
  };
  const paydayIn = payday !== null && payday >= first && payday <= last ? payday : null;
  const ghosts = (paydayIn && past ? past.periods : []).map((p) => ({ payday: p.payday, points: p.points.map((q) => ({ date: addDays(paydayIn!, -q.daysBefore), cents: q.cents })).filter((q) => q.date >= first) })).filter((g) => g.points.length > 1);
  const ends = moneyEnds(low, paydayIn ?? last);
  // every payment is a dot where its step ends; its balance is the table's own (`rowAfterCents`)
  const payments = steps.filter((s) => s.cents < 0);
  const breakIndex = ends === null ? -1 : payments.findIndex((s) => s.date === ends.date && s.payee === ends.payee);
  const bills = payments.map((s, i) => ({ s, i, px: x.x(s.date), py: y(s.rowAfterCents), breaks: i === breakIndex }));
  // a tick a week from today, every other week when a week is narrower than a label; none too close to the last day's label
  const dayW = f.innerW / Math.max(1, x.days - 1);
  const every = 7 * dayW < DAY_LABEL_W ? 14 : 7;
  const todayIndex = days.indexOf(today);
  // the first day gives way to today when they are too near for two labels
  const fixed = [...(todayIndex > 0 && todayIndex * dayW < DAY_LABEL_W ? [] : [0]), todayIndex, days.length - 1];
  const ticks = days.flatMap((_, i) => (fixed.includes(i) || (i % every === 0 && fixed.every((k) => Math.abs(k - i) * dayW >= DAY_LABEL_W)) ? [i] : []));
  const range = `${dayMonth(first)}–${dayMonth(last)}`;
  const label = t("home.days_aria", { range, date: dayMonth(low.date), sum: answerMoney(low.cents) });
  const shownDay = days[at ?? 0]!;
  const atCorner = at === null ? undefined : dayCorner(days[at]!);
  const lowText = narrow ? t("home.days_low_short", { sum: answerMoney(low.cents) }) : t("home.days_low", { date: dayMonth(low.date), sum: answerMoney(low.cents) });
  // the lowest sum stands under its ring, where the line never is, and over it when the axis is too close; centred unless an edge cuts it
  const lowLabel = (c: Corner) => {
    const px = x.x(c.date);
    const half = (lowText.length * LABEL_CHAR_W) / 2;
    const anchor = px - half < 0 ? "start" : px + half > f.innerW ? "end" : "middle";
    const below = y(c.cents) + 18 <= f.innerH - 4;
    return { x: anchor === "start" ? px - 4 : anchor === "end" ? px + 4 : px, y: below ? y(c.cents) + 18 : y(c.cents) - 12, anchor } as const;
  };
  // the biggest payments are named first, each at the first of six places beside its dot (right and above, left and below, right and below, left and above, then the same two higher) that stays on the plot and clear of the dots, the lowest sum and the names placed before it
  const taken: Box[] = bills.map((b) => ({ x0: b.px - BREAK_DOT, x1: b.px + BREAK_DOT, y0: b.py - BREAK_DOT, y1: b.py + BREAK_DOT }));
  if (lowCorner) {
    const at = lowLabel(lowCorner);
    const w = lowText.length * LABEL_CHAR_W;
    taken.push({ x0: at.anchor === "start" ? at.x : at.anchor === "end" ? at.x - w : at.x - w / 2, x1: at.anchor === "start" ? at.x + w : at.anchor === "end" ? at.x : at.x + w / 2, y0: at.y - BILL_H / 2, y1: at.y + BILL_H / 2 });
  }
  const billLabels = [...bills]
    .sort((a, b) => a.s.cents - b.s.cents)
    .slice(0, narrow ? NAMED_STEPS : bills.length)
    .flatMap(({ s, i, px, py }) => {
      const text = `${s.payee} ${answerMoney(-s.cents)}`;
      const w = text.length * BILL_CHAR_W;
      const places = [
        { x: px + 10, y: py - 8, anchor: "start" },
        { x: px - 10, y: py + 22, anchor: "end" },
        { x: px + 10, y: py + 22, anchor: "start" },
        { x: px - 10, y: py - 8, anchor: "end" },
        { x: px + 10, y: py - 32, anchor: "start" },
        { x: px - 10, y: py - 32, anchor: "end" },
      ] as const;
      for (const p of places) {
        const box = { x0: p.anchor === "start" ? p.x : p.x - w, x1: p.anchor === "start" ? p.x + w : p.x, y0: p.y - 14, y1: p.y + 4 };
        if (box.x0 < 0 || box.x1 > f.innerW || box.y0 < 0 || box.y1 > f.innerH || taken.some((o) => overlaps(box, o))) continue;
        taken.push(box);
        return [{ key: `${i}:${s.date}:${s.payee}`, text, ...p }];
      }
      return [];
    });
  return (
    <div className="chart balance-steps" ref={ref}>
      {/* the payments of a day are told for the day picked, and the empty line keeps the room so the picture does not move */}
      {at === null ? <div className="readout-line" aria-hidden="true" /> : <ReadoutLine title={dayMonth(shownDay)} parts={parts(shownDay)} />}
      <svg width={f.width} height={f.height}>
        <g transform={`translate(${f.margin.left},${f.margin.top})`}>
          <g role="img" aria-label={label}>
            <ValueAxis ticks={[...y.ticks]} y={y} width={f.innerW} height={f.innerH} label={moneyAxis} bare />
            {ticks.map((i) => (
              <g key={days[i]}>
                <CategoryTick x={x.x(days[i]!)} base={f.innerH} long />
                <text x={x.x(days[i]!)} y={f.innerH + LABEL_Y} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}>
                  {i === todayIndex && i === 0 ? t("home.today") : dayMonth(days[i]!)}
                </text>
              </g>
            ))}
            {ghosts.length > 0 && (
              <g clipPath={`url(#${clipId})`} aria-hidden="true">
                <clipPath id={clipId}>
                  <rect x={0} y={0} width={f.innerW} height={f.innerH} />
                </clipPath>
                {ghosts.map((g) => (
                  <path key={g.payday} className="bs-ghost" d={linePath(g.points.map((q) => q.cents), (i) => x.x(g.points[i]!.date), y)} />
                ))}
              </g>
            )}
            <path className="est-band" d={areaPath(line.map((c) => c.lowCents), line.map((c) => c.highCents), cornerX, y)} />
            {paydayIn && (
              <g>
                <line className="kit-event-rule" x1={crisp(x.x(paydayIn))} x2={crisp(x.x(paydayIn))} y1={0} y2={f.innerH} />
                <text className="qc-end-sub" x={x.x(paydayIn) + (x.x(paydayIn) < f.innerW * 0.7 ? 6 : -6)} y={-6} textAnchor={x.x(paydayIn) < f.innerW * 0.7 ? "start" : "end"}>
                  {t("home.days_payday", { date: dayMonth(paydayIn) })}
                </text>
              </g>
            )}
            {/* keyed by the walk, so a change of it draws the line again */}
            <g className="draw" key={line.map((c) => `${c.date}:${c.cents}`).join()}>
              <path className="qc-line qc-now" d={linePath(line.map((c) => c.cents), cornerX, y)} />
              <circle className="qc-dot" cx={x.x(today)} cy={y(line[0]!.cents)} r={4} />
              {bills.map((b) => (
                <circle key={`${b.i}:${b.s.date}:${b.s.payee}`} className={b.breaks ? "bs-bill bs-break" : "bs-bill"} cx={b.px} cy={b.py} r={b.breaks ? BREAK_DOT : BILL_DOT} />
              ))}
              {billLabels.map((l) => (
                <text key={l.key} className="bs-bill-name" x={l.x} y={l.y} textAnchor={l.anchor}>
                  {l.text}
                </text>
              ))}
            </g>
            {lowCorner && (
              <g>
                <circle className="qc-low" cx={x.x(lowCorner.date)} cy={y(lowCorner.cents)} r={5} />
                <text className="qc-note" x={lowLabel(lowCorner).x} y={lowLabel(lowCorner).y} dy="0.32em" textAnchor={lowLabel(lowCorner).anchor}>
                  {lowText}
                </text>
              </g>
            )}
            {atCorner && <circle className="qc-dot" cx={x.x(atCorner.date)} cy={y(atCorner.cents)} r={4} pointerEvents="none" />}
          </g>
          <ReadoutLayer xs={days.map((d) => x.x(d))} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} focusAt={Math.max(0, days.indexOf(low.date))} label={t("home.days_readout")} />
        </g>
      </svg>
      <LiveReadout text={at === null ? "" : readoutText(dayMonth(days[at]!), parts(days[at]!))} />
      {past && ghosts.length > 0 && (
        <p className="bs-ghost-count">
          <span className="swatch bs-key-ghost" /> {t("home.days_enough", { enough: past.enoughCount, total: past.periods.length })}
        </p>
      )}
    </div>
  );
}
