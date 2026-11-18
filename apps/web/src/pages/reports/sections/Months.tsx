// Decision: is the household spending more than it earns, month after month, and is this month on its usual course
import { query } from "../../../api.ts";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { MonthBars } from "../../../charts/MonthBars.tsx";
import { Empty } from "../../../components/ui/Empty.tsx";
import { Notice } from "../../../components/ui/Notice.tsx";
import { useApi } from "../../../hooks.ts";
import { periodRange } from "../../../period.ts";
import { t } from "../../../text.ts";
import type { DashboardData } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";

/**
 * Tulot ja menot: the last twelve months of income and spending as bars (MonthBars), the running month marked as not
 * whole and the usual month's spending as a line. A month opens its rows. The chart reads the `overview` of the
 * dashboard answer, the same one Yhteenveto's figures of the month come from, so a month has one sum in both places.
 */
function Months({ ctx }: SectionProps) {
  const { data, error } = useApi<DashboardData>(`/api/dashboard${query({ ...periodRange("month", ctx.meta.today), scope: ctx.scope })}`, true);
  if (error && !data) return <Notice tone="error">{error}</Notice>;
  if (!data) return <ReportPanel id={section.id} title={section.title}><Empty>{t("rpt.loading")}</Empty></ReportPanel>;
  if (data.overview.months.length === 0) return null;
  return (
    <ReportPanel id={section.id} title={section.title}>
      <MonthBars overview={data.overview} today={ctx.meta.today} />
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "tulot-ja-menot",
  get title() {
    return t("rpt.sec_cashflow");
  },
  order: 20,
  page: "reports",
  reports: [],
  visible: (ctx) => ctx.meta.accounts.length > 0,
  open: true,
  Component: Months,
};
