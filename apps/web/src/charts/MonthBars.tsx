// Decision: is the household spending more than it earns, month after month, and is this month on its usual course
import { useEffect, useId, useState } from "react";
import { monthEnd } from "@banking/core";
import { useSelect } from "../components/table/selection.tsx";
import { answerMoney, money, monthLabel, monthLong } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { hashOf } from "../routes.ts";
import { spentLabel, t, tn } from "../text.ts";
import type { DashboardData } from "../types.ts";
import { CategoryTick, ValueAxis } from "./Axes.tsx";
import { crisp, LABEL_Y } from "./draw.ts";
import { CAP_OVERSHOOT, capSum, capY, CapBreak, CapSum } from "./kit/cap.tsx";
import { monthNamePlaces, printedMonths } from "./kit/label.ts";
import { axisRoom, frame, monthPlot } from "./kit/layout.ts";
import { ReadoutLine, UsualLabel, USUAL_STRIP, usualComparison } from "./kit/Readout.tsx";
import { lastWhole, readoutText } from "./kit/readout.ts";
import { band, linear } from "./kit/scale.ts";
import { indexAtX, useSpan } from "./kit/span.ts";
import { monthAxisLabels, monthTickTarget } from "./kit/ticks.ts";
import "../styles/charts.css";
import "../styles/month-bars.css";

type Overview = DashboardData["overview"];
type Month = Overview["months"][number];

/** The width the first paint draws at, before the box is measured. */
const UNMEASURED = 640;
/** Room under the axis for the month's name and a second line (the year, or that the month is running). */
const BOTTOM = LABEL_Y + 16;
/** Room above the plot for the sum written over a clipped bar. */
const TOP = 22;
/** A sum is an outlier when it is more than this many times the third quartile of the months' sums (`robustDomain`). */
const OUTLIER_FACTOR = 2;
/** A bar is cut only in a view of at least this many months: two bars a month would let a view of two clip. */
const MIN_CLIP_MONTHS = 4;
/** Under this width the axis is in thousands and a clipped sum is "21 t€". */
const NARROW = 600;

/** The rows of one month in Tapahtumat: its days, to today in the running month. */
const monthRowsHref = (month: string, today: string) =>
  hashOf({ page: "transactions", params: new URLSearchParams({ from: `${month}-01`, to: monthEnd(month) < today ? monthEnd(month) : today }) });

/** What a month says in its readout and its link's name: the two sums, that the month is not whole, and how its spending stands against the usual. */
function monthRows(m: Month, running: boolean): { name: string; value: string }[] {
  const compare = usualComparison("spend", m.againstUsual, false);
  return [
    { name: t("home.months_income"), value: m.incomeCents === null ? "–" : money(m.incomeCents, false) },
    { name: spentLabel(Boolean(m.fromSavingsCents)), value: m.spendCents === null ? "–" : money(m.spendCents, false) },
    ...(running ? [{ name: t("home.months_running"), value: "" }] : !m.complete && m.spendCents !== null ? [{ name: t("home.months_partial"), value: "" }] : []),
    ...(compare ? [{ name: compare, value: "" }] : []),
  ];
}

/**
 * Income and spending of the months it is given (Yhteenveto's last twelve, Raportit's period) as a pair of bars a month (`overview.months`), on one value axis, with
 * the usual month's spending as a dashed line across them (`overview.usualSpendCents`). The running month and a month
 * the accounts do not cover from its 1st are hatched with a dashed edge and the key says so, as their sums are not a
 * month's. A month has one look for both its bars: it is solid only when the spending report counts it complete and, given
 * `incomePartial` (the months the income report counts incomplete), the income report does not either. A sum far above the others (more than twice the third quartile) does not set the axis: its bar is cut 6 px
 * past the top with a break, and the sum is written above it. The year stands under each January only. Each month is a link to its rows in Tapahtumat; pointing at it or its keyboard focus reads
 * out its sums. Every value is a field of the answer: nothing is added up here. Inside a `ChartWithTable` dragging across months, or Shift with the arrow keys on a month, picks
 * a span: the table under the chart keeps those months (ADR 0023) and Escape lets go. A click on one month still opens its rows.
 */
export function MonthBars({ overview, today, incomePartial }: { overview: Pick<Overview, "months" | "usualSpendCents">; today: string; incomePartial?: ReadonlySet<string> }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const scope = useSelect();
  const hatch = `mbh-${useId().replace(/\W/g, "")}`;
  const width = measured || UNMEASURED;
  const { months, usualSpendCents: usual } = overview;
  const pickedRange = scope?.range ?? null;
  const dragSpan = useSpan({
    n: months.length,
    indexOf: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      return indexAtX(e.clientX, r.left, r.width, months.length);
    },
    // one month is a click on its link
    onSpan: (lo, hi) => lo !== hi && scope?.selectRange(months[lo]!.month, months[hi]!.month),
    onRelease: () => scope?.select(null),
    live: true,
    taken: pickedRange !== null,
  });
  const { clear } = dragSpan;
  // when the table lets go of the span (its x, Escape in another chart), the keys start anew
  useEffect(() => {
    if (!pickedRange) clear();
  }, [pickedRange, clear]);
  // a month the data does not reach (null) is no bar and no value of the axis
  const narrow = width < NARROW;
  const sums = months.flatMap((m, i) => [
    ...(m.incomeCents === null ? [] : [{ month: i, kind: "income" as const }]),
    ...(m.spendCents === null ? [] : [{ month: i, kind: "spend" as const }]),
  ]);
  const sumOf = (s: (typeof sums)[number]) => (s.kind === "income" ? months[s.month]!.incomeCents! : months[s.month]!.spendCents!);
  // the usual level widens the axis but does not count as a sum, so a short period clips none
  const values = sums.map(sumOf);
  // the level's name stands in a strip above the clipped sums, so no bar reaches it
  const headroom = TOP + (usual === null ? 0 : USUAL_STRIP);
  const options = monthPlot(width, headroom + BOTTOM);
  const draft = frame(width, { top: headroom, right: 4, bottom: BOTTOM, left: 48 }, options);
  const scale = (innerH: number) => linear(values, [innerH, 0], { target: monthTickTarget(innerH), clip: new Set(sums.map((s) => s.month)).size >= MIN_CLIP_MONTHS ? OUTLIER_FACTOR : undefined, include: usual === null ? [] : [usual] });
  const y0 = scale(draft.innerH);
  const f = frame(width, { top: headroom, right: 4, bottom: BOTTOM, left: axisRoom(y0.ticks.map(monthAxisLabels(y0.ticks, y0.step, narrow))) }, options);
  const y = scale(f.innerH);
  const axisLabel = monthAxisLabels(y.ticks, y.step, narrow);
  const capped = new Set(y.clipped.flatMap((k) => (y(values[k]!) < 0 || y(values[k]!) > f.innerH ? [`${sums[k]!.month}:${sums[k]!.kind}`] : [])));
  const x = band(months.length, f.innerW, 0.72);
  const bar = Math.max(1, x.width / 2 - 1);
  const running = (i: number) => i === months.length - 1 && months[i]!.month === today.slice(0, 7);
  // the readout names the picked month, else the last whole one; the running month keeps its name, which says "kesken"
  const wholeMonth = (m: Month, i: number) => m.complete && !running(i) && (m.incomeCents !== null || m.spendCents !== null);
  // a month's two bars have one look, and the key names it when the chart draws one such month
  const solid = (m: Month, i: number) => m.complete && !running(i) && !incomePartial?.has(m.month);
  const anyPartial = months.some((m, i) => !solid(m, i) && (m.incomeCents !== null || m.spendCents !== null));
  // the span in progress, else the one the table keeps: its first and last month
  const kept: [number, number] | null = scope?.range ? [months.findIndex((m) => m.month === scope.range!.from), months.findIndex((m) => m.month === scope.range!.to)] : null;
  const spanBand = dragSpan.bounds ?? (kept && kept[0] >= 0 && kept[1] >= 0 ? kept : null);
  const shown = at ?? lastWhole(months.map(wholeMonth)) ?? months.length - 1;
  const runningAt = months.findIndex((_, i) => running(i));
  const printed = printedMonths(months.length, x.step, new Set(runningAt < 0 ? [] : [runningAt]), shown);
  const firstPrinted = Math.min(...printed);
  const yearOf = (i: number) => (printed.has(i) && i !== runningAt && (i === firstPrinted || months[i]!.month.endsWith("-01")) ? months[i]!.month.slice(0, 4) : null);
  const top = (v: number) => capY(Math.min(y(v), y(0)), f.innerH);
  const height = (v: number) => Math.abs(capY(y(v), f.innerH) - y(0));
  const title = (m: Month) => monthLong(m.month);
  const places = monthNamePlaces(months.map((_, i) => x.centre(i)), x.step, f.innerW, months.map((m) => monthLabel(m.month)), printed);
  const place = (i: number) => places[i]!;
  // the break across a cut bar, and its sum on the side of the pair's middle so two cut bars do not collide; the sums are drawn after every bar, so a neighbour never covers one
  const capEnd = (sum: number) => (sum > 0 ? -CAP_OVERSHOOT : f.innerH + CAP_OVERSHOOT);
  const capDir = (sum: number) => (sum > 0 ? -1 : 1);
  const capSums = months.flatMap((m, i) => [
    ...(m.incomeCents !== null && capped.has(`${i}:income`) ? [{ key: `${m.month}:income`, sum: m.incomeCents, x: x.centre(i) - 1, anchor: "end" as const }] : []),
    ...(m.spendCents !== null && capped.has(`${i}:spend`) ? [{ key: `${m.month}:spend`, sum: m.spendCents, x: x.centre(i) + 1, anchor: "start" as const }] : []),
  ]);
  return (
    <div className="chart month-bars" ref={ref}>
      {spanBand ? (
        <ReadoutLine title={`${title(months[spanBand[0]]!)} – ${title(months[spanBand[1]]!)}`} parts={[]} note={tn(spanBand[1] - spanBand[0] + 1, "chart.span_months_one", "chart.span_months_many")} />
      ) : months[shown] ? (
        <ReadoutLine
          title={title(months[shown])}
          parts={[
            { name: t("home.months_income"), value: months[shown].incomeCents === null ? "–" : answerMoney(months[shown].incomeCents), swatch: <span className="mb-key-income" /> },
            { name: spentLabel(Boolean(months[shown].fromSavingsCents)), value: months[shown].spendCents === null ? "–" : answerMoney(months[shown].spendCents), swatch: <span className="mb-key-spend" /> },
          ]}
          note={running(shown) ? t("home.months_running") : !months[shown].complete && months[shown].spendCents !== null ? t("home.months_partial") : undefined}
          compare={usualComparison("spend", months[shown].againstUsual, false)}
          partialKey={anyPartial}
        />
      ) : (
        <div className="readout-line" />
      )}
      <svg width={f.width} height={f.height}>
        <g transform={`translate(${f.margin.left},${f.margin.top})`}>
          <g role="img" aria-label={t("home.months_aria", { count: months.length })}>
            <defs>
              {(
                [
                  ["income", "mb-hatch-income"],
                  ["spend", "mb-hatch-spend"],
                ] as const
              ).map(([role, line]) => (
                <pattern key={role} id={`${hatch}-${role}`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line className={line} x1={0} y1={0} x2={0} y2={5} />
                </pattern>
              ))}
            </defs>
            <ValueAxis ticks={[...y.ticks]} y={y} width={f.innerW} height={f.innerH} label={axisLabel} bare />
            {spanBand ? <rect className="pick-band" x={x.step * spanBand[0]} y={0} width={x.step * (spanBand[1] - spanBand[0] + 1)} height={f.innerH} /> : at !== null && <rect className="pick-band" x={x.step * at} y={0} width={x.step} height={f.innerH} />}
            {months.map((m, i) => {
              const whole = solid(m, i);
              const left = x.x(i);
              return (
                <g key={m.month} className={whole ? "mb-month" : "mb-month mb-partial"}>
                  {m.incomeCents !== null && (
                    <rect className={whole ? "mb-income" : "mb-income-part"} fill={whole ? undefined : `url(#${hatch}-income)`} x={left} y={top(m.incomeCents)} width={bar} height={height(m.incomeCents)} />
                  )}
                  {m.spendCents !== null && (
                    <rect className={whole ? "mb-spend" : "mb-spend-part"} fill={whole ? undefined : `url(#${hatch}-spend)`} x={left + bar + 2} y={top(m.spendCents)} width={bar} height={height(m.spendCents)} />
                  )}
                  {m.incomeCents !== null && capped.has(`${i}:income`) && <CapBreak x={left} width={bar} end={capEnd(m.incomeCents)} dir={capDir(m.incomeCents)} />}
                  {m.spendCents !== null && capped.has(`${i}:spend`) && <CapBreak x={left + bar + 2} width={bar} end={capEnd(m.spendCents)} dir={capDir(m.spendCents)} />}
                  <CategoryTick x={x.centre(i)} base={f.innerH} long={printed.has(i)} />
                  {printed.has(i) && (
                    <text className={i === shown ? "mb-pick" : undefined} x={place(i).x} y={f.innerH + LABEL_Y} textAnchor={place(i).anchor}>
                      <tspan>{monthLabel(m.month)}</tspan>
                      {i === runningAt ? (
                        <tspan x={place(i).x} dy={12}>
                          {t("home.months_running")}
                        </tspan>
                      ) : (
                        yearOf(i) && (
                          <tspan x={place(i).x} dy={12}>
                            {yearOf(i)}
                          </tspan>
                        )
                      )}
                    </text>
                  )}
                </g>
              );
            })}
            {capSums.map((c) => (
              <CapSum key={c.key} x={c.x} end={capEnd(c.sum)} dir={capDir(c.sum)} anchor={c.anchor} text={capSum(c.sum, narrow)} />
            ))}
            {usual !== null && <line className="mb-usual" x1={0} x2={f.innerW} y1={crisp(y(usual))} y2={crisp(y(usual))} />}
            {usual !== null && <UsualLabel innerW={f.innerW} above={TOP} text={t(narrow ? "home.months_usual_short" : "home.months_usual", { sum: answerMoney(usual) })} />}
          </g>
          {/* outside the picture: each month is a link of its own, so a control never sits inside an image */}
          <g className="mb-links" {...(scope ? { ...dragSpan.handlers, onPointerLeave: dragSpan.handlers.onPointerCancel } : {})}>
            {months.map((m, i) => (
              <a
                key={m.month}
                className="mb-link"
                href={monthRowsHref(m.month, today)}
                draggable={false}
                aria-label={`${readoutText(title(m), monthRows(m, running(i)))}. ${t("home.months_open")}`}
                aria-description={scope ? t("chart.span_keys") : undefined}
                onPointerEnter={() => setAt(i)}
                onPointerLeave={() => setAt(null)}
                onFocus={() => setAt(i)}
                onBlur={() => setAt(null)}
                onClick={(e) => {
                  // the click that ends a drag is no click on a month
                  if (dragSpan.dragged.current) {
                    e.preventDefault();
                    dragSpan.dragged.current = false;
                  }
                }}
                onKeyDown={(e) => scope && dragSpan.keys(e, i, (j) => (e.currentTarget.parentElement?.children[j] as SVGAElement | undefined)?.focus())}
              >
                <rect className="hit mb-hit" x={x.step * i} y={0} width={x.step} height={f.innerH} />
              </a>
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}
