// Decision: how much of the household's life is paid with credit or savings, and how large a cut would end it (reads moneyFlow)
import { useState } from "react";
import { MoneyFlow, MoneyFlowMonths } from "../../../charts/forms/MoneyFlow.tsx";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { ChartWithTable } from "../../../components/table/selection.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { answerMoney, money, monthLongIn } from "../../../format.ts";
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

/** The filter of Tapahtumat that lists the rows of a band, for the bands that are the rows of one category; the others are sums with no rows of their own. */
function rowsFilter(band: Band): string | null {
  if (band.id.startsWith("category:") && !band.id.endsWith(":returned")) return `category=${encodeURIComponent(band.id.slice("category:".length))}`;
  if (band.id === "credit") return "category=credit_draw";
  return null;
}

function MoneyFlowSection({ ctx }: SectionProps) {
  const r = ctx.data.moneyFlow;
  const [pickedMonth, pick] = useState<string | null>(null);
  const month = r.months.find((m) => m.month === pickedMonth) ?? null;
  const shown = month ?? { ...r, from: ctx.range.from, to: ctx.range.to, creditCents: r.sources.find((b) => b.id === "credit")?.cents ?? 0 };
  const hero = month
    ? t("rpt.mf_hero_month", { month: monthLongIn(month.month).replace(/^./, (c) => c.toUpperCase()), credit: answerMoney(month.creditCents) })
    : t("rpt.mf_hero", { months: r.monthCount, credit: answerMoney(shown.creditCents), perMonth: answerMoney(r.creditPerMonthCents) });
  const href = (band: Band) => {
    const filter = rowsFilter(band);
    return filter ? `#/transactions?${filter}&from=${shown.from}&to=${shown.to}` : null;
  };
  return (
    <ReportPanel id={section.id} title={section.title}>
      {shown.creditCents > 0 && <p className="mf-hero">{hero}</p>}
      {r.months.length > 1 && <MoneyFlowMonths months={r.months.map((m) => m.month)} picked={month?.month ?? null} onPick={pick} />}
      <ChartWithTable
        rows={shown.sources.length + shown.uses.length}
        chart={<MoneyFlow sources={shown.sources} uses={shown.uses} href={href} />}
        table={
          <>
            <Side caption={t("rpt.mf_sources")} bands={shown.sources} totalCents={shown.totalCents} />
            <Side caption={t("rpt.mf_uses")} bands={shown.uses} totalCents={shown.totalCents} />
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
