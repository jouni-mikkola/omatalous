// Decision: which debts end when, and so the day the household is free of them
import { useWidth } from "../../hooks.ts";
import { Table } from "../../components/table/Table.tsx";
import { money, monthYear } from "../../format.ts";
import { t } from "../../text.ts";
import { crisp } from "../draw.ts";
import "../../styles/question-chart.css";

/** One debt of the plan, as the server's plan gives it: where it ends with the freed payments, and on its own payments. `balanceCents` null when the row has none. */
export interface DebtLane {
  id: string;
  name: string;
  balanceCents: number | null;
  end: string;
  own: string;
}

const ROW = 56;
const BAR_TOP = 24;
const BAR_HEIGHT = 16;
/** Room right of the axis for the month of the longest lane's end. */
const END_ROOM = 88;
const AXIS_ROOM = 28;
const NAME_MAX = 30;

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const shortName = (name: string) => (name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name);

/**
 * One lane per debt on a shared axis from today to the last end, in the order the plan gives (the dearest first). The
 * bar ends where the debt's last payment falls and says its month; a dotted line under a lane ends where the debt would
 * end on its own payments, drawn only where that is another day. The dates are the plan's own: the chart works out
 * only where a day stands on the axis. `axisLanes` set the axis (the lanes as they stand), so lanes that shorten keep
 * their scale and the bars tween in place.
 */
export function DebtLanes({ lanes, axisLanes = lanes, today }: { lanes: readonly DebtLane[]; axisLanes?: readonly DebtLane[]; today: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const innerW = Math.max(width - END_ROOM, 0);
  const start = dayNumber(today);
  const last = Math.max(...axisLanes.flatMap((l) => [dayNumber(l.end), dayNumber(l.own)]));
  const span = Math.max(last - start, 1);
  const x = (iso: string) => (Math.max(dayNumber(iso) - start, 0) / span) * innerW;
  const height = lanes.length * ROW + AXIS_ROOM;
  const firstYear = Number(today.slice(0, 4)) + 1;
  const lastYear = Number(new Date(last * 86_400_000).toISOString().slice(0, 4));
  const yearPx = innerW / Math.max((span / 365.25), 1);
  const everyYears = yearPx >= 44 ? 1 : yearPx * 2 >= 44 ? 2 : 5;
  const years = Array.from({ length: Math.max(lastYear - firstYear + 1, 0) }, (_, i) => firstYear + i).filter((y) => y % everyYears === 0 && x(`${y}-01-01`) <= innerW);
  const hasOwn = lanes.some((l) => l.own !== l.end);
  return (
    <div className="chart" ref={ref}>
      {hasOwn && (
        <p className="use-key" aria-hidden="true">
          <span>
            <i className="lane-own-key" />
            {t("rpt.dl_own")}
          </span>
        </p>
      )}
      {width > END_ROOM && (
        <svg width={width} height={height}>
          <g role="img" aria-label={t("rpt.dl_aria")}>
            {years.map((y) => (
              <g key={y}>
                <line className="grid-line" x1={crisp(x(`${y}-01-01`))} x2={crisp(x(`${y}-01-01`))} y1={0} y2={lanes.length * ROW} />
                <text x={x(`${y}-01-01`)} y={lanes.length * ROW + 18} textAnchor="middle">
                  {y}
                </text>
              </g>
            ))}
            <line className="axis-line" x1={0} x2={innerW} y1={crisp(lanes.length * ROW)} y2={crisp(lanes.length * ROW)} />
            {lanes.map((l, i) => {
              const top = i * ROW;
              const mid = top + BAR_TOP + BAR_HEIGHT / 2;
              return (
                <g key={l.id}>
                  <text className="lane-name" x={0} y={top + 16}>
                    {l.balanceCents === null ? shortName(l.name) : `${shortName(l.name)} · ${money(l.balanceCents, false)}`}
                  </text>
                  <rect className="bar lane-bar" x={0} y={top + BAR_TOP} style={{ width: Math.max(x(l.end), 2) }} height={BAR_HEIGHT} />
                  <text className="lane-end" x={8} y={mid} dy="0.32em" style={{ transform: `translateX(${x(l.end)}px)` }}>
                    {monthYear(l.end)}
                  </text>
                  {l.own !== l.end && <line className="lane-own" x1={0} x2={x(l.own)} y1={top + BAR_TOP + BAR_HEIGHT + 6} y2={top + BAR_TOP + BAR_HEIGHT + 6} />}
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}

/** The chart's table view: each debt with what is left and the month it ends, and the month on its own payments where that differs. */
export function DebtLanesTable({ lanes }: { lanes: readonly DebtLane[] }) {
  const hasOwn = lanes.some((l) => l.own !== l.end);
  return (
    <Table
      caption={t("rpt.dl_caption")}
      rows={lanes}
      rowKey={(l) => l.id}
      columns={[
        { key: "name", label: t("rpt.ln_col_debt"), kind: "text", rowHead: true, cell: (l) => l.name },
        { key: "balance", label: t("rpt.ln_col_balance"), kind: "money", cents: (l) => l.balanceCents, precision: "euros" },
        { key: "end", label: t("rpt.dl_ends"), kind: "text", main: true, cell: (l) => monthYear(l.end) },
        ...(hasOwn ? [{ key: "own", label: t("rpt.dl_ends_own"), kind: "text" as const, cell: (l: DebtLane) => monthYear(l.own) }] : []),
      ]}
    />
  );
}
