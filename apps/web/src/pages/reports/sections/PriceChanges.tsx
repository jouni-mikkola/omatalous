import { query } from "../../../api.ts";
import { date, money, signedMoney } from "../../../format.ts";
import { Section } from "../parts.tsx";
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
    <Section section={section} sub={sub ? `${sub.charAt(0).toUpperCase()}${sub.slice(1)}` : undefined}>
      {r.items.length ? (
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
      ) : (
        <div className="empty">Ei hinnanmuutoksia viimeisen vuoden aikana.</div>
      )}
    </Section>
  );
}

export const section: ReportSection = {
  id: "hinnat",
  title: "Hinnanmuutokset",
  order: 80,
  reports: ["priceChanges"],
  Component: PriceChanges,
};
