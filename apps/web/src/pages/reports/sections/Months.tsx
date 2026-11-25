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
  const { gap, months, usualSpendCents } = overview;
  const complete = months.filter((m) => m.complete && m.incomeCents !== null && m.spendCents !== null);
  if (complete.length === 0) return gap ? <Lead>{gapText(gap)}</Lead> : null;
  const sum = (cents: (m: (typeof complete)[number]) => number | null) => complete.reduce((total, m) => total + (cents(m) ?? 0), 0);
  const count = String(complete.length);
  const average = ctx.data.income?.monthlyCents ?? null;
  const peak = complete.length > 1 ? complete.reduce((a, b) => (b.spendCents! > a.spendCents! ? b : a)) : null;
  const items: StripItem[] = [
    { label: t("rpt.strip_income", { months: count }), figure: answerMoney(sum((m) => m.incomeCents)), note: average === null ? undefined : t("rpt.strip_income_average", { sum: answerMoney(average) }) },
    { label: t("rpt.strip_spent", { months: count }), figure: answerMoney(sum((m) => m.spendCents)), note: peak ? t("rpt.strip_spent_peak", { month: monthLong(peak.month), sum: answerMoney(peak.spendCents!) }) : undefined },
    ...(usualSpendCents === null ? [] : [{ label: t("rpt.strip_usual"), figure: answerMoney(usualSpendCents), note: t("rpt.strip_usual_note", { months: String(overview.usualMonths) }) }]),
  ];
  return (
    <>
      <Lead>{gap ? gapText(gap) : t("rpt.lead_flows")}</Lead>
      <Strip items={items} />
    </>
  );
}

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
  return (
    <Panel>
      <MonthBars overview={dashboard.overview} today={ctx.meta.today} />
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
  reports: [],
  visible: (ctx) => ctx.meta.accounts.length > 0,
  open: true,
  Component: Months,
};
