// Decision: which category to cut: its sum over the period, its average month, and the months and payees behind it
import { monthEnd } from "@banking/core";
import { CategoryBars } from "../../../charts/forms/CategoryBars.tsx";
import { MonthColumns } from "../../../charts/forms/MonthColumns.tsx";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { KeyValue } from "../../../components/table/KeyValue.tsx";
import { ChartWithTable, OutsideFilter } from "../../../components/table/selection.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { query } from "../../../api.ts";
import { money, monthLong, signedMoney } from "../../../format.ts";
import type { ReportsData } from "../../../types.ts";
import { inSpan } from "../parts.tsx";
import type { ReportContext, ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";
import { monthName } from "../month-name.ts";

type Report = ReportsData["spendingMonths"];
type Row = Report["categories"][number];
type MonthRow = { month: string; cents: number | null; complete: boolean; savingsCents?: number | null };
type PayeeRow = Row["payees"][number] & { rest?: boolean };

const eur = (cents: number) => money(cents, false);

/** The rows of Tapahtumat behind a figure: the category, within the days of the period that the month holds. */
export function rowsHref(ctx: Pick<ReportContext, "range">, category: string, month?: string, merchant?: string, counted: string = ctx.range.from): string {
  const start = counted > ctx.range.from ? counted : ctx.range.from;
  const from = month && `${month}-01` > start ? `${month}-01` : start;
  const to = month && monthEnd(month) < ctx.range.to ? monthEnd(month) : ctx.range.to;
  return `#/transactions${query({ category, merchant, from, to })}`;
}

/** Under a category: its months, each a link to its rows, and the payees that got the most. Every figure is the server's. */
function Detail({ row, r, ctx }: { row: Row; r: Report; ctx: ReportContext }) {
  const months: MonthRow[] = r.months.map((month, i) => ({ month, cents: row.values[i] ?? null, complete: r.complete[i]! }));
  const monthText = (m: MonthRow) => monthName({ ...m, unknown: m.cents === null }, ctx.running);
  const monthColumns: Column<MonthRow>[] = [
    { key: "month", label: t("rpt.month"), kind: "text", rowHead: true, cell: (m) => (m.cents ? <a href={rowsHref(ctx, row.category, m.month, undefined, r.from)}>{monthText(m)}</a> : monthText(m)) },
    { key: "sum", label: t("rpt.sum"), kind: "money", main: true, precision: "cents", cents: (m) => m.cents, bar: { tone: "spending", value: (m) => m.cents ?? 0, max: Math.max(1, ...row.values.map((v) => v ?? 0)) } },
  ];
  const payeeColumns: Column<PayeeRow>[] = [
    { key: "name", label: t("table.payee"), kind: "text", rowHead: true, cell: (p) => (p.rest ? t("rpt.sm_other_payees") : p.name ? <a href={rowsHref(ctx, row.category, undefined, p.name, r.from)}>{p.name}</a> : t("rpt.sm_no_name")) },
    { key: "count", label: t("rpt.sm_rows"), kind: "count", cell: (p) => (p.rest ? "" : p.count) },
    { key: "sum", label: t("rpt.sum"), kind: "money", main: true, precision: "cents", cents: (p) => p.cents },
  ];
  // the payees past the named ones are one ordinary last row, so the rows add up to the category
  const payees: PayeeRow[] = row.otherPayeesCents > 0 ? [...row.payees, { name: "\u0000rest", cents: row.otherPayeesCents, count: 0, rest: true }] : row.payees;
  return (
    <div className="sm-detail">
      {row.statementCents !== 0 && <KeyValue items={[[t("rpt.sm_statement_part"), eur(row.statementCents)]]} />}
      <Table<MonthRow> caption={t("rpt.sm_months_of", { name: row.label })} rows={months} rowKey={(m) => m.month} columns={monthColumns} toolbar={false} csv={false} />
      <Table<PayeeRow>
        caption={t("rpt.sm_payees_of", { name: row.label })}
        rows={payees}
        rowKey={(p) => p.name}
        columns={payeeColumns}
        toolbar={false}
        csv={false}
      />
      <a href={rowsHref(ctx, row.category, undefined, undefined, r.from)}>{t("rpt.sm_all_rows")}</a>
    </div>
  );
}

function SpendingMonths({ ctx }: SectionProps) {
  const r = ctx.data.spendingMonths;
  // the categories' levels read only the months that hold a connected card's purchases as the newest one does
  // (`cardGap`), so they may have none while the month totals have theirs
  const usual = r.cardGap ? r.categories.some((c) => c.typicalCents !== null) : r.typicalCents !== null;
  const last = r.last !== null ? r.months[r.last]! : null;
  // with a gap the categories' levels read fewer months than the totals, so they do not add up to its level, shown under the months
  const footTypical = usual && !r.cardGap && r.typicalCents !== null ? eur(r.typicalCents) : null;
  const columns: Column<Row>[] = [
    { key: "label", label: t("rpt.sm_category"), kind: "text", rowHead: true, cell: (c) => c.label, csv: (c) => c.label },
    { key: "total", label: t("rpt.total"), kind: "money", main: true, sort: true, precision: "euros", cents: (c) => c.totalCents, bar: { tone: "spending", value: (c) => c.totalCents, max: Math.max(1, ...r.categories.map((c) => c.totalCents)) } },
    ...(usual
      ? ([
          { key: "typical", label: t("rpt.sm_typical"), kind: "money", sort: true, precision: "euros", cents: (c) => c.typicalCents },
          ...(last
            ? ([{ key: "last", label: t("rpt.sm_last", { month: monthLong(last) }), kind: "money", phone: "hide", sort: (c) => c.lastDiffCents, cell: (c) => (c.lastDiffCents === null ? "" : signedMoney(c.lastDiffCents)), csv: (c) => (c.lastDiffCents === null ? null : c.lastDiffCents / 100) }] satisfies Column<Row>[])
            : []),
        ] satisfies Column<Row>[])
      : []),
  ];
  return (
    <ReportPanel id={section.id} title={section.title} datum={inSpan(ctx, eur(r.totalCents))}>
      <ChartWithTable
        chart={
          <>
            <CategoryBars
              bars={r.categories.map((c) => ({ key: c.category, label: c.label, cents: c.totalCents, diffCents: usual && last ? c.lastDiffCents : null }))}
              diffLabel={t("rpt.sm_last", { month: last ? monthLong(last) : "" })}
              label={section.title}
            />
            <MonthColumns
              months={r.months.map((month, i) => ({ month, complete: r.complete[i]!, parts: [r.totals[i] ?? 0], totalCents: r.totals[i] ?? null }))}
              series={[{ key: "spend", label: t("home.months_spend") }]}
              tone="spending"
              usual={r.typicalCents === null ? null : { cents: r.typicalCents, label: t("home.months_usual", { sum: eur(r.typicalCents), months: r.typicalMonths }) }}
              running={ctx.running}
              label={t("rpt.sm_months")}
            />
          </>
        }
        table={
          <>
      <Table<Row>
        caption={section.title}
        rows={r.categories}
        rowKey={(c) => c.category}
        columns={columns}
        drill={(c) => (
          <OutsideFilter>
            <Detail row={c} r={r} ctx={ctx} />
          </OutsideFilter>
        )}
        drillLabel={(c) => c.label}
        total={{ label: t("rpt.total"), cells: { total: eur(r.totalCents), ...(footTypical ? { typical: footTypical } : {}) } }}
        search={false}
      />
      <Table<MonthRow>
        caption={t("rpt.sm_months")}
        captionVisible
        className="sm-months"
        rows={r.months.map((month, i) => ({ month, cents: r.totals[i] ?? null, complete: r.complete[i]!, savingsCents: r.fromSavings[i] ?? null }))}
        rowKey={(m) => m.month}
        columns={[
          { key: "month", label: t("rpt.month"), kind: "text", rowHead: true, cell: (m) => monthName({ ...m, unknown: m.cents === null }, ctx.running) },
          { key: "sum", label: t("rpt.sum"), kind: "money", main: true, precision: "euros", cents: (m) => m.cents },
          ...(r.fromSavings.some((c) => !!c) ? ([{ key: "savings", label: t("rpt.sm_from_savings"), kind: "money", precision: "euros", cents: (m) => m.savingsCents ?? null }] satisfies Column<MonthRow>[]) : []),
        ]}
        total={r.typicalCents !== null ? { label: t("rpt.sm_typical"), cells: { sum: eur(r.typicalCents) } } : undefined}
        toolbar={false}
        csv={false}
      />
          </>
        }
      />
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "kategoriat",
  get title() {
    return t("rpt.sec_categories");
  },
  order: 30,
  page: "reports",
  reports: ["spendingMonths"],
  // a period with no spending has no category to open
  visible: (ctx) => (ctx.data.spendingMonths?.categories.length ?? 0) > 0,
  open: true,
  Component: SpendingMonths,
};
