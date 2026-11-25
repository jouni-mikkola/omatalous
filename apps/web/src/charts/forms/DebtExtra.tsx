// Decision: how much more to pay a month on the debts, by when that ends them
import type { LoansReport } from "@banking/core";
import { useWidth } from "../../hooks.ts";
import { Table } from "../../components/table/Table.tsx";
import "../../styles/estimate.css";
import { money, monthLong, monthLongIn } from "../../format.ts";
import { t } from "../../text.ts";
import { crisp } from "../draw.ts";
import { axisRoom, frame, tickTarget } from "../kit/layout.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../kit/Readout.tsx";
import { readoutText } from "../kit/readout.ts";
import { linear, points } from "../kit/scale.ts";
import { areaPath, linePath } from "../kit/path.ts";
import { moneyAxis } from "../kit/ticks.ts";
import { Tip, ValueGrid } from "./parts.tsx";
import { color } from "../../design/tokens.ts";
import { css } from "../../css.ts";

type Path = NonNullable<LoansReport["path"]>;
type Scenario = LoansReport["extra"][number];

const soft = (base: string) => `color-mix(in srgb, ${base} 60%, ${color.surface})`;

/** "maaliskuussa 2041": the month of a day, in the inessive in Finnish. */
const inMonth = (day: string) => monthLongIn(day.slice(0, 7));

/** The name of a scenario: "100 € lisää". */
export const extraName = (s: Scenario) => t("rpt.ln_extra_step", { amount: money(s.extraCents, false) });

/**
 * What the loans owe each month on their own payments (the dashed line, the plan without the change) and with the
 * chosen extra payment (the area and its line), both from the server. The month the extra payment ends the last debt is
 * a rule with its month. With no extra payment chosen only the debts' own path is drawn, as the area.
 */
export function DebtExtra({ path, scenario }: { path: Path; scenario: Scenario | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const n = path.days.length;
  const owed = scenario?.owedCents ?? path.balanceCents;
  const narrow = width < 560;
  const draft = frame(width, { top: 20, right: 16, bottom: 24, left: 48 }, { minHeight: 200, tallest: 280, ratio: 0.26 });
  const y0 = linear(path.balanceCents, [draft.innerH, 0], { target: tickTarget(draft.innerH) });
  const f = frame(width, { top: 20, right: 16, bottom: 24, left: axisRoom(y0.ticks.map(moneyAxis)) }, { minHeight: 200, tallest: 280, ratio: 0.26 });
  const y = linear(path.balanceCents, [f.innerH, 0], { target: tickTarget(f.innerH) });
  const x = points(n, f.innerW);
  const zero = path.balanceCents.map(() => 0);
  const yearPx = (f.innerW / Math.max(n - 1, 1)) * 12;
  const everyYears = yearPx >= 44 ? 1 : yearPx * 2 >= 44 ? 2 : 5;
  const ticks = path.days.flatMap((d, i) => (d.slice(5, 7) === "01" && Number(d.slice(0, 4)) % everyYears === 0 ? [i] : []));
  const freeDate = scenario?.debtFreeDate ?? path.payoff;
  const free = freeDate === null ? -1 : path.days.findIndex((d) => d >= freeDate);
  const title = (i: number) => (i === 0 ? t("rpt.db_now", { month: monthLong(path.days[i]!.slice(0, 7)) }) : monthLong(path.days[i]!.slice(0, 7)));
  const tipRows = (i: number) => [
    { name: t("rpt.ln_extra_now"), value: money(path.balanceCents[i]!, false) },
    ...(scenario ? [{ name: extraName(scenario), value: money(owed[i]!, false), key: <span className="swatch" ref={css({ background: soft(color["role-debt"]) })} /> }] : []),
  ];
  return (
    <div className="chart" ref={ref}>
      {width > 0 && n > 1 && (
        <svg width={f.width} height={f.height}>
          <g transform={`translate(${f.margin.left},${f.margin.top})`}>
            <g role="img" aria-label={t("rpt.ln_extra_aria")}>
              <ValueGrid y={y} innerW={f.innerW} format={moneyAxis} />
              <path d={areaPath(zero, owed, x, y)} fill={soft(color["role-debt"])} stroke={color.surface} strokeWidth={1} />
              <path className="qc-line qc-now" d={linePath(owed, x, y)} />
              {scenario && <path className="qc-line est-line" d={linePath(path.balanceCents, x, y)} />}
              {ticks.map((i) => (
                <text key={i} x={x(i)} y={f.innerH + 16} textAnchor="middle">
                  {path.days[i]!.slice(0, 4)}
                </text>
              ))}
              {!narrow && scenario && (
                <text className="qc-end-sub" x={x(Math.min(n - 1, Math.round((n - 1) / 5))) + 4} y={y(path.balanceCents[Math.min(n - 1, Math.round((n - 1) / 5))]!) - 6}>
                  {t("rpt.ln_extra_now")}
                </text>
              )}
              {free >= 0 && (
                <g>
                  <line className="kit-event-rule" x1={crisp(x(free))} x2={crisp(x(free))} y1={0} y2={f.innerH} />
                  <text className="qc-note" x={x(free) - 6} y={10} textAnchor="end">
                    {t("rpt.db_paid", { month: inMonth(freeDate!) })}
                  </text>
                </g>
              )}
              {at !== null && <circle className="qc-dot" cx={x(at)} cy={y(owed[at]!)} r={4} pointerEvents="none" />}
            </g>
            <ReadoutLayer xs={path.days.map((_, i) => x(i))} innerW={f.innerW} innerH={f.innerH} at={at} onAt={setAt} keys={path.days} label={t("rpt.ln_extra_readout")} />
          </g>
        </svg>
      )}
      {at !== null && <Tip x={x(at)} left={f.margin.left} width={f.width} title={title(at)} rows={tipRows(at)} />}
      <LiveReadout text={at === null ? "" : readoutText(title(at), tipRows(at))} />
    </div>
  );
}

/** The chart's table view: what is owed a year at a time on the debts' own payments and with each extra payment. */
export function DebtExtraTable({ path, extra }: { path: Path; extra: readonly Scenario[] }) {
  const rows = path.days.flatMap((_, i) => (i % 12 === 0 || i === path.days.length - 1 ? [i] : []));
  return (
    <Table
      caption={t("rpt.ln_extra_caption")}
      rows={rows}
      rowKey={(i) => path.days[i]!}
      columns={[
        { key: "month", label: t("rpt.month_col"), kind: "text", rowHead: true, cell: (i) => monthLong(path.days[i]!.slice(0, 7)) },
        { key: "now", label: t("rpt.ln_extra_now"), kind: "money", cents: (i) => path.balanceCents[i]! },
        ...extra.map((s) => ({ key: `extra${s.extraCents}`, label: extraName(s), kind: "money" as const, cents: (i: number) => s.owedCents[i]! })),
      ]}
    />
  );
}
