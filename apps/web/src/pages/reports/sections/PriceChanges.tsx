// Decision: cancel or renegotiate a contract that got dearer
import { query } from "../../../api.ts";
import { date, money, signedMoney } from "../../../format.ts";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/bills.css";

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
  return (
    <Section id={section.id} title={section.title}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Saaja</th>
              <th className="hide-phone">Muuttunut</th>
              <th className="num">Aiempi hinta</th>
              <th className="num">Uusi hinta</th>
              <th className="num">Vuodessa</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((p) => (
              <tr key={`${p.merchant}-${p.date}`}>
                <td>
                  <a href={`#/transactions${query({ merchant: p.merchant })}`}>{p.merchant}</a>
                </td>
                <td className="hide-phone">{date(p.date)}</td>
                <td className="num">{money(p.fromCents)}</td>
                <td className="num">{money(p.toCents)}</td>
                <td className={`num ${p.yearlyEffectCents > 0 ? "worse" : "better"}`}>
                  <strong>{signedMoney(p.yearlyEffectCents)}</strong>
                </td>
              </tr>
            ))}
            {foot.map((f) => (
              <tr key={f.label} className="foot-row">
                <th scope="row">{f.label}</th>
                <td className="hide-phone" />
                <td />
                <td />
                <td className="num">{signedMoney(f.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export const section: ReportSection = {
  id: "hinnat",
  title: "Hinnanmuutokset",
  // right under Tilaukset, whose rows carry the price badges (the numbers are shared with the cards of pages/Bills.tsx)
  order: 30,
  page: "bills",
  reports: ["priceChanges"],
  // no price changed in the last year: the card would only say so
  visible: (ctx) => ctx.data.priceChanges.items.length > 0,
  Component: PriceChanges,
};
