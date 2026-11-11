// Decision: whether this month is running over what it usually costs, and which days and categories to look at before it ends
import { type GapRow, joinRange, MIN_COMPARE_MONTHS, type ThisMonthReport } from "@banking/core";
import { approxText } from "../../../approx.ts";
import { KeyValue } from "../../../components/table/KeyValue.tsx";
import { Section } from "../../../components/Section.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { completeMonths, dayMonth, money, roundedMoney, signedMoney } from "../../../format.ts";
import { THIS_MONTH_ID } from "./ids.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";

/** The gap rows as a table: spent, expected and the difference, the difference adding up to the gap in the total row. */
function GapTable({ caption, first, rows, report }: { caption: string; first: string; rows: GapRow[]; report: ThisMonthReport }) {
  const columns: Column<GapRow>[] = [
    {
      key: "name",
      label: first,
      kind: "text",
      rowHead: true,
      cell: (r) => (r.day === null ? r.label : `${dayMonth(`${report.month}-${String(r.day).padStart(2, "0")}`)}${r.top ? ` · ${r.top.merchant} ${money(r.top.cents, false)}` : ""}`),
    },
    { key: "spent", label: t("rpt.tm_spent"), kind: "money", cell: (r) => money(r.spentCents, false) },
    { key: "expected", label: t("rpt.tm_expected"), kind: "money", cell: (r) => money(r.expectedCents, false) },
    { key: "gap", label: t("rpt.tm_gap"), kind: "money", main: true, cell: (r) => signedMoney(r.gapCents) },
  ];
  return (
    <Table<GapRow>
      caption={caption}
      captionVisible
      captionClass="month-cap"
      rows={rows}
      rowKey={(r) => `${r.category ?? ""}:${r.day ?? ""}:${r.label}`}
      columns={columns}
      drillButton={false}
      total={{ label: t("rpt.tm_gap_total"), cells: { spent: money(report.spentCents, false), expected: money(report.expectedCents ?? 0, false), gap: signedMoney(report.gapCents ?? 0) } }}
    />
  );
}

/** Why the month has no usual to stand against: too little history, or a linked card's purchases missing from the months before. Nothing when it has one. */
export function GapReasonNote({ reason, className = "month-note" }: { reason: ThisMonthReport["gapReason"]; className?: string }) {
  if (reason === "history") return <p className={className}>{t("rpt.tm_history", { months: completeMonths(MIN_COMPARE_MONTHS) })}</p>;
  if (reason === "cards") return <p className={className}>{t("rpt.tm_cards")}</p>;
  return null;
}

function ThisMonth({ ctx }: SectionProps) {
  const r = ctx.data.thisMonth;
  const { estimate } = r;
  // the spent, expected and gap figures stand in the verdict above: the facts are what it leaves out
  const facts: [string, string][] = [
    ...(r.stillComingCents === null ? [] : ([[t("rpt.tm_f_coming"), money(r.stillComingCents, false)]] as [string, string][])),
    ...(estimate ? ([[t("rpt.tm_f_estimate"), joinRange(roundedMoney(estimate.lowCents), roundedMoney(estimate.highCents))]] as [string, string][]) : []),
  ];
  return (
    <Section id={section.id} title={section.title} datum={estimate ? joinRange(roundedMoney(estimate.lowCents), roundedMoney(estimate.highCents)) : undefined}>
      {facts.length > 0 && <KeyValue items={facts} />}
      <GapReasonNote reason={r.gapReason} />
      {estimate && (
        <p className="month-note">{t("rpt.tm_estimate_note")}</p>
      )}
      {r.gapCents !== null && r.days.length > 0 && <GapTable caption={t("rpt.tm_days_caption")} first={t("rpt.tm_day")} rows={r.days} report={r} />}
      {r.gapCents !== null && r.categories.length > 0 && <GapTable caption={t("rpt.tm_cats_caption")} first={t("rpt.tm_cat")} rows={r.categories} report={r} />}
      {r.bills.length > 0 && (
        <Table
          caption={t("rpt.tm_bills_caption")}
          captionVisible
          captionClass="month-cap"
          rows={r.bills}
          rowKey={(b) => `${b.date}:${b.merchant}`}
          columns={[
            { key: "date", label: t("rpt.tm_day"), kind: "text", rowHead: true, cell: (b) => `${dayMonth(b.date)}${b.late ? t("rpt.tm_late") : ""}` },
            { key: "payee", label: t("rpt.payee"), kind: "text", cell: (b) => b.merchant },
            { key: "sum", label: t("rpt.sum"), kind: "money", main: true, cell: (b) => approxText(money(b.cents, false), b.estimate) },
          ]}
          drillButton={false}
          total={{ label: t("rpt.total"), cells: { sum: money(r.billsCents, false) } }}
        />
      )}
      {r.bills.length > 0 && r.otherComingCents !== null && r.otherComingCents !== 0 && (
        <p className="month-note">{t(r.otherComingCents > 0 ? "rpt.tm_other_more" : "rpt.tm_other_less", { amount: money(Math.abs(r.otherComingCents), false) })}</p>
      )}
      {r.earlierBillsCents > 0 && r.stillComingCents !== null && <p className="month-note">{t("rpt.tm_earlier", { amount: money(r.earlierBillsCents, false) })}</p>}
    </Section>
  );
}

export const section: ReportSection = {
  id: THIS_MONTH_ID,
  get title() {
    return t("rpt.sec_thismonth");
  },
  order: 10,
  page: "reports",
  reports: ["thisMonth"],
  Component: ThisMonth,
};
