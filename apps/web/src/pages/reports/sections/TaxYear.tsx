// Decision: which rows of one calendar year the household checks against the pre-filled tax return, and whether a refund or a residual tax is on the accounts
import { messageIn, taxYearCsv, type TaxRow } from "@banking/core";
import "../../../styles/sheets.css";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { SheetActions } from "../../../components/SheetActions.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { date, language } from "../../../format.ts";
import { t } from "../../../text.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { TAX_YEAR_ID } from "./ids.ts";

/** The rows are checked against the return to the cent, so they print cents: whole euros here would round one row differently than the income table does, which rounds its sources together. */
const rowColumns = (): Column<TaxRow>[] => [
  { key: "name", label: t("sheet.name"), kind: "text", rowHead: true, cell: (r) => r.name },
  { key: "date", label: t("sheet.date"), kind: "date", cell: (r) => date(r.date) },
  { key: "amount", label: t("sheet.amount"), kind: "money", main: true, precision: "cents", cents: (r) => r.cents },
];

/** A part with no rows is left out: a "no rows" line under a heading says nothing the household can act on. */
function Rows({ caption, rows, note }: { caption: string; rows: readonly TaxRow[]; note?: string }) {
  if (rows.length === 0) return null;
  return (
    <>
      <h3 className="sheet-part">{caption}</h3>
      {note && <p className="sheet-note">{note}</p>}
      <Table<TaxRow> caption={caption} rows={rows} rowKey={(r) => r.id} columns={rowColumns()} toolbar={false} />
    </>
  );
}

function TaxYear({ ctx }: SectionProps) {
  const r = ctx.data.taxYear;
  const say = (code: Parameters<typeof messageIn>[1], params?: Record<string, string | number>) => messageIn(language(), code, params as never);
  return (
    <ReportPanel id={section.id} title={t("tax.title")} actions={<SheetActions id={section.id} name={t("tax.csv_name")} csv={() => taxYearCsv(r, say, ctx.label)} />}>
      <p>{t("tax.intro", { year: r.year })}</p>
      {r.partial && <p className="sheet-note">{t("tax.partial", { from: date(r.range.from), to: date(r.range.to) })}</p>}
      <Rows caption={t("tax.refunds")} rows={r.refunds.rows} />
      <Rows caption={t("tax.interest")} rows={r.interest.rows} note={t("tax.interest_note")} />
      {r.loanPayments.length > 0 && (
        <>
          <h3 className="sheet-part">{t("tax.loans")}</h3>
          <p className="sheet-note">{t("tax.loans_note")}</p>
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
      <Rows caption={t("tax.household")} rows={r.household.rows} note={t("tax.household_note")} />
      <Rows caption={t("tax.residual")} rows={r.residual.rows} note={t("tax.residual_note")} />
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
  visible: ({ data: { taxYear: r } }) => r.income.types.length + r.refunds.rows.length + r.interest.rows.length + r.loanPayments.length + r.household.rows.length + r.residual.rows.length > 0,
  Component: TaxYear,
};
