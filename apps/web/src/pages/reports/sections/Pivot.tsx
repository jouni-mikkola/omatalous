// Decision: find the month a category jumped
import { useState } from "react";
import { HeatTable } from "../../../components/reports/HeatTable.tsx";
import { MonthsView } from "../../../components/reports/MonthsView.tsx";
import { Section } from "../../../components/Section.tsx";
import { TableToggle } from "../../../components/TableToggle.tsx";
import { ExportLink, NEGATIVE_TOTAL_NOTE } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/** Kaavio is the months by theme and Taulukko the table of every category by every month, as it was. */
function Pivot({ ctx }: SectionProps) {
  const r = ctx.data.pivot;
  const [table, setTable] = useState(false);
  return (
    <Section
      id={section.id}
      title={section.title}
      actions={
        <>
          <TableToggle table={table} onChange={setTable} />
          <ExportLink href={ctx.exportHref("pivot")} />
        </>
      }
    >
      {table ? <HeatTable r={r} /> : <MonthsView r={r} range={ctx.range} />}
      {r.rows.some((row) => row.totalCents < 0) && <p className="small muted">{NEGATIVE_TOTAL_NOTE}</p>}
    </Section>
  );
}

export const section: ReportSection = {
  id: "kuukaudet",
  title: "Menot kuukausittain",
  order: 50,
  page: "reports",
  reports: ["pivot"],
  Component: Pivot,
};
