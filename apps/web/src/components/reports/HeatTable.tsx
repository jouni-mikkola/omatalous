// Decision: find the month a category jumped
import { t, tn } from "../../text.ts";
import type { ReactNode } from "react";
import { money, monthLabel, monthLong } from "../../format.ts";
import { addsUpPrinted } from "../../marks.ts";
import type { ReportsData } from "../../types.ts";
import "../../styles/quality.css";
import { type Column, Table } from "../table/Table.tsx";

type Report = ReportsData["pivot"];

/** How many months a mean is over: a category's own accounts may cover fewer months than the household's (a card linked late). */
const meanMonths = (n: number) => tn(n, "rpt.hm_mean_one", "rpt.hm_mean_many");

/** Every category by every month as it was: the months are columns while there is room and a list under the row's name when there is not. */
export function HeatTable({ r }: { r: Report }) {
  // a running month is no monthly figure: without a complete month in the range the column is left out
  const hasAverage = r.averageCents !== null;
  // the column of row totals is the part of the printed grand total: the bracket stands only when the euros printed add up to it
  const sums = addsUpPrinted(r.rows.map((x) => x.totalCents), r.totalCents);
  type Row = Report["rows"][number];
  const columns: Column<Row>[] = [
    { key: "label", label: "Kategoria", kind: "text", rowHead: true, cell: (row) => row.label },
    ...r.months.map((m, i): Column<Row> => ({
      key: `m${i}`,
      label: (
        <>
          {monthLabel(m, m.endsWith("-01") || m === r.months[0])}
          {!r.complete[i] && <span className="partial-tag">{t("rpt.fv_partial")}</span>}
        </>
      ),
      text: monthLabel(m, true),
      kind: "money",
      series: true,
      className: (row) => `cell heat-l${row.heat[i]}${r.complete[i] ? "" : " partial-cell"}`,
      title: (row) => `${row.label}, ${monthLong(m)}: ${money(row.values[i]!)}`,
      cell: (row) => (row.values[i] ? money(row.values[i]!, false) : ""),
    })),
    { key: "total", label: t("rpt.hm_total"), kind: "money", main: true, cell: (row) => money(row.totalCents, false) },
    ...(hasAverage
      ? [
          {
            key: "average",
            label: (
              <>
                {t("rpt.hm_average")}
                <span className="partial-tag">{meanMonths(r.averageMonths)}</span>
              </>
            ),
            text: t("rpt.hm_average"),
            kind: "money",
            cell: (row: Row) => (
              <>
                {row.averageCents === null ? "–" : money(row.averageCents, false)}
                {row.averageCents !== null && row.averageMonths !== r.averageMonths && <span className="partial-tag">{meanMonths(row.averageMonths)}</span>}
              </>
            ),
          } satisfies Column<Row>,
        ]
      : []),
  ];
  const foot: Record<string, ReactNode> = { total: money(r.totalCents, false) };
  r.monthTotals.forEach((v, i) => (foot[`m${i}`] = money(v, false)));
  if (hasAverage) foot.average = money(r.averageCents!, false);
  return (
    <Table
      caption={t("rpt.hm_caption")}
      className="heat-table"
      rows={r.rows}
      rowKey={(row) => `${row.group}/${row.category}`}
      columns={columns}
      sums={sums ? ["total"] : undefined}
      total={{ label: t("rpt.hm_total"), cells: foot }}
    />
  );
}
