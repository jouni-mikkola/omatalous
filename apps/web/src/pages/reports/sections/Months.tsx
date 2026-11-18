// Decision: is the household spending more than it earns, month after month, and is this month on its usual course
import { localeOf } from "@banking/core";
import { query } from "../../../api.ts";
import { MonthBars } from "../../../charts/MonthBars.tsx";
import { Empty } from "../../../components/ui/Empty.tsx";
import { Notice } from "../../../components/ui/Notice.tsx";
import { answerMoney, language } from "../../../format.ts";
import { useApi } from "../../../hooks.ts";
import { periodRange } from "../../../period.ts";
import { t } from "../../../text.ts";
import type { DashboardData } from "../../../types.ts";
import type { ReactNode } from "react";
import type { ReportSection, SectionProps } from "../types.ts";

/** The gap of the complete months and what paid it, in one sentence: the paying parts above zero, in the order credit, savings, accounts and cards. */
function gapText(gap: NonNullable<DashboardData["overview"]["gap"]>): string {
  const parts = [
    gap.creditCents > 0 ? t("rpt.gap_credit", { sum: answerMoney(gap.creditCents) }) : null,
    gap.savingsCents > 0 ? t("rpt.gap_savings", { sum: answerMoney(gap.savingsCents) }) : null,
    gap.accountsCents > 0 ? t("rpt.gap_accounts", { sum: answerMoney(gap.accountsCents) }) : null,
  ].filter((p): p is string => p !== null);
  const lead = t("rpt.gap_lead", { sum: answerMoney(gap.gapCents) });
  return parts.length === 0 ? lead : `${lead} ${t("rpt.gap_cover", { parts: new Intl.ListFormat(localeOf(language()), { type: "conjunction" }).format(parts) })}`;
}

/** The page is named for this section, so the card keeps the name for a reader of the page's regions and draws no second heading. */
function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="card" id={section.id} aria-label={section.title}>
      {children}
    </section>
  );
}

/**
 * Tulot ja menot: the last twelve months of income and spending as bars (MonthBars), the running month marked as not
 * whole and the usual month's spending as a line. A month opens its rows. The chart reads the `overview` of the
 * dashboard answer, the same one Yhteenveto's figures of the month come from, so a month has one sum in both places.
 * When the complete months took more than they earned, one sentence under the chart says by how much and what paid it.
 */
function Months({ ctx }: SectionProps) {
  // the dashboard's answer, not the report answer `ctx.data` holds: this section names no report of its own
  const { data: dashboard, error } = useApi<DashboardData>(`/api/dashboard${query({ ...periodRange("month", ctx.meta.today), scope: ctx.scope })}`, true);
  if (error && !dashboard) return <Notice tone="error">{error}</Notice>;
  if (!dashboard) return <Panel><Empty>{t("rpt.loading")}</Empty></Panel>;
  if (dashboard.overview.months.length === 0) return null;
  return (
    <Panel>
      <MonthBars overview={dashboard.overview} today={ctx.meta.today} />
      {dashboard.overview.gap && <p>{gapText(dashboard.overview.gap)}</p>}
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
