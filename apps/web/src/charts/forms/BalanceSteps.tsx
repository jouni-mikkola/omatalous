// Decision: on which day before the payday the money is tightest, and which bill takes it there
import { addDays } from "@banking/core";
import { useWidth } from "../../hooks.ts";
import { answerMoney, dayMonth, language, money, signedMoney } from "../../format.ts";
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
/** How many payments are named in the picture; the rest are in the readout and the table. */
const NAMED_STEPS = 2;

/** "2 700–3 260 €": the low end without its sign of currency in Finnish, as the glossary writes a range. */
function rangeText(low: number, high: number): string {
  const lowText = language() === "en" ? money(low, false) : money(low, false).replace(/\s€$/, "");
  return t("home.days_range", { low: lowText, high: money(high, false) });
}

/** The name of a payment or a pay, with its estimate said. */
export function stepName(s: Step): string {
  return s.estimate ? t("home.days_estimate", { payee: s.payee }) : s.payee;
}

/**
 * The balance of the everyday accounts from today to the last day core's `lowPoint` looks at, as a line of its corners
 * (`line`): a bill is a step down, a pay a step up and the expected everyday spending the slope between days, with the
 * range of that spending (`lowCents`–`highCents`) as the shaded band. The lowest corner, the figure of `lowPoint`, has a
 * ring and its sum; the payday is a rule with its date; the two biggest payments are named at their step. Every figure
 * is core's; nothing is added up here. The readout line above names the series and reads out the day pointed at (by
 * default the lowest day): its balance after the day's payments, the range and the payments and pays of the day.
 */
export function BalanceSteps({ low, payday }: { low: KnownLowPoint; payday: string | null }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const width = measured || UNMEASURED;
  const { line, steps } = low;
  const first = line[0]!.date;
  const last = line[line.length - 1]!.date;
  const narrow = width < NARROW;
  const values = line.flatMap((c) => [c.cents, c.lowCents, c.highCents]);
  // a phone gets a smaller plot, so the page stays short (the roadmap's N11)
  const options = narrow ? { minHeight: 92, tallest: 92, ratio: 0.3 } : { minHeight: 200, tallest: 280, ratio: 0.3 };
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
  const shown = at ?? Math.max(0, days.indexOf(low.date));
  const parts = (day: string) => {
    const c = dayCorner(day);
    if (!c) return [];
    return [
      { name: t("home.days_balance"), value: answerMoney(c.cents), swatch: <span className="swatch bs-key-line" /> },
      ...(c.lowCents === c.highCents ? [] : [{ name: t("home.days_usually"), value: rangeText(c.lowCents, c.highCents), swatch: <span className="swatch bs-key-band" /> }]),
      ...stepsOf(day).map((s) => ({ name: stepName(s), value: signedMoney(s.cents), swatch: null })),
    ];
  };
  // the biggest payments on days of their own, so two names never stand on one step
  const named: Step[] = [];
  for (const s of [...steps].filter((s) => s.cents < 0).sort((a, b) => a.cents - b.cents)) {
    if (named.length < NAMED_STEPS && !named.some((n) => n.date === s.date)) named.push(s);
  }
  const paydayIn = payday !== null && payday >= first && payday <= last ? payday : null;
  // a name stands on the side of its step with more room before the payday's rule or the plot's edge, and is cut to that
  // room with "…" (the readout and the table have it whole); a step with no room for its sum and a few letters is not named
  const stepLabel = (s: Step) => {
    const corners = cornersOf(s.date);
    const top = y(corners[0]!.cents);
    const bottom = y(dayCorner(s.date)!.cents);
    const px = x.x(s.date);
    const end = paydayIn !== null && paydayIn > s.date ? x.x(paydayIn) : f.innerW;
    const start = paydayIn !== null && paydayIn < s.date ? x.x(paydayIn) : 0;
    const right = end - px >= px - start;
    const fits = Math.floor(((right ? end - px : px - start) - 12) / LABEL_CHAR_W);
    const sum = answerMoney(-s.cents);
    const name = s.payee.length + 1 + sum.length <= fits ? s.payee : `${s.payee.slice(0, Math.max(0, fits - sum.length - 2)).trimEnd()}…`;
    if (fits < sum.length + 5) return null;
    return { text: `${name} ${sum}`, x: right ? px + 6 : px - 6, y: corners.length > 1 ? (top + bottom) / 2 : bottom - 8, anchor: right ? "start" : "end" } as const;
  };
  const stepLabels = named.flatMap((s) => {
    const label = stepLabel(s);
    return label ? [{ key: `${s.date}:${s.payee}`, ...label }] : [];
  });
  // a tick a week from today, every other week when a week is narrower than a label; none too close to the last day's label
  const dayW = f.innerW / Math.max(1, x.days - 1);
  const every = 7 * dayW < DAY_LABEL_W ? 14 : 7;
  const ticks = days.flatMap((_, i) => (i === 0 || i === days.length - 1 || (i % every === 0 && (days.length - 1 - i) * dayW >= DAY_LABEL_W) ? [i] : []));
  const range = `${dayMonth(first)}–${dayMonth(last)}`;
  const label = t("home.days_aria", { range, date: dayMonth(low.date), sum: answerMoney(low.cents) });
  const shownDay = days[shown]!;
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
  return (
    <div className="chart balance-steps" ref={ref}>
      <ReadoutLine title={dayMonth(shownDay)} parts={parts(shownDay)} />
      <svg width={f.width} height={f.height}>
        <g transform={`translate(${f.margin.left},${f.margin.top})`}>
          <g role="img" aria-label={label}>
            <ValueAxis ticks={[...y.ticks]} y={y} width={f.innerW} height={f.innerH} label={moneyAxis} bare />
            {ticks.map((i) => (
              <g key={days[i]}>
                <CategoryTick x={x.x(days[i]!)} base={f.innerH} long />
                <text x={x.x(days[i]!)} y={f.innerH + LABEL_Y} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}>
                  {i === 0 ? t("home.today") : dayMonth(days[i]!)}
                </text>
              </g>
            ))}
            <path className="est-band" d={areaPath(line.map((c) => c.lowCents), line.map((c) => c.highCents), cornerX, y)} />
            {paydayIn && (
              <g>
                <line className="kit-event-rule" x1={crisp(x.x(paydayIn))} x2={crisp(x.x(paydayIn))} y1={0} y2={f.innerH} />
                <text className="qc-end-sub" x={x.x(paydayIn) + (x.x(paydayIn) < f.innerW * 0.7 ? 6 : -6)} y={-6} textAnchor={x.x(paydayIn) < f.innerW * 0.7 ? "start" : "end"}>
                  {t("home.days_payday", { date: dayMonth(paydayIn) })}
                </text>
              </g>
            )}
            <path className="qc-line qc-now" d={linePath(line.map((c) => c.cents), cornerX, y)} />
            {stepLabels.map((l) => (
              <text key={l.key} className="qc-end-sub" x={l.x} y={l.y} dy="0.32em" textAnchor={l.anchor}>
                {l.text}
              </text>
            ))}
            <circle className="qc-dot" cx={x.x(first)} cy={y(line[0]!.cents)} r={4} />
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
    </div>
  );
}
