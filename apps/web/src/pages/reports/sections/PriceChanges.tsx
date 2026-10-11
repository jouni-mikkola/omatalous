// Decision: cancel or renegotiate a contract that got dearer
import { query } from "../../../api.ts";
import { date, money, signedMoney } from "../../../format.ts";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/** Prices and loan instalments apart: a smaller instalment after a rate cut is not a cheaper price. */
function PriceChanges({ ctx }: SectionProps) {
  const r = ctx.data.priceChanges;
  const isDebt = (id: string) => ctx.meta.categories.find((c) => c.id === id)?.kind === "debt";
  const parts = [
    r.items.some((p) => !isDebt(p.category)) ? `Hinnat yhteensä ${signedMoney(r.totalYearlyEffectCents)} vuodessa` : null,
    r.items.some((p) => isDebt(p.category)) ? `lainojen erät ${signedMoney(r.debtYearlyEffectCents)} vuodessa` : null,
  ].filter((s): s is string => s !== null);
  const sub = parts.length ? parts.join(", ") : undefined;
  return (
    <Section id={section.id} title={section.title} sub={sub ? `${sub.charAt(0).toUpperCase()}${sub.slice(1)}` : undefined}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Kauppias</th>
              <th className="num">Ennen → nyt</th>
              <th className="num">Vuodessa</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((p) => (
              <tr key={`${p.merchant}-${p.date}`}>
                <td>
                  <a href={`#/transactions${query({ merchant: p.merchant })}`}>{p.merchant}</a>
                  <div className="sub">
                    {ctx.label(p.category)} · {date(p.date)}
                  </div>
                </td>
                <td className="num">
                  {money(p.fromCents)} → {money(p.toCents)}
                </td>
                <td className={`num ${p.yearlyEffectCents > 0 ? "worse" : "better"}`}>
                  <strong>{signedMoney(p.yearlyEffectCents)}</strong>
                </td>
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
