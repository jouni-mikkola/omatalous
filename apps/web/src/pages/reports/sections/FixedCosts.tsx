// Decision: what a month costs before any choice, and which contract, subscription or loan instalment to cancel or renegotiate
import { parseSeriesId } from "@banking/core";
import { query } from "../../../api.ts";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { KeyValue } from "../../../components/table/KeyValue.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { CADENCE_LABEL, date, money, percent, seriesName } from "../../../format.ts";
import type { ReportsData } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";

type Report = ReportsData["fixedCosts"];
type Row = Report["rows"][number];
type Payment = Row["payments"][number];

/** A series' name as Laskut says it: a product among several of its payee carries its price. */
const nameOf = (row: Row): string => seriesName(row.id) ?? row.merchant;

/**
 * The rows of Tapahtumat behind a line: the payee's rows on the account the series is charged to, on one day or all of
 * them. The filter is the one Laskut opens a bill's history with.
 */
export function rowsHref(row: Pick<Row, "id" | "merchant">, day?: string): string {
  return `#/transactions${query({ merchant: row.merchant, accountId: parseSeriesId(row.id)?.accountId || undefined, from: day, to: day })}`;
}

/** Under a line: what one charge is and when, then the payments of the last twelve months as core listed them, each a link to its day. */
function Detail({ row }: { row: Row }) {
  const columns: Column<Payment>[] = [
    { key: "day", label: t("table.day"), kind: "text", rowHead: true, cell: (p) => <a href={rowsHref(row, p.date)}>{date(p.date)}</a> },
    { key: "sum", label: t("rpt.sum"), kind: "money", main: true, precision: "cents", cents: (p) => p.amountCents },
  ];
  return (
    <div className="fc-detail">
      <KeyValue
        items={[
          [t("bills.amount"), money(row.chargeCents)],
          ...(row.cadence ? ([[t("bills.frequency"), CADENCE_LABEL[row.cadence] ?? "–"]] as const) : []),
          [t("bills.last"), date(row.lastDate)],
          ...(row.nextDate ? ([[t("bills.next"), date(row.nextDate)]] as const) : []),
        ]}
      />
      {row.payments.length > 0 && (
        <Table<Payment>
          caption={t("rpt.fc_paid", { name: nameOf(row) })}
          captionVisible
          rows={row.payments}
          rowKey={(p) => p.id}
          columns={columns}
          total={{ label: t("rpt.total"), cells: { sum: money(row.paidCents) } }}
          toolbar={false}
          csv={false}
        />
      )}
      {/* Tapahtumat filters by payee and account: for one product among several of a payee it would list the others
          too, so such a line has only its days, as Laskut has */}
      {parseSeriesId(row.id)?.product == null && (
        <Button variant="link" href={rowsHref(row)}>
          {t("table.drill_open")}
        </Button>
      )}
    </div>
  );
}

function FixedCosts({ ctx }: SectionProps) {
  const r = ctx.data.fixedCosts;
  if (!r.rows.length) {
    return (
      <ReportPanel id={section.id} title={section.title}>
        <p className="muted">{t("rpt.fc_empty")}</p>
      </ReportPanel>
    );
  }
  const columns: Column<Row>[] = [
    { key: "name", label: t("rpt.fc_payment"), kind: "text", rowHead: true, cell: nameOf, csv: nameOf },
    { key: "category", label: t("rpt.sm_category"), kind: "text", cell: (x) => ctx.label(x.category), csv: (x) => ctx.label(x.category) },
    { key: "month", label: t("rpt.fc_per_month"), kind: "money", main: true, precision: "cents", cents: (x) => x.monthlyCents, bar: { value: (x) => x.monthlyCents, max: Math.max(1, ...r.rows.map((x) => x.monthlyCents)) } },
    // a phone's block is a name and its sum over its category (docs/design/README.md section 4); the year is twelve
    // months and stands in the heading above the table
    { key: "year", label: t("rpt.fc_per_year"), kind: "money", precision: "cents", phone: "hide", cents: (x) => x.yearlyCents },
  ];
  return (
    <ReportPanel id={section.id} title={section.title} datum={t("rpt.fc_datum", { month: money(r.monthlyCents, false), year: money(r.yearlyCents, false) })}>
      {r.fixedShare !== null && r.incomeMonthlyCents !== null && <p className="muted">{t("rpt.fc_share", { label: r.fixedShareLabel, share: percent(r.fixedShare), income: money(r.incomeMonthlyCents, false) })}</p>}
      <Table<Row>
        caption={t("rpt.fc_calc_caption")}
        rows={r.rows}
        rowKey={(x) => x.id}
        columns={columns}
        drill={(x) => <Detail row={x} />}
        drillLabel={nameOf}
        total={{ label: t("rpt.total"), cells: { month: money(r.monthlyCents), year: money(r.yearlyCents) } }}
        search={false}
      />
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "kiinteat-menot",
  get title() {
    return t("rpt.sec_fixedcosts");
  },
  order: 50,
  page: "reports",
  reports: ["fixedCosts"],
  // the costs are those of the series running today, whatever period is chosen
  ofToday: ["fixedCosts"],
  // a household with accounts and no series yet is told so in a line; without accounts there is nothing to say
  visible: (ctx) => (ctx.data.fixedCosts?.rows.length ?? 0) > 0 || ctx.meta.accounts.length > 0 || (ctx.scope === "household" && ctx.meta.sharedAccounts.length > 0),
  Component: FixedCosts,
};
