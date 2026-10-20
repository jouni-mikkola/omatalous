// Decision: cancel or renegotiate a contract that got dearer
import { query } from "../../../api.ts";
import { date, signedMoney } from "../../../format.ts";
import { Section } from "../../../components/Section.tsx";
import { DataTable } from "../../../components/table/DataTable.tsx";
import { addsUp, printedEuroCents } from "../../../marks.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/bills.css";

/** What `signedMoney` prints as euros: under a euro it is none, else the nearest euro. */
const printedPrice = (cents: number): number => (Math.abs(cents) < 100 ? 0 : printedEuroCents(cents));

/**
 * Prices and loan instalments apart: a smaller instalment after a rate cut is not a cheaper price. So the table ends in
 * one foot row for the prices, "Yhteensä", and one for the loans, "Lainojen erät", each under the column Vuodessa.
 */
function PriceChanges({ ctx }: SectionProps) {
  const r = ctx.data.priceChanges;
  const isDebt = (id: string) => ctx.meta.categories.find((c) => c.id === id)?.kind === "debt";
  const foot = [
    r.items.some((p) => !isDebt(p.category)) ? { label: "Yhteensä", cents: r.totalYearlyEffectCents } : null,
    r.items.some((p) => isDebt(p.category)) ? { label: "Lainojen erät", cents: r.debtYearlyEffectCents } : null,
  ].filter((f): f is { label: string; cents: number } => f !== null);
  // the bracket joins the rows to Yhteensä only when no loan row is among them and the euros printed add up
  const bracket = foot.length === 1 && foot[0]!.label === "Yhteensä" && addsUp(r.items.map((p) => printedPrice(p.yearlyEffectCents)), printedPrice(r.totalYearlyEffectCents));
  return (
    <Section id={section.id} title={section.title}>
      <div className="table-wrap">
        <DataTable
          id="hinnat"
          caption="Hinnanmuutokset, vuosivaikutus saajittain"
          rows={r.items}
          rowKey={(p) => `${p.merchant}-${p.date}`}
          sums={bracket ? ["year"] : undefined}
          total={foot.map((f) => ({
            label: f.label,
            cells: { year: signedMoney(f.cents) },
          }))}
          columns={[
            {
              key: "merchant",
              label: "Saaja",
              kind: "text",
              rowHead: true,
              sortValue: (p) => p.merchant,
              cell: (p) => <a href={`#/transactions${query({ merchant: p.merchant })}`}>{p.merchant}</a>,
            },
            {
              key: "date",
              label: "Muuttunut",
              kind: "date",
              phone: "hide",
              sortValue: (p) => p.date,
              cell: (p) => date(p.date),
            },
            {
              key: "from",
              label: "Aiempi hinta",
              kind: "money",
              precision: "cents",
              cents: (p) => p.fromCents,
            },
            {
              key: "to",
              label: "Uusi hinta",
              kind: "money",
              precision: "cents",
              cents: (p) => p.toCents,
            },
            {
              key: "year",
              label: "Vuodessa",
              kind: "money",
              main: true,
              className: (p) => (p.yearlyEffectCents > 0 ? "worse" : "better"),
              sortValue: (p) => p.yearlyEffectCents,
              cell: (p) => <strong>{signedMoney(p.yearlyEffectCents)}</strong>,
            },
          ]}
        />
      </div>
    </Section>
  );
}

export const section: ReportSection = {
  id: "hinnat",
  title: "Hinnanmuutokset",
  // beside Harvinaiset laskut, after the contracts and the savings (the numbers are shared with the cards of pages/Bills.tsx)
  order: 55,
  page: "bills",
  reports: ["priceChanges"],
  // no price changed in the last year: the card would only say so
  visible: (ctx) => ctx.data.priceChanges.items.length > 0,
  Component: PriceChanges,
};
