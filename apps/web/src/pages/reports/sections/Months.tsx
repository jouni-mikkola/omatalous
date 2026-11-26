// Decision: is the household spending more than it earns, month after month, and is this month on its usual course
import { localeOf } from "@banking/core";
import { query } from "../../../api.ts";
import { MonthBars } from "../../../charts/MonthBars.tsx";
import { Empty } from "../../../components/ui/Empty.tsx";
import { Notice } from "../../../components/ui/Notice.tsx";
import { answerMoney, language, monthLong } from "../../../format.ts";
import { useApi } from "../../../hooks.ts";
import { periodRange } from "../../../period.ts";
import { t } from "../../../text.ts";
import type { DashboardData } from "../../../types.ts";
import type { ReactNode } from "react";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { ChartWithTable } from "../../../components/table/selection.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { monthName } from "../month-name.ts";
import { Lead, Strip, type StripItem } from "../Lead.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/** The gap of the complete months and what paid it, in one sentence: the paying parts above zero, in the order credit, savings, accounts and cards. */
function gapText(gap: NonNullable<DashboardData["overview"]["gap"]>): string {
  const parts = [
    gap.creditCents > 0 ? t("rpt.gap_credit", { sum: answerMoney(gap.creditCents) }) : null,
    gap.savingsCents > 0 ? t("rpt.gap_savings", { sum: answerMoney(gap.savingsCents) }) : null,
    gap.accountsCents > 0 ? t("rpt.gap_accounts", { sum: answerMoney(gap.accountsCents) }) : null,
  ].filter((p): p is string => p !== null);
  const sum = answerMoney(gap.gapCents);
  return parts.length === 0 ? t("rpt.gap_lead", { sum }) : t("rpt.gap_cover", { sum, parts: new Intl.ListFormat(localeOf(language()), { type: "conjunction" }).format(parts) });
}

/** The dashboard's answer for the page's sentence and its chart: one request, which both read. */
function useCashflow(ctx: SectionProps["ctx"]) {
  return useApi<DashboardData>(`/api/dashboard${query({ ...periodRange("month", ctx.meta.today), scope: ctx.scope })}`, true);
}

/**
 * What the complete months came to: a sentence, the gap and what paid it when they took more than they earned, else that
 * the income covered them, and under it the strip of their income, their spending and the usual month. Each figure is
 * said once: the sentence names only the gap. Nothing without a complete month.
 */
export function CashflowLead({ ctx }: SectionProps) {
  const { data } = useCashflow(ctx);
  if (!data) return null;
  const { overview } = data;
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

type Month = DashboardData["overview"]["months"][number];

function Panel({ children }: { children: ReactNode }) {
  return (
    <ReportPanel id={section.id} title={section.title}>
      {children}
    </ReportPanel>
  );
}

/**
 * Tulot ja menot: the last twelve months of income and spending as bars (MonthBars), the running month marked as not
 * whole and the usual month's spending as a line. A month opens its rows. The chart reads the `overview` of the
 * dashboard answer, the same one Yhteenveto's figures of the month come from, so a month has one sum in both places.
 * The sentence above it (`CashflowLead`) says what the complete months came to.
 */
function Months({ ctx }: SectionProps) {
  // the dashboard's answer, not the report answer `ctx.data` holds: this section names no report of its own
  const { data: dashboard, error } = useCashflow(ctx);
  if (error && !dashboard) return <Notice tone="error">{error}</Notice>;
  if (!dashboard) return <Panel><Empty>{t("rpt.loading")}</Empty></Panel>;
  if (dashboard.overview.months.length === 0) return null;
  // a month's two bars have one look: solid unless the spending or the income report counts the month incomplete; a month the income report leaves out stays solid
  const incomePartial = ctx.data.income ? new Set(ctx.data.income.months.flatMap((m) => (m.complete ? [] : [m.month]))) : undefined;
  const columns: Column<Month>[] = [
    { key: "month", label: t("rpt.month"), kind: "text", rowHead: true, cell: (m) => monthName({ ...m, unknown: m.incomeCents === null && m.spendCents === null }, ctx.running) },
    { key: "income", label: t("home.months_income"), kind: "money", precision: "euros", cents: (m) => m.incomeCents },
    { key: "spend", label: t("home.fig_spent"), kind: "money", main: true, precision: "euros", cents: (m) => m.spendCents },
  ];
  return (
    <Panel>
      <ChartWithTable
        title={t("table.folded_months")}
        rows={dashboard.overview.months.length}
        chart={<MonthBars overview={dashboard.overview} today={ctx.meta.today} incomePartial={incomePartial} />}
        table={<Table<Month> caption={t("rpt.sec_cashflow")} rows={dashboard.overview.months} rowKey={(m) => m.month} columns={columns} search={false} />}
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
  // the sentence above reads the average month of the income report (CashflowLead)
  reports: ["income"],
  visible: (ctx) => ctx.meta.accounts.length > 0,
  open: true,
  Component: Months,
};
