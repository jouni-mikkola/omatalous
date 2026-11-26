// Decision: is the household spending more than it earns, month after month, and is this month on its usual course
import { localeOf } from "@banking/core";
import { MonthBars } from "../../../charts/MonthBars.tsx";
import { answerMoney, language, monthLong } from "../../../format.ts";
import { t } from "../../../text.ts";
import type { ReportsData } from "../../../types.ts";
import type { ReactNode } from "react";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { ChartWithTable } from "../../../components/table/selection.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { monthName } from "../month-name.ts";
import { partialMonths } from "../partial-months.ts";
import { Lead, Strip, type StripItem } from "../Lead.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/** The gap of the complete months and what paid it, in one sentence: the paying parts above zero, in the order credit, savings, accounts and cards. */
function gapText(gap: NonNullable<ReportsData["cashflowMonths"]["gap"]>): string {
  const parts = [
    gap.creditCents > 0 ? t("rpt.gap_credit", { sum: answerMoney(gap.creditCents) }) : null,
    gap.savingsCents > 0 ? t("rpt.gap_savings", { sum: answerMoney(gap.savingsCents) }) : null,
    gap.accountsCents > 0 ? t("rpt.gap_accounts", { sum: answerMoney(gap.accountsCents) }) : null,
  ].filter((p): p is string => p !== null);
  const sum = answerMoney(gap.gapCents);
  return parts.length === 0 ? t("rpt.gap_lead", { sum }) : t("rpt.gap_cover", { sum, parts: new Intl.ListFormat(localeOf(language()), { type: "conjunction" }).format(parts) });
}

/**
 * What the complete months of the period came to: a sentence, the gap and what paid it when they took more than they
 * earned, else that the income covered them, and under it the strip of their income, their spending and the usual
 * month. Each figure is said once: the sentence names only the gap. Nothing without a complete month.
 */
export function CashflowLead({ ctx }: SectionProps) {
  const overview = ctx.data.cashflowMonths;
  if (!overview) return null;
  const { completeTotals: complete, gap, usualSpendCents } = overview;
  if (complete === null) return gap ? <Lead>{gapText(gap)}</Lead> : null;
  const count = String(complete.months);
  const { peak } = complete;
  const items: StripItem[] = [
    { label: t("rpt.strip_income", { months: count }), figure: answerMoney(complete.incomeCents), note: t("rpt.strip_income_average", { sum: answerMoney(complete.averageIncomeCents) }) },
    { label: t("rpt.strip_spent", { months: count }), figure: answerMoney(complete.spendCents), note: peak ? t("rpt.strip_spent_peak", { month: monthLong(peak.month), sum: answerMoney(peak.spendCents) }) : undefined },
    ...(usualSpendCents === null ? [] : [{ label: t("rpt.strip_usual"), figure: answerMoney(usualSpendCents), note: t("rpt.strip_usual_note", { months: String(overview.usualMonths) }) }]),
  ];
  return (
    <>
      <Lead>{gap ? gapText(gap) : t("rpt.lead_flows")}</Lead>
      <Strip items={items} />
    </>
  );
}

type Month = ReportsData["cashflowMonths"]["months"][number];

function Panel({ children }: { children: ReactNode }) {
  return (
    <ReportPanel id={section.id} title={section.title}>
      {children}
    </ReportPanel>
  );
}

/**
 * Tulot ja menot: the months of the chosen period as bars of income and spending (MonthBars), the running month marked
 * as not whole and the usual month's spending as a line. A month opens its rows. The months come from `cashflowMonths`,
 * which Yhteenveto's twelve months are built from too, so a month has one sum in both places. The sentence above it
 * (`CashflowLead`) says what the complete months came to.
 */
function Months({ ctx }: SectionProps) {
  const overview = ctx.data.cashflowMonths;
  if (!overview || overview.months.length === 0) return null;
  // a month's two bars have one look, and the other charts of the page draw the month the same way (`partialMonths`)
  const partial = partialMonths(ctx);
  const columns: Column<Month>[] = [
    { key: "month", label: t("rpt.month"), kind: "text", rowHead: true, cell: (m) => monthName({ ...m, unknown: m.incomeCents === null && m.spendCents === null }, ctx.running) },
    { key: "income", label: t("home.months_income"), kind: "money", precision: "euros", cents: (m) => m.incomeCents },
    { key: "spend", label: t("home.fig_spent"), kind: "money", main: true, precision: "euros", cents: (m) => m.spendCents },
  ];
  return (
    <Panel>
      <ChartWithTable
        title={t("table.folded_months")}
        rows={overview.months.length}
        chart={<MonthBars overview={overview} today={ctx.meta.today} incomePartial={partial} />}
        table={<Table<Month> caption={t("rpt.sec_cashflow")} rows={overview.months} rowKey={(m) => m.month} columns={columns} search={false} />}
      />
    </Panel>
  );
}

export const section: ReportSection = {
  id: "tulot-ja-menot",
  get title() {
    return t("rpt.sec_cashflow");
  },
  order: 10,
  page: "reports",
  // the income report is read for the months it counts incomplete (`partialMonths`), which hatch the bars
  reports: ["income", "cashflowMonths"],
  visible: (ctx) => ctx.meta.accounts.length > 0,
  open: true,
  Component: Months,
};
