// Decision: how much of the household's life is paid with credit or savings, and how large a cut would end it (reads moneyFlow)
import { MoneyFlow } from "../../../charts/forms/MoneyFlow.tsx";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { ChartWithTable } from "../../../components/table/selection.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { money } from "../../../format.ts";
import type { ReportsData } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";

type Band = ReportsData["moneyFlow"]["sources"][number];

/** One side of the picture as a list: the bands and their equal total. */
function Side({ caption, bands, totalCents }: { caption: string; bands: Band[]; totalCents: number }) {
  const columns: Column<Band>[] = [
    { key: "band", label: caption, kind: "text", rowHead: true, cell: (b) => b.label, csv: (b) => b.label },
    { key: "sum", label: t("rpt.sum"), kind: "money", main: true, precision: "cents", cents: (b) => b.cents },
  ];
  return <Table<Band> caption={caption} rows={bands} rowKey={(b) => b.id} columns={columns} total={{ label: t("rpt.total"), cells: { sum: money(totalCents) } }} search={false} toolbar={false} csv={false} />;
}

function MoneyFlowSection({ ctx }: SectionProps) {
  const r = ctx.data.moneyFlow;
  return (
    <ReportPanel id={section.id} title={section.title}>
      <ChartWithTable
        rows={r.sources.length + r.uses.length}
        chart={<MoneyFlow sources={r.sources} uses={r.uses} label={t("rpt.mf_chart")} />}
        table={
          <>
            <Side caption={t("rpt.mf_sources")} bands={r.sources} totalCents={r.totalCents} />
            <Side caption={t("rpt.mf_uses")} bands={r.uses} totalCents={r.totalCents} />
          </>
        }
      />
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "rahan-kulku",
  get title() {
    return t("rpt.mf_title");
  },
  order: 15,
  page: "reports",
  reports: ["moneyFlow"],
  // a period with no money moving has no picture
  visible: (ctx) => (ctx.data.moneyFlow?.totalCents ?? 0) > 0,
  open: true,
  Component: MoneyFlowSection,
};
