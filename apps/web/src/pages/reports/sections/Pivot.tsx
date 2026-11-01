// Decision: whether a category's high month was a one-off to let go or a new level to cut
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { HeatTable } from "../../../components/reports/HeatTable.tsx";
import { money, monthLongIn } from "../../../format.ts";
import { LONG_LIST_ROWS } from "../../../components/table/view.ts";
import { ExportLink, negativeTotalNote } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import { rich, t } from "../../../text.ts";

/** The answer: the month a category jumped most over its own average (core's `jump`), both figures the server's. */
function jumpAnswer(r: SectionProps["ctx"]["data"]["pivot"]) {
  if (r.peak === null) return t("rpt.pivot_none");
  const j = r.jump;
  if (!j) return t("rpt.pivot_flat");
  return rich("rpt.pivot_jump", { label: j.label, month: monthLongIn(r.months[j.month]!), amount: money(j.cents, false), expected: money(j.expectedCents, false) });
}

function Pivot({ ctx }: SectionProps) {
  const r = ctx.data.pivot;
  return (
    <ReportPanel id={section.id} title={section.title} datum={r.averageCents === null ? undefined : t("rpt.pivot_avg", { amount: money(r.averageCents, false) })} actions={r.rows.length > LONG_LIST_ROWS ? <ExportLink href={ctx.exportHref("pivot")} /> : undefined}>
      <p className="qc-a">{jumpAnswer(r)}</p>
      <HeatTable r={r} />
      {r.rows.some((row) => row.totalCents < 0) && <p className="small muted">{negativeTotalNote()}</p>}
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "kuukaudet",
  get title() {
    return t("rpt.sec_pivot");
  },
  order: 50,
  page: "reports",
  reports: ["pivot"],
  Component: Pivot,
};
