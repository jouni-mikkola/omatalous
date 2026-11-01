// Decision: which fixed cost or subscription to cancel or renegotiate
import { query } from "../../../api.ts";
import { Section } from "../../../components/Section.tsx";
import { Table } from "../../../components/table/Table.tsx";
import { date, decimalMax1, money, seriesName, signedMoney } from "../../../format.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";

const merchantLink = (merchant: string, name = merchant) => <a href={`#/transactions${query({ merchant })}`}>{name}</a>;

/** "(12,99 € − 9,99 €) × 12 = 36 €": the yearly effect of a price change as the sum the household can check. */
const calcLine = (p: { fromCents: number; toCents: number; charges: number; yearlyEffectCents: number }) =>
  `(${money(p.toCents)} − ${money(p.fromCents)}) × ${decimalMax1(p.charges)} = ${signedMoney(p.yearlyEffectCents)}`;

function FixedCosts({ ctx }: SectionProps) {
  const r = ctx.data.fixedCosts;
  return (
    <>
      <Section id={section.id} title={section.title} datum={t("rpt.fc_datum", { month: money(r.monthlyCents, false), year: money(r.yearlyCents, false) })}>
        <Table
          caption={t("rpt.fc_calc_caption")}
          rows={r.rows}
          rowKey={(x) => x.id}
          search={false}
          csv={false}
          columns={[
            { key: "merchant", label: t("rpt.fc_payment"), kind: "text", rowHead: true, cell: (x) => merchantLink(x.merchant, seriesName(x.id) ?? x.merchant) },
            { key: "category", label: t("rpt.tm_cat"), kind: "text", phone: "hide", cell: (x) => ctx.label(x.category) },
            { key: "month", label: t("rpt.fc_per_month"), kind: "money", main: true, cents: (x) => x.monthlyCents },
            { key: "year", label: t("rpt.fc_per_year"), kind: "money", cents: (x) => x.yearlyCents },
          ]}
          total={{ label: t("rpt.total"), cells: { month: money(r.monthlyCents), year: money(r.yearlyCents) } }}
        />
      </Section>
      {r.priceChanges.length > 0 && (
        <Section id="kiinteat-hinnat" title={t("rpt.fc_prices")} datum={t("rpt.fc_prices_datum", { amount: signedMoney(r.priceYearlyEffectCents) })}>
          <Table
            caption={t("rpt.fc_prices_caption")}
            rows={r.priceChanges}
            rowKey={(p) => p.id}
            columns={[
              { key: "merchant", label: t("rpt.fc_payment"), kind: "text", rowHead: true, cell: (p) => merchantLink(p.merchant, seriesName(p.id) ?? p.merchant) },
              { key: "date", label: t("rpt.fc_changed"), kind: "date", phone: "hide", cell: (p) => date(p.date) },
              { key: "calc", label: t("rpt.fc_calc"), kind: "text", cell: (p) => calcLine(p) },
              { key: "year", label: t("rpt.fc_per_year"), kind: "money", main: true, className: (p) => (p.yearlyEffectCents > 0 ? "worse" : "better"), cell: (p) => <strong>{signedMoney(p.yearlyEffectCents)}</strong> },
            ]}
          />
          {r.priceChanges.some((p) => p.debt) && <p className="muted">{t("rpt.fc_debt_note")}</p>}
        </Section>
      )}
      {r.overlaps.length > 0 && (
        <Section id="kiinteat-paallekkaiset" title={t("rpt.fc_overlaps")}>
          <Table
            caption={t("rpt.fc_overlaps_caption")}
            rows={r.overlaps}
            rowKey={(o) => o.type}
            columns={[
              { key: "noun", label: t("rpt.fc_service"), kind: "text", rowHead: true, cell: (o) => t(`rpt.fc_kind_${o.type}`) },
              { key: "who", label: t("rpt.fc_payments"), kind: "text", cell: (o) => o.merchants.join(", ") },
              { key: "month", label: t("rpt.fc_per_month"), kind: "money", main: true, cents: (o) => o.monthlyCents },
            ]}
          />
        </Section>
      )}
      {r.ended.length > 0 && (
        <Section id="kiinteat-paattyneet" title={t("rpt.fc_ended")} datum={t("rpt.fc_ended_datum", { amount: money(r.endedMonthlyCents, false) })}>
          <Table
            caption={t("rpt.fc_ended_caption")}
            rows={r.ended}
            rowKey={(e) => `${e.merchant}-${e.lastDate}`}
            columns={[
              { key: "merchant", label: t("rpt.fc_payment"), kind: "text", rowHead: true, cell: (e) => merchantLink(e.merchant) },
              { key: "last", label: t("rpt.fc_last"), kind: "date", cell: (e) => date(e.lastDate) },
              { key: "month", label: t("rpt.fc_per_month"), kind: "money", main: true, cents: (e) => e.monthlyCents },
              { key: "year", label: t("rpt.fc_per_year"), kind: "money", cents: (e) => e.yearlyCents },
            ]}
            total={{ label: t("rpt.total"), cells: { month: money(r.endedMonthlyCents), year: money(r.endedYearlyCents) } }}
          />
        </Section>
      )}
    </>
  );
}

export const section: ReportSection = {
  id: "kiinteat-menot",
  get title() {
    return t("rpt.sec_fixedcosts");
  },
  order: 50,
  page: "reports",
  reports: ["fixedCosts"],
  visible: (ctx) => ctx.data.fixedCosts.rows.length > 0,
  Component: FixedCosts,
};
