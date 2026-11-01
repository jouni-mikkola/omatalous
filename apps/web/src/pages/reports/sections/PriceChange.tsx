// Decision: whether the household's own fixed prices rose faster than prices in general, and so whether to renegotiate or change provider rather than accept the rise
import { localeOf, type PriceChangeMonth, type PriceChangeService } from "@banking/core";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { date, language, seriesName, monthLong, percent } from "../../../format.ts";
import { t } from "../../../text.ts";
import type { ReportSection, SectionProps } from "../types.ts";

const points = (x: number): string => x.toLocaleString(localeOf(language()), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function PriceChange({ ctx }: SectionProps) {
  const r = ctx.data.priceChange;
  const panel = (body: string) => (
    <ReportPanel id={section.id} title={t("prices.title")}>
      <p>{body}</p>
    </ReportPanel>
  );
  if (r.status === "no_index") return panel(t("prices.off"));
  if (r.status === "no_basket") return panel(t("prices.no_basket", { month: monthLong(r.baseMonth!) }));
  if (r.status === "short_index") return panel(t("prices.short", { from: monthLong(r.baseMonth ?? ""), to: monthLong(r.lastMonth ?? "") }));
  const base = r.baseMonth!;
  const last = r.lastMonth!;
  const gap = r.relativeChange!;
  const code = Math.abs(gap) < 0.0005 ? "prices.answer_same" : gap > 0 ? "prices.answer_more" : "prices.answer_less";
  const answer = t(code, { own: percent(r.ownChange!, 1), index: percent(r.indexChange!, 1), gap: percent(Math.abs(gap), 1), from: monthLong(base), to: monthLong(last) });
  const monthColumns: Column<PriceChangeMonth>[] = [
    { key: "month", label: t("prices.col_month"), kind: "text", rowHead: true, cell: (m) => monthLong(m.month) },
    { key: "own", label: t("prices.col_own"), kind: "money", cents: (m) => Math.round(m.ownCents) },
    { key: "index", label: t("prices.col_index"), kind: "count", cell: (m) => points(m.indexPoints) },
    { key: "relative", label: t("prices.col_relative"), kind: "count", main: true, cell: (m) => points(m.relative * 100) },
  ];
  const serviceColumns: Column<PriceChangeService>[] = [
    { key: "service", label: t("prices.col_service"), kind: "text", rowHead: true, cell: (s) => seriesName(s.id) ?? s.merchant },
    { key: "from", label: t("prices.col_from"), kind: "money", cents: (s) => s.fromCents },
    { key: "to", label: t("prices.col_to"), kind: "money", main: true, cents: (s) => s.toCents },
    { key: "change", label: t("prices.col_change"), kind: "count", cell: (s) => percent(s.toCents / s.fromCents - 1, 1) },
  ];
  return (
    <ReportPanel id={section.id} title={t("prices.title")}>
      <p>{answer}</p>
      <Table<PriceChangeService> caption={t("prices.caption_services")} rows={r.services} rowKey={(s) => s.id} columns={serviceColumns} toolbar={false} />
      <Table<PriceChangeMonth> caption={t("prices.caption_months")} rows={r.months} rowKey={(m) => m.month} columns={monthColumns} toolbar={false} />
      <p className="muted">{t("prices.basis", { month: monthLong(base), source: r.source!.name, table: r.source!.table, date: date(r.source!.fetchedAt) })}</p>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "hintakehitys",
  // read when drawn, so the nav follows the member's language
  get title() {
    return t("prices.title");
  },
  order: 70,
  page: "reports",
  reports: ["priceChange"],
  // without the index only the admin can do something about it (Asetukset > Palvelin)
  visible: (ctx) => ctx.data.priceChange?.status !== "no_index" || ctx.meta.user.role === "admin",
  Component: PriceChange,
};
