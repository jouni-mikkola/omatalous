// Decision: take on a new commitment or not, build up savings or not
import type { FixedVariableReport } from "@banking/core";
import { LAYERS, layersOf, StackedArea } from "../../../charts/forms/StackedArea.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { printedParts } from "@banking/core";
import { BarFigure } from "../../../components/table/Cells.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { money, monthLong, percent } from "../../../format.ts";
import type { ReportSection, SectionProps } from "../types.ts";

/**
 * The chart's table view: the four layers of each month, the month's spending and the fixed share as a bar in the fixed
 * layer's colour, with the period's layers on the total row. All server fields; a month not ended says so.
 */
function Rows({ rows, totals, complete }: { rows: FixedVariableReport["rows"]; totals: FixedVariableReport["totals"]; complete: boolean[] }) {
  // a layer of nothing has no column, as the chart has no band for it
  const layers = layersOf(rows);
  const totalEuros = printedParts(LAYERS.map((l) => totals[l.key]), totals.spendingCents);
  type Row = FixedVariableReport["rows"][number];
  // the layers of the month in euros that add up to its Menot as printed (core `printedParts`)
  const printedOf = (r: Row) => printedParts(LAYERS.map((l) => r[l.key]), r.tops[3]);
  const share = (v: number | null) => (v === null ? "–" : <BarFigure value={v} max={1} color={LAYERS[0].color}>{percent(v)}</BarFigure>);
  const columns: Column<Row>[] = [
    {
      key: "month",
      label: "Kuukausi",
      kind: "text",
      rowHead: true,
      cell: (r) => (
        <>
          {monthLong(r.month)}
          {!complete[rows.indexOf(r)] && <span className="muted"> (vajaa)</span>}
        </>
      ),
    },
    ...layers.map((l): Column<Row> => ({
      key: l.key,
      label: (
        <>
          <span className="fv-key" style={{ background: l.color }} aria-hidden="true" />
          {l.label}
        </>
      ),
      text: l.label,
      kind: "money",
      cell: (r) => money(printedOf(r)[LAYERS.findIndex((x) => x.key === l.key)]!, false),
    })),
    { key: "spending", label: "Menot", kind: "money", main: true, cell: (r) => money(r.tops[3], false) },
    { key: "fixed", label: "Kiinteiden osuus", kind: "share", cell: (r) => share(r.fixedShare) },
  ];
  return (
    <Table<Row>
      caption="Kiinteät ja muuttuvat menot kuukausittain"
      className="fv-table"
      rows={rows}
      rowKey={(r) => r.month}
      columns={columns}
      total={{
        label: "Jakso yhteensä",
        cells: {
          ...Object.fromEntries(layers.map((l) => [l.key, money(totalEuros[LAYERS.findIndex((x) => x.key === l.key)]!, false)])),
          spending: money(totals.spendingCents, false),
          fixed: share(totals.fixedShare),
        },
      }}
    />
  );
}

/** "syyskuussa", or "syyskuussa 2025" with the year: the month in the inessive (every month's name ends in -kuu). */
const inMonth = (month: string, withYear = false) => {
  const [name, year] = monthLong(month).split(" ");
  return withYear ? `${name}ssa ${year}` : `${name}ssa`;
};
const capital = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

function FixedVariable({ ctx }: SectionProps) {
  const r = ctx.data.fixedVariable;
  const { buffer } = ctx.data;
  // a month counts when it has ended and the history holds it whole, as the cash flow rows tell
  const done = new Set(ctx.data.cashflow.rows?.filter((x) => x.complete).map((x) => x.month) ?? []);
  const complete = r.rows.map((x) => done.has(x.month));
  // the newest complete month against the first one the chart draws, in the server's whole percents the end labels show
  const last = r.rows.findLast((x, i) => complete[i] && x.shares[0] !== null);
  const first = r.rows.find((x, i) => complete[i] && x.shares[0] !== null);
  const months = buffer.bufferMonths === null ? null : buffer.bufferMonths.toLocaleString("fi-FI", { maximumFractionDigits: 1 });
  return (
    <ReportPanel id={section.id} title={section.title} datum={`Kiinteät ${money(buffer.fixedMonthlyCents, false)} kuussa`}>
      <QuestionChart
        id="kiinteat-osat"
        question="Kuinka suuri osa menoista on lukittu ennen kuun alkua?"
        answer={
          <>
            {last ? (
              <>
                {capital(inMonth(last.month))} kiinteisiin menoihin meni <strong>{last.shares[0]} %</strong> menoista.{" "}
                {first && first.month !== last.month ? `${capital(inMonth(first.month, true))} osuus oli ${first.shares[0]} %. ` : null}
              </>
            ) : null}
            Kiinteät menot ovat nyt <strong>{money(buffer.fixedMonthlyCents, false)}</strong> kuussa
            {buffer.fixedShare === null ? "." : `, ${percent(buffer.fixedShare)} tavallisista tuloista.`}
            {months === null ? "" : ` Tilien saldo riittää ${months} kuukauden tavallisiin menoihin.`}
          </>
        }
        table={<Rows rows={r.rows} totals={r.totals} complete={complete} />}
      >
        <StackedArea rows={r.rows} complete={complete} />
      </QuestionChart>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "kiinteat",
  title: "Kiinteät ja muuttuvat",
  order: 60,
  page: "reports",
  tab: "virta",
  // the fixed costs a month and their share of the income are the buffer report's, the complete months the cash flow's
  reports: ["fixedVariable", "buffer", "cashflow"],
  Component: FixedVariable,
};
