import { LineChart } from "../../../charts/LineChart.tsx";
import { monthLabel } from "../../../format.ts";
import { Section } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

function Balances({ ctx }: SectionProps) {
  const r = ctx.data.balances;
  const colors = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-5)", "var(--series-6)", "var(--series-7)"];
  return (
    <Section section={section} sub="Kuukauden lopussa">
      <LineChart
        labels={r.months.map((m) => monthLabel(m, m.endsWith("-01")))}
        series={r.accounts.slice(0, 6).map((a, i) => ({ key: a.accountId, label: a.name, color: colors[i]!, values: a.values }))}
      />
    </Section>
  );
}

export const section: ReportSection = {
  id: "saldot",
  title: "Saldot",
  order: 110,
  reports: ["balances"],
  visible: (ctx) => ctx.data.balances.accounts.length > 0,
  Component: Balances,
};
