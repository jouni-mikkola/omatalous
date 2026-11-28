// Decision: which category to cut: its sum over the period, how its newest month stands against its level, and the months and payees behind it
import { monthEnd, YEAR_MONTHS } from "@banking/core";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { KeyValue } from "../../../components/table/KeyValue.tsx";
import { SparkCell } from "../../../components/table/Cells.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { query } from "../../../api.ts";
import { money, monthLong, plural, signedMoney } from "../../../format.ts";
import type { ReportsData } from "../../../types.ts";
import { inSpan } from "../parts.tsx";
import type { ReportContext, ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";
import { monthName } from "../month-name.ts";

type Report = ReportsData["spendingMonths"];
type Row = Report["categories"][number];
type MonthRow = { month: string; cents: number | null; complete: boolean };
type PayeeRow = Row["payees"][number] & { rest?: boolean };

const eur = (cents: number) => money(cents, false);

/** Months a category needs before its line is drawn: under three it says nothing a figure does not. */
const MIN_SPARK_MONTHS = 3;

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
  // the dot is marked only for a month above the level: a fall of spending is no warning
  const risen = (c: Row) => c.lastOff && (c.lastDiffCents ?? 0) > 0;
  const last = r.last !== null ? r.months[r.last]! : null;
  // a line of the newest twelve months up to the newest complete one, so its dot is the month the level is read against
  const from = r.last === null ? 0 : Math.max(0, r.last + 1 - YEAR_MONTHS);
  const columns: Column<Row>[] = [
    { key: "label", label: t("rpt.sm_category"), kind: "text", rowHead: true, cell: (c) => c.label, csv: (c) => c.label },
    ...(usual && r.last !== null
      ? ([
          {
            key: "spark",
            label: t("rpt.sm_spark"),
            kind: "text",
            csv: false,
            // the dashed line is the category's own level, not the sum of the usual month
            cell: (c) => {
              const values = c.values.slice(from, r.last! + 1);
              if (values.filter((v) => v !== null).length < MIN_SPARK_MONTHS) return null;
              const level = c.typicalCents;
              return (
                <SparkCell
                  values={values}
                  usual={level}
                  off={risen(c)}
                  label={level === null ? t("rpt.sm_spark_plain", { name: c.label, sum: eur(c.values[r.last!] ?? 0) }) : t("rpt.sm_spark_of", { name: c.label, sum: eur(c.values[r.last!] ?? 0), usual: eur(level) })}
                />
              );
            },
          },
        ] satisfies Column<Row>[])
      : []),
    { key: "total", label: t("rpt.total"), kind: "money", main: true, sort: true, precision: "euros", cents: (c) => c.totalCents, bar: { tone: "spending", value: (c) => c.totalCents, max: Math.max(1, ...r.categories.map((c) => c.totalCents)) } },
    ...(usual && last
      ? ([{ key: "last", label: t("rpt.sm_last", { month: monthLong(last) }), kind: "money", phone: "hide", sort: (c) => c.lastDiffCents, cell: (c) => (c.lastDiffCents === null || Math.round(c.lastDiffCents / 100) === 0 ? "" : signedMoney(Math.round(c.lastDiffCents / 100) * 100)), csv: (c) => (c.lastDiffCents === null ? null : c.lastDiffCents / 100) }] satisfies Column<Row>[])
      : []),
  ];
  return (
    <ReportPanel id={section.id} title={section.title} datum={inSpan(ctx, plural(r.categories.length, t("rpt.u_category"), t("rpt.u_categories")))}>
      <Table<Row>
        className="sm-table"
        caption={section.title}
        rows={r.categories}
        rowKey={(c) => c.category}
        columns={columns}
        drill={(c) => <Detail row={c} r={r} ctx={ctx} />}
        drillLabel={(c) => c.label}
        total={{ label: t("rpt.total"), cells: { total: eur(r.totalCents) } }}
        search={false}
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
  reports: ["spendingMonths", "figureParts"],
  // a period with no spending has no category to open
  visible: (ctx) => (ctx.data.spendingMonths?.categories.length ?? 0) > 0,
  open: true,
  Component: SpendingMonths,
};
