// Decision: which rows of one calendar year the household checks against the pre-filled tax return, and whether a refund or a residual tax is on the accounts
import { formatFiRange, messageIn, spendingLabel, taxYearCsv, type TaxRow } from "@banking/core";
import { type ReactNode, useState } from "react";
import "../../styles/sheets.css";
import { query } from "../../api.ts";
import { SheetActions } from "../../components/SheetActions.tsx";
import { type Column, Table } from "../../components/table/Table.tsx";
import { Empty } from "../../components/ui/Empty.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { Section } from "../../components/Section.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { date, language, money } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { t } from "../../text.ts";
import type { Meta, ReportsData } from "../../types.ts";

type TaxYearReport = ReportsData["taxYear"];

/** The rows are checked against the return to the cent, so they print cents: whole euros here would round one row differently than the income table does, which rounds its sources together. */
const rowColumns = (): Column<TaxRow>[] => [
  { key: "name", label: t("sheet.name"), kind: "text", rowHead: true, cell: (r) => r.name },
  { key: "date", label: t("sheet.date"), kind: "date", cell: (r) => date(r.date) },
  { key: "amount", label: t("sheet.amount"), kind: "money", main: true, precision: "cents", cents: (r) => r.cents },
];

type TaxIncomeRow = TaxYearReport["income"]["types"][number];

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

/** A year with nothing to check against the tax return has no rows to list. An interest sum that is not known counts as something. */
export const hasTaxRows = (r: TaxYearReport): boolean =>
  r.interest.cents === null || r.income.types.length + r.refunds.rows.length + r.interest.rows.length + r.loanPayments.length + r.household.rows.length + r.residual.rows.length > 0;

/** The sheet of one year: its tables, with Tulosta and Lataa CSV in the head of the card. `yearChoice` stands above the tables and is left out of the print. */
export function TaxYearSheet({ r, label, yearChoice }: { r: TaxYearReport; label: (categoryId: string) => string; yearChoice?: ReactNode }) {
  const say = (code: Parameters<typeof messageIn>[1], params?: Record<string, string | number>) => messageIn(language(), code, params as never);
  const rows = hasTaxRows(r);
  return (
    <Section id={SETTINGS_ANCHOR.taxYear} title={t("tax.title")} datum={formatFiRange(r.range.from, r.range.to, language())} actions={rows ? <SheetActions id={SETTINGS_ANCHOR.taxYear} name={t("tax.csv_name")} csv={() => taxYearCsv(r, say, label)} /> : undefined}>
      {yearChoice && <div className="sheet-year">{yearChoice}</div>}
      {!rows && <Empty>{t("tax.none")}</Empty>}
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
              { key: "category", label: t("tax.category"), kind: "text", rowHead: true, cell: (p) => label(p.category) },
              { key: "count", label: t("tax.count"), kind: "count", cell: (p) => String(p.count) },
              { key: "amount", label: t("sheet.amount"), kind: "money", main: true, cents: (p) => p.cents },
            ]}
            toolbar={false}
          />
        </>
      )}
      <Rows caption={t("tax.household")} rows={r.household.rows} total={{ label: t("tax.household_total"), cents: r.household.cents }} />
      <Rows caption={t("tax.residual")} rows={r.residual.rows} />
    </Section>
  );
}

type YearChoice = "this" | "last";

/**
 * Asetukset > Tiedot: the rows of this year or last year against the tax return, an export of the member's own accounts and
 * not a report. It reads the report `taxYear` of the server for the whole calendar year (the server stops at today).
 */
export function TaxYear({ meta }: { meta: Meta }) {
  const [choice, setChoice] = useState<YearChoice>("this");
  const year = Number(meta.today.slice(0, 4)) - (choice === "last" ? 1 : 0);
  const { data, error } = useApi<Pick<ReportsData, "taxYear">>(`/api/reports${query({ from: `${year}-01-01`, to: `${year}-12-31`, scope: "own", reports: "taxYear" })}`);
  if (!data) {
    return error ? (
      <Section id={SETTINGS_ANCHOR.taxYear} title={t("tax.title")}>
        <Notice tone="error">{error}</Notice>
      </Section>
    ) : null;
  }
  const label = (id: string) => {
    const c = meta.categories.find((x) => x.id === id);
    return c ? spendingLabel(c, language()) : id;
  };
  const yearChoice = (
    <Segmented
      label={t("tax.title")}
      value={choice}
      onChange={setChoice}
      options={[
        { value: "this", label: t("period.year") },
        { value: "last", label: t("period.last_year") },
      ]}
    />
  );
  return <TaxYearSheet r={data.taxYear} label={label} yearChoice={yearChoice} />;
}
