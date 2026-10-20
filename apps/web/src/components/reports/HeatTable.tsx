// Decision: find the month a category jumped
import type { ReactNode } from "react";
import { money, monthLabel, monthLong } from "../../format.ts";
import { addsUpPrinted } from "../../marks.ts";
import type { ReportsData } from "../../types.ts";
import "../../styles/quality.css";
import { type Column, DataTable } from "../table/DataTable.tsx";

type Report = ReportsData["pivot"];

/** How many months a mean is over: a category's own accounts may cover fewer months than the household's (a card linked late). */
const meanMonths = (n: number) => `${n} kuukauden keskiarvo`;

/** Every category by every month as it was: the wide table, and the list a narrow screen draws instead of it. */
export function HeatTable({ r }: { r: Report }) {
  // a running month is no monthly figure: without a complete month in the range the column is left out
  const hasAverage = r.averageCents !== null;
  // the column of row totals is the part of the printed grand total: the bracket stands only when the euros printed add up to it
  const sums = addsUpPrinted(r.rows.map((x) => x.totalCents), r.totalCents);
  type Row = Report["rows"][number];
  const columns: Column<Row>[] = [
    { key: "label", label: "Kategoria", kind: "text", rowHead: true, cell: (row) => <span style={{ whiteSpace: "nowrap" }}>{row.label}</span> },
    ...r.months.map((m, i): Column<Row> => ({
      key: `m${i}`,
      label: (
        <>
          {monthLabel(m, m.endsWith("-01") || m === r.months[0])}
          {!r.complete[i] && <span className="partial-tag">vajaa</span>}
        </>
      ),
      text: monthLabel(m, true),
      kind: "money",
      className: (row) => `cell heat-l${row.heat[i]}${r.complete[i] ? "" : " partial-cell"}`,
      title: (row) => `${row.label}, ${monthLong(m)}: ${money(row.values[i]!)}`,
      cell: (row) => (row.values[i] ? money(row.values[i]!, false) : ""),
    })),
    { key: "total", label: "Yhteensä", kind: "money", cell: (row) => <strong>{money(row.totalCents, false)}</strong> },
    ...(hasAverage
      ? [
          {
            key: "average",
            label: (
              <>
                Keskimäärin kuussa
                <span className="partial-tag">{meanMonths(r.averageMonths)}</span>
              </>
            ),
            text: "Keskimäärin kuussa",
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
    <>
      <div className="table-wrap pivot-wide">
        <DataTable
          id="pivot-heat"
          caption="Kategoriat kuukausittain"
          rows={r.rows}
          rowKey={(row) => `${row.group}/${row.category}`}
          columns={columns}
          className="heat-table"
          phone="none"
          sums={sums ? ["total"] : undefined}
          total={{ label: "Yhteensä", cells: foot }}
        />
      </div>
      <PivotList r={r} />
    </>
  );
}

/**
 * The same figures for a phone: one line per category with its total and monthly average, and the months behind a tap.
 * Twelve month columns do not fit 390 px, and a table that scrolls sideways hides the months it is about.
 */
function PivotList({ r }: { r: Report }) {
  return (
    <ul className="pivot-list pivot-narrow">
      {r.rows.map((row) => {
        const levels = row.heat;
        return (
          <li key={`${row.group}/${row.category}`}>
            <details>
              <summary>
                <span className="pivot-name">{row.label}</span>
                <strong className="pivot-total">{money(row.totalCents, false)}</strong>
                {row.averageCents !== null && (
                  <span className="pivot-avg muted">
                    {money(row.averageCents, false)}/kk, {meanMonths(row.averageMonths)}
                  </span>
                )}
              </summary>
              <dl className="pivot-months">
                {row.values.map((v, i) =>
                  v ? (
                    <div key={r.months[i]} className={`heat-l${levels[i]}${r.complete[i] ? "" : " partial-cell"}`}>
                      <dt>{monthLabel(r.months[i]!, r.months[i]!.endsWith("-01") || i === 0)}</dt>
                      <dd>{money(v, false)}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </details>
          </li>
        );
      })}
      <li className="pivot-sum">
        <span className="pivot-name">Yhteensä</span>
        <strong className="pivot-total">{money(r.totalCents, false)}</strong>
        {r.averageCents !== null && (
          <span className="pivot-avg muted">
            {money(r.averageCents, false)}/kk, {meanMonths(r.averageMonths)}
          </span>
        )}
      </li>
    </ul>
  );
}
