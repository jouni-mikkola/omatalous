// Decision: whether the income holds: what came in over the period, from which kind of income, which payer and which payments, and in which months
import { MonthColumns } from "../../../charts/forms/MonthColumns.tsx";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { query } from "../../../api.ts";
import { date, money, percent } from "../../../format.ts";
import type { ReportsData } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";

type Report = ReportsData["income"];
type Row = Report["types"][number];
type Payer = Row["payers"][number];
type Payment = Payer["rows"][number];

/** One payment in Tapahtumat: its day and the payer's name. The list there holds every row of that name on the day. */
export const paymentHref = (payer: string, day: string): string => `#/transactions${query({ merchant: payer, from: day, to: day })}`;

/**
 * Under a payer: the payments the sum is made of, as core counted them. Tapahtumat cannot list them by a filter (a
 * name pays and is paid, and one payment can be split between two kinds), so they are listed here and each opens its day.
 */
function Payments({ payer }: { payer: Payer }) {
  const columns: Column<Payment>[] = [
    { key: "day", label: t("ui.day"), kind: "text", rowHead: true, cell: (p) => <a href={paymentHref(payer.payer, p.date)}>{date(p.date)}</a> },
    { key: "sum", label: t("rpt.sum"), kind: "money", main: true, precision: "cents", cents: (p) => p.amountCents },
  ];
  return <Table<Payment> caption={t("rpt.in_payments", { payer: payer.payer })} rows={payer.rows} rowKey={(p) => `${p.id}:${p.amountCents}`} columns={columns} toolbar={false} csv={false} />;
}

/** Under a kind of income: who paid it. The payers add up to the kind, and a payer opens its payments. */
function Payers({ row }: { row: Row }) {
  const columns: Column<Payer>[] = [
    { key: "payer", label: t("rpt.in_payer"), kind: "text", rowHead: true, cell: (p) => p.payer },
    { key: "count", label: t("rpt.sm_rows"), kind: "count", cell: (p) => p.payments },
    { key: "sum", label: t("rpt.sum"), kind: "money", main: true, precision: "cents", cents: (p) => p.totalCents },
  ];
  return <Table<Payer> caption={t("rpt.in_payers", { label: row.label })} rows={row.payers} rowKey={(p) => p.payer} columns={columns} drill={(p) => <Payments payer={p} />} drillLabel={(p) => p.payer} toolbar={false} csv={false} />;
}

function Income({ ctx }: SectionProps) {
  const r = ctx.data.income;
  // a kind's share of all the money in, a ratio of two figures of the answer
  const share = (ty: Row) => (r.totalCents > 0 ? ty.totalCents / r.totalCents : 0);
  const columns: Column<Row>[] = [
    { key: "type", label: t("rpt.in_type"), kind: "text", rowHead: true, cell: (ty) => ty.label, csv: (ty) => ty.label },
    { key: "bar", label: t("rpt.fd_share"), headHidden: true, kind: "text", phone: "hide", csv: false, bar: { tone: "income", value: share, max: 1 } },
    { key: "share", label: t("rpt.fd_share"), kind: "share", phone: "hide", cell: (ty) => percent(share(ty)), csv: (ty) => share(ty) },
    { key: "total", label: ctx.span ?? t("rpt.total"), kind: "money", main: true, precision: "cents", cents: (ty) => ty.totalCents },
  ];
  return (
    <ReportPanel id={section.id} title={section.title}>
      <>
          <MonthColumns
            months={r.months.map((m, i) => ({ month: m.month, complete: m.complete, parts: r.kinds.map((k) => k.months[i] ?? 0), totalCents: m.totalCents, against: m.againstAverage }))}
            series={r.kinds.map((k) => ({ key: k.id, label: k.label }))}
            tone="income"
            usual={r.monthlyCents === null ? null : { cents: r.monthlyCents, label: t("rpt.in_average_line", { sum: money(r.monthlyCents, false) }), short: t("rpt.in_average_line", { sum: money(r.monthlyCents, false) }) }}
            running={ctx.running}
            label={t("rpt.in_months")}
          />
      <Table<Row>
        caption={t("rpt.in_types")}
        className="in-types"
        rows={r.types}
        rowKey={(ty) => ty.type}
        columns={columns}
        drill={(ty) => <Payers row={ty} />}
        drillLabel={(ty) => ty.label}
        total={{ label: t("rpt.total"), cells: { share: r.totalCents > 0 ? percent(1) : "", total: money(r.totalCents) } }}
        search={false}
        toolbar={false}
        csv={false}
      />
      </>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "tulot",
  get title() {
    return t("rpt.in_types");
  },
  order: 20,
  page: "reports",
  reports: ["income"],
  // a period with no money in has nothing to list
  visible: (ctx) => (ctx.data.income?.types.length ?? 0) > 0,
  open: true,
  Component: Income,
};
