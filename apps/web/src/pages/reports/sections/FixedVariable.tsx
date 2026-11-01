// Decision: take on a new commitment or not, build up savings or not
import type { FixedVariableReport } from "@banking/core";
import { LAYERS, layersOf, StackedArea } from "../../../charts/forms/StackedArea.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { printedParts } from "@banking/core";
import { BarFigure } from "../../../components/table/Cells.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { Housing } from "../../../components/housing/Housing.tsx";
import { decimalMax1, money, monthLong, monthLongIn, percent } from "../../../format.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { section as loansSection } from "./Loans.tsx";
import { css } from "../../../css.ts";
import { rich, t } from "../../../text.ts";

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
      label: t("rpt.month"),
      kind: "text",
      rowHead: true,
      cell: (r) => (
        <>
          {monthLong(r.month)}
          {!complete[rows.indexOf(r)] && <span className="muted">{` (${t("rpt.fv_partial")})`}</span>}
        </>
      ),
    },
    ...layers.map((l): Column<Row> => ({
      key: l.key,
      label: (
        <>
          <span className="fv-key" ref={css({ background: l.color })} aria-hidden="true" />
          {l.label}
        </>
      ),
      text: l.label,
      kind: "money",
      cell: (r) => money(printedOf(r)[LAYERS.findIndex((x) => x.key === l.key)]!, false),
    })),
    { key: "spending", label: t("rpt.tm_spent"), kind: "money", main: true, cell: (r) => money(r.tops[3], false) },
    { key: "fixed", label: t("rpt.fv_fixed_share"), kind: "share", cell: (r) => share(r.fixedShare) },
  ];
  return (
    <Table<Row>
      caption={t("rpt.fv_caption")}
      className="fv-table"
      rows={rows}
      rowKey={(r) => r.month}
      search={false}
      csv={false}
      columns={columns}
      total={{
        label: t("rpt.period_total"),
        cells: {
          ...Object.fromEntries(layers.map((l) => [l.key, money(totalEuros[LAYERS.findIndex((x) => x.key === l.key)]!, false)])),
          spending: money(totals.spendingCents, false),
          fixed: share(totals.fixedShare),
        },
      }}
    />
  );
}

/** "syyskuussa", or "syyskuussa 2025" with the year: the month in the inessive (in English "September", "September 2025"). */
const inMonth = (month: string, withYear = false) => (withYear ? monthLongIn(month) : monthLongIn(month).split(" ")[0]!);
const capital = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

function FixedVariable({ ctx }: SectionProps) {
  const r = ctx.data.fixedVariable;
  const { buffer } = ctx.data;
  // a month counts when it has ended and the history holds it whole, as the cash flow rows tell
  const done = new Set(ctx.data.cashflow.rows?.filter((x) => x.complete).map((x) => x.month) ?? []);
  const complete = r.rows.map((x) => done.has(x.month));
  // the newest complete month against the first one the chart draws, in the whole percent the table prints
  const last = r.rows.findLast((x, i) => complete[i] && x.fixedPercent !== null && x.fixedCents >= 0);
  const first = r.rows.find((x, i) => complete[i] && x.fixedPercent !== null && x.fixedCents >= 0);
  const months = buffer.bufferMonths === null ? null : decimalMax1(buffer.bufferMonths);
  return (
    <>
    <ReportPanel id={section.id} title={section.title} datum={t("rpt.fv_datum", { amount: money(buffer.fixedMonthlyCents, false) })}>
      <QuestionChart
        id="kiinteat-osat"
        question={t("rpt.fv_question")}
        answer={
          <>
            {last ? (
              <>
                {rich("rpt.fv_last", { month: capital(inMonth(last.month)), share: last.fixedPercent! })}{" "}
                {first && first.month !== last.month ? `${t("rpt.fv_first", { month: capital(inMonth(first.month, true)), share: first.fixedPercent! })} ` : null}
              </>
            ) : null}
            {rich("rpt.fv_now", { amount: money(buffer.fixedMonthlyCents, false) })}
            {buffer.fixedShare === null ? "." : t("rpt.fv_of_income", { share: percent(buffer.fixedShare) })}
            {buffer.bufferMonths === null ? "" : ` ${t(buffer.bufferMonths < 1 ? "rpt.fv_buffer_low" : "rpt.fv_buffer", { months: months! })}`}
          </>
        }
        table={<Rows rows={r.rows} totals={r.totals} complete={complete} />}
      >
        <StackedArea rows={r.rows} complete={complete} />
      </QuestionChart>
    </ReportPanel>
    {/* what the home costs a month sits with the other fixed costs */}
    {ctx.data.housing && <Housing housing={ctx.data.housing} reportAnchor={loansSection.id} />}
    </>
  );
}

export const section: ReportSection = {
  id: "kiinteat",
  get title() {
    return t("rpt.sec_fixedvariable");
  },
  order: 60,
  page: "reports",
  // the fixed costs a month and their share of the income are the buffer report's, the complete months the cash flow's
  reports: ["fixedVariable", "buffer", "cashflow", "housing"],
  Component: FixedVariable,
};
