import { estimateRange, type PaceDay, paceDay } from "../../charts/PaceChart.tsx";
import type { DashboardData } from "../../types.ts";
import { Table } from "../table/Table.tsx";
import { t } from "../../text.ts";

/** Rows shown before "Näytä lisää": the latest days, so the table does not push the page's other blocks off the screen. */
const SHOWN_ROWS = 3;

/**
 * The chart's days as a table, the latest first: what each line of the chart says on each day, to the cent, with the
 * estimate for the month's end under them. Earlier days come with "Näytä lisää". It has the columns the chart has lines.
 */
export function PaceTable({ pace, names }: { pace: DashboardData["pace"]; names: { current: string; previous: string } }) {
  const last = pace.current.reduce<number>((n, v, i) => (v === null ? n : i + 1), 0);
  const past = Array.from({ length: last }, (_, i) => paceDay(pace, last - i));
  // the month's end is not a row between days: it stands under them as the estimate it is
  const end = pace.projection ? paceDay(pace, pace.daysInMonth).projection : null;
  return (
    <Table<PaceDay>
      caption={t("home.daily", { month: names.current })}
      rows={past}
      page={SHOWN_ROWS}
      toolbar={false}
      csv={false}
      total={end ? { label: t("chart.estimate_end"), cells: { current: estimateRange(end[0], end[1]) } } : undefined}
      rowKey={(d) => String(d.day)}
      columns={[
        { key: "day", label: t("home.col_day"), kind: "text", rowHead: true, cell: (d) => `${d.day}.` },
        { key: "current", label: names.current, kind: "money", precision: "cents", main: true, cents: (d) => d.current },
        ...(pace.expected ? [{ key: "expected", label: t("home.col_expected"), kind: "money" as const, precision: "cents" as const, cents: (d: PaceDay) => d.expected }] : []),
        ...(pace.previous ? [{ key: "previous", label: names.previous, kind: "money" as const, precision: "cents" as const, cents: (d: PaceDay) => d.previous }] : []),
      ]}
    />
  );
}
