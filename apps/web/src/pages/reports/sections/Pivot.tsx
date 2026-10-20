// Decision: find the month a category jumped
import { HeatGrid } from "../../../charts/forms/HeatGrid.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { HeatTable } from "../../../components/reports/HeatTable.tsx";
import { money, monthLong } from "../../../format.ts";
import { ExportLink, NEGATIVE_TOTAL_NOTE } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/** The answer: the month a category jumped most over its own average (core's `jump`), both figures the server's. */
function jumpAnswer(r: SectionProps["ctx"]["data"]["pivot"]) {
  if (r.peak === null) return "Kuukausien vertailuun ei ole vielä tarpeeksi valmiita kuukausia.";
  const j = r.jump;
  if (!j) return "Minkään kategorian menot eivät nousseet selvästi tavallista suuremmiksi.";
  return (
    <>
      {j.label}: {monthLong(r.months[j.month]!).replace(/^(\S+)/, "$1ssa")} meni <strong>{money(j.cents, false)}</strong>, tavallisesti {money(j.usualCents, false)} kuussa.
    </>
  );
}

function Pivot({ ctx }: SectionProps) {
  const r = ctx.data.pivot;
  // the strip's twelve complete months, or every month of a range too short for a strip
  const months = r.strip.length ? r.strip : r.months.map((_, i) => i);
  return (
    <ReportPanel id={section.id} title={section.title} datum={r.averageCents === null ? undefined : `Keskimäärin ${money(r.averageCents, false)} kuussa`} actions={<ExportLink href={ctx.exportHref("pivot")} />}>
      <QuestionChart id="kuukaudet-heat" question="Minä kuukautena jonkin kategorian menot nousivat selvästi?" answer={jumpAnswer(r)} table={<HeatTable r={r} />}>
        <HeatGrid r={r} months={months} />
      </QuestionChart>
      {r.rows.some((row) => row.totalCents < 0) && <p className="small muted">{NEGATIVE_TOTAL_NOTE}</p>}
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "kuukaudet",
  title: "Menot kuukausittain",
  order: 50,
  page: "reports",
  tab: "menot",
  reports: ["pivot"],
  Component: Pivot,
};
