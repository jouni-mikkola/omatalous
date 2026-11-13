// Decision: is the household spending more than it earns, month after month, and is this month on its usual course
import { useState } from "react";
import { monthEnd } from "@banking/core";
import { answerMoney, money, monthLong } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { hashOf } from "../routes.ts";
import { t } from "../text.ts";
import type { DashboardData } from "../types.ts";
import { CategoryTick, ValueAxis } from "./Axes.tsx";
import { crisp, LABEL_Y } from "./draw.ts";
import { Tip } from "./forms/parts.tsx";
import { axisRoom, frame, tickTarget } from "./kit/layout.ts";
import { readoutText } from "./kit/readout.ts";
import { band, linear } from "./kit/scale.ts";
import { moneyAxis, monthTicks } from "./kit/ticks.ts";
import "../styles/charts.css";
import "../styles/month-bars.css";

type Overview = DashboardData["overview"];
type Month = Overview["months"][number];

/** The width the first paint draws at, before the box is measured. */
const UNMEASURED = 640;
/** Room under the axis for the month's name and a second line (the year, or that the month is not whole). */
const BOTTOM = LABEL_Y + 16;

/** The rows of one month in Tapahtumat: its days, to today in the running month. */
const monthRowsHref = (month: string, today: string) =>
  hashOf({ page: "transactions", params: new URLSearchParams({ from: `${month}-01`, to: monthEnd(month) < today ? monthEnd(month) : today }) });

/** What a month says in its readout and its link's name: the two sums, and that the month is not whole. */
function monthRows(m: Month, running: boolean): { name: string; value: string }[] {
  return [
    { name: t("home.months_income"), value: money(m.incomeCents, false) },
    { name: t("home.months_spend"), value: money(m.spendCents, false) },
    ...(running ? [{ name: t("home.months_running"), value: "" }] : !m.complete ? [{ name: t("home.months_partial"), value: "" }] : []),
  ];
}

/**
 * Income and spending of the last twelve months as a pair of bars a month (`overview.months`), on one value axis, with
 * the usual month's spending as a dashed line across them (`overview.usualSpendCents`). The running month and a month
 * the accounts do not cover from its 1st are drawn lighter with a dashed edge and say so under their name, as their
 * sums are not a month's. Each month is a link to its rows in Tapahtumat; pointing at it or its keyboard focus reads
 * out its sums. Every value is a field of the answer: nothing is added up here.
 */
export function MonthBars({ overview, today }: { overview: Overview; today: string }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const width = measured || UNMEASURED;
  const { months, usualSpendCents: usual, usualMonths, usualLargeLeftOutCents: largeLeftOut } = overview;
  const values = [...months.flatMap((m) => [m.incomeCents, m.spendCents]), ...(usual === null ? [] : [usual])];
  const options = { minHeight: 180, tallest: 220, ratio: 0.3 };
  const draft = frame(width, { top: 8, right: 4, bottom: BOTTOM, left: 48 }, options);
  const y0 = linear(values, [draft.innerH, 0], { target: tickTarget(draft.innerH) });
  const f = frame(width, { top: 8, right: 4, bottom: BOTTOM, left: axisRoom(y0.ticks.map(moneyAxis)) }, options);
  const y = linear(values, [f.innerH, 0], { target: tickTarget(f.innerH) });
  const x = band(months.length, f.innerW, 0.72);
  const bar = Math.max(1, x.width / 2 - 1);
  const running = (i: number) => i === months.length - 1 && months[i]!.month === today.slice(0, 7);
  // the running month keeps its name; a name next to it gives way
  const ticks = monthTicks(
    months.map((m) => m.month),
    x.step,
    new Set(months.flatMap((_, i) => (running(i) ? [i] : []))),
  );
  // the year stands under the first printed name and under each January, so a phone that prints every other month still says it
  const first = ticks.findIndex((tick) => tick.printed);
  const yearOf = (i: number) => (ticks[i]!.printed && (i === first || months[i]!.month.endsWith("-01")) ? months[i]!.month.slice(0, 4) : null);
  const top = (v: number) => Math.min(y(v), y(0));
  const height = (v: number) => Math.abs(y(v) - y(0));
  const title = (m: Month) => monthLong(m.month);
  return (
    <div className="chart month-bars" ref={ref}>
      <ul className="mb-key" aria-hidden="true">
        <li>
          <span className="mb-key-income" />
          {t("home.months_income")}
        </li>
        <li>
          <span className="mb-key-spend" />
          {t("home.months_spend")}
        </li>
        {usual !== null && (
          <li>
            <span className="mb-key-usual" />
            {t("home.months_usual", { sum: answerMoney(usual), months: usualMonths })}
          </li>
        )}
      </ul>
      {usual !== null && largeLeftOut > 0 && <p className="muted">{t("home.months_usual_large", { sum: answerMoney(largeLeftOut) })}</p>}
      <svg width={f.width} height={f.height}>
        <g transform={`translate(${f.margin.left},${f.margin.top})`}>
          <g role="img" aria-label={t("home.months_aria", { count: months.length })}>
            <ValueAxis ticks={[...y.ticks]} y={y} width={f.innerW} height={f.innerH} label={moneyAxis} />
            {at !== null && <rect className="sel-band" x={x.step * at} y={0} width={x.step} height={f.innerH} />}
            {months.map((m, i) => {
              const whole = m.complete && !running(i);
              const left = x.x(i);
              return (
                <g key={m.month} className={whole ? "mb-month" : "mb-month mb-partial"}>
                  <rect className="mb-income" x={left} y={top(m.incomeCents)} width={bar} height={height(m.incomeCents)} />
                  <rect className="mb-spend" x={left + bar + 2} y={top(m.spendCents)} width={bar} height={height(m.spendCents)} />
                  <CategoryTick x={x.centre(i)} base={f.innerH} long={ticks[i]!.printed} />
                  {running(i) ? (
                    // the running month's name and its word end at the plot's edge, so neither is cut
                    <text className="mb-now" x={x.step * (i + 1)} y={f.innerH + LABEL_Y} textAnchor="end">
                      <tspan>{ticks[i]!.text}</tspan>
                      <tspan x={x.step * (i + 1)} dy={12}>
                        {t("home.months_running")}
                      </tspan>
                    </text>
                  ) : (
                    ticks[i]!.printed && (
                      <text x={x.centre(i)} y={f.innerH + LABEL_Y} textAnchor="middle">
                        <tspan>{ticks[i]!.text}</tspan>
                        {yearOf(i) && (
                          <tspan x={x.centre(i)} dy={12}>
                            {yearOf(i)}
                          </tspan>
                        )}
                      </text>
                    )
                  )}
                </g>
              );
            })}
            {usual !== null && <line className="mb-usual" x1={0} x2={f.innerW} y1={crisp(y(usual))} y2={crisp(y(usual))} />}
          </g>
          {/* outside the picture: each month is a link of its own, so a control never sits inside an image */}
          {months.map((m, i) => (
            <a
              key={m.month}
              className="mb-link"
              href={monthRowsHref(m.month, today)}
              aria-label={`${readoutText(title(m), monthRows(m, running(i)))}. ${t("home.months_open")}`}
              onPointerEnter={() => setAt(i)}
              onPointerLeave={() => setAt(null)}
              onFocus={() => setAt(i)}
              onBlur={() => setAt(null)}
            >
              <rect className="hit mb-hit" x={x.step * i} y={0} width={x.step} height={f.innerH} />
            </a>
          ))}
        </g>
      </svg>
      {at !== null && months[at] && <Tip x={x.centre(at)} left={f.margin.left} width={f.width} title={title(months[at])} rows={monthRows(months[at], running(at))} />}
    </div>
  );
}
