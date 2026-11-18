// Decision: which rows of one calendar year the household checks against the pre-filled tax return, and whether a refund or a residual tax is on the accounts
import { formatFiRange, messageIn, taxYearCsv, type TaxRow } from "@banking/core";
import "../../../styles/sheets.css";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { SheetActions } from "../../../components/SheetActions.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { date, language, money } from "../../../format.ts";
import { t } from "../../../text.ts";
import type { ReportsData } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { TAX_YEAR_ID } from "./ids.ts";

/** The rows are checked against the return to the cent, so they print cents: whole euros here would round one row differently than the income table does, which rounds its sources together. */
const rowColumns = (): Column<TaxRow>[] => [
  { key: "name", label: t("sheet.name"), kind: "text", rowHead: true, cell: (r) => r.name },
  { key: "date", label: t("sheet.date"), kind: "date", cell: (r) => date(r.date) },
  { key: "amount", label: t("sheet.amount"), kind: "money", main: true, precision: "cents", cents: (r) => r.cents },
];

type TaxIncomeRow = ReportsData["taxYear"]["income"]["types"][number];

/** The income of the year by source, the sum the income report gives for each type; the sheet prints it with the rest. */
const incomeColumns = (): Column<TaxIncomeRow>[] => [
  { key: "name", label: t("sheet.name"), kind: "text", rowHead: true, cell: (r) => r.label },
  { key: "amount", label: t("sheet.amount"), kind: "money", main: true, precision: "cents", cents: (r) => r.totalCents },
];

/** A part with no rows is left out: a "no rows" line under a heading says nothing the household can act on. A sum that is not known stays, so it never reads as nothing. */
function Rows({ caption, rows, total }: { caption: string; rows: readonly TaxRow[]; total?: { label: string; cents: number | null } }) {
  if (rows.length === 0 && total?.cents !== null) return null;
  return (
    <>
      <h3 className="sheet-part">{caption}</h3>
      <Table<TaxRow> caption={caption} rows={rows} rowKey={(r) => r.id} columns={rowColumns()} total={total && { label: total.label, cells: { amount: total.cents === null ? "–" : money(total.cents) } }} toolbar={false} />
    </>
  );
}

function TaxYear({ ctx }: SectionProps) {
  const r = ctx.data.taxYear;
  const say = (code: Parameters<typeof messageIn>[1], params?: Record<string, string | number>) => messageIn(language(), code, params as never);
  return (
    <ReportPanel id={section.id} title={t("tax.title")} datum={formatFiRange(r.range.from, r.range.to, language())} actions={<SheetActions id={section.id} name={t("tax.csv_name")} csv={() => taxYearCsv(r, say, ctx.label)} />}>
      {r.income.types.length > 0 && (
        <>
          <h3 className="sheet-part">{t("tax.income")}</h3>
          <Table<TaxIncomeRow>
            caption={t("tax.income")}
            rows={r.income.types}
            rowKey={(x) => x.type}
            columns={incomeColumns()}
            total={{ label: t("sheet.total"), cells: { amount: money(r.income.totalCents) } }}
            toolbar={false}
          />
        </>
      )}
      <Rows caption={t("tax.refunds")} rows={r.refunds.rows} />
      <Rows caption={t("tax.interest")} rows={r.interest.rows} total={{ label: t("sheet.total"), cents: r.interest.cents }} />
      {r.loanPayments.length > 0 && (
        <>
          <h3 className="sheet-part">{t("tax.loans")}</h3>
          <Table<(typeof r.loanPayments)[number]>
            caption={t("tax.loans")}
            rows={r.loanPayments}
            rowKey={(p) => p.category}
            columns={[
              { key: "category", label: t("tax.category"), kind: "text", rowHead: true, cell: (p) => ctx.label(p.category) },
              { key: "count", label: t("tax.count"), kind: "count", cell: (p) => String(p.count) },
              { key: "amount", label: t("sheet.amount"), kind: "money", main: true, cents: (p) => p.cents },
            ]}
            toolbar={false}
          />
        </>
      )}
      <Rows caption={t("tax.household")} rows={r.household.rows} total={{ label: t("tax.household_total"), cents: r.household.cents }} />
      <Rows caption={t("tax.residual")} rows={r.residual.rows} />
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: TAX_YEAR_ID,
  // read when drawn, so the nav follows the member's language
  get title() {
    return t("tax.title");
  },
  order: 140,
  page: "reports",
  reports: ["taxYear"],
  // a year with nothing to check against the tax return has no card
  visible: ({ data: { taxYear: r } }) => r.interest.cents === null || r.income.types.length + r.refunds.rows.length + r.interest.rows.length + r.loanPayments.length + r.household.rows.length + r.residual.rows.length > 0,
  Component: TaxYear,
};
