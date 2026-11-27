// Decision: is the household spending more than it earns, month after month, and is this month on its usual course
import { MonthBars } from "../../../charts/MonthBars.tsx";
import { answerMoney, signedMoney } from "../../../format.ts";
import { spentLabel, t } from "../../../text.ts";
import type { ReportsData } from "../../../types.ts";
import type { ReactNode } from "react";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { ChartWithTable } from "../../../components/table/selection.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { monthName } from "../month-name.ts";
import { partialMonths } from "../partial-months.ts";
import { KeyValue, type Fact } from "../../../components/table/KeyValue.tsx";
import { Tiles, type TileItem } from "../../../components/Tiles.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

type Gap = NonNullable<ReportsData["cashflowMonths"]["gap"]>;

/** The gap of the complete months as a tile, and what paid it as facts: the paying parts above zero, in the order credit, savings, accounts and cards. */
function gapTile(gap: Gap): { tile: TileItem; sources: Fact[] } {
  const sources: Fact[] = [
    [t("rpt.gap_credit"), answerMoney(gap.creditCents)],
    [t("rpt.gap_savings"), answerMoney(gap.savingsCents)],
    [t("rpt.gap_accounts"), answerMoney(gap.accountsCents)],
  ];
  const paid = [gap.creditCents, gap.savingsCents, gap.accountsCents];
  return { tile: { label: t("rpt.gap_tile"), figure: answerMoney(gap.gapCents), tone: "bad", note: t("rpt.gap_tile_note") }, sources: sources.filter((_, i) => paid[i]! > 0) };
}

/**
 * What the complete months of the period came to, as tiles. The first is the answer, in colour: the gap when they took
 * more than they earned, with what paid it under the tiles, else the income less the spending. Then their income with
 * its average month and their spending with the usual month. Nothing without a complete month or a gap.
 */
export function CashflowLead({ ctx }: SectionProps) {
  const overview = ctx.data.cashflowMonths;
  if (!overview) return null;
  const { completeTotals: complete, gap, usualSpendCents } = overview;
  const gapParts = gap ? gapTile(gap) : null;
  const sources = gapParts && gapParts.sources.length > 0 && (
    <>
      <p className="strip-note">{t("rpt.gap_sources")}</p>
      <KeyValue items={gapParts.sources} />
    </>
  );
  if (complete === null) return gapParts ? <><Tiles items={[gapParts.tile]} />{sources}</> : null;
  const count = String(complete.months);
  const net: TileItem = { label: t("rpt.strip_net", { months: count }), figure: signedMoney(complete.netCents), tone: complete.netCents < 0 ? "bad" : "good", note: t("rpt.strip_average", { sum: signedMoney(complete.averageNetCents) }) };
  const items: TileItem[] = [
    gapParts ? gapParts.tile : net,
    { label: t("rpt.strip_income", { months: count }), figure: answerMoney(complete.incomeCents), note: t("rpt.strip_average", { sum: answerMoney(complete.averageIncomeCents) }) },
    { label: t("rpt.strip_spent", { months: count }), figure: answerMoney(complete.spendCents), note: usualSpendCents === null ? undefined : t("rpt.strip_spent_usual", { sum: answerMoney(usualSpendCents) }) },
  ];
  return (
    <>
      <Tiles items={items} />
      {sources}
    </>
  );
}

type Month = ReportsData["cashflowMonths"]["months"][number];

function Panel({ children }: { children: ReactNode }) {
  return (
    <ReportPanel id={section.id} title={section.title}>
      {children}
    </ReportPanel>
  );
}

/**
 * Tulot ja menot: the months of the chosen period as bars of income and spending (MonthBars), the running month marked
 * as not whole and the usual month's spending as a line. A month opens its rows. The months come from `cashflowMonths`,
 * which Yhteenveto's twelve months are built from too, so a month has one sum in both places. The tiles above it
 * (`CashflowLead`) say what the complete months came to.
 */
function Months({ ctx }: SectionProps) {
  const overview = ctx.data.cashflowMonths;
  if (!overview || overview.months.length === 0) return null;
  // a month's two bars have one look, and the other charts of the page draw the month the same way (`partialMonths`)
  const partial = partialMonths(ctx);
  const columns: Column<Month>[] = [
    { key: "month", label: t("rpt.month"), kind: "text", rowHead: true, cell: (m) => monthName({ ...m, unknown: m.incomeCents === null && m.spendCents === null }, ctx.running) },
    { key: "income", label: t("home.months_income"), kind: "money", precision: "euros", cents: (m) => m.incomeCents },
    { key: "spend", label: spentLabel(overview.months.some((m) => m.fromSavingsCents)), kind: "money", main: true, precision: "euros", cents: (m) => m.spendCents },
  ];
  return (
    <Panel>
      <ChartWithTable
        title={t("table.folded_months")}
        rows={overview.months.length}
        chart={<MonthBars overview={overview} today={ctx.meta.today} incomePartial={partial} />}
        table={<Table<Month> caption={t("rpt.sec_cashflow")} rows={overview.months} rowKey={(m) => m.month} columns={columns} search={false} />}
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
  // the income report is read for the months it counts incomplete (`partialMonths`), which hatch the bars
  reports: ["income", "cashflowMonths"],
  visible: (ctx) => ctx.meta.accounts.length > 0,
  open: true,
  Component: Months,
};
