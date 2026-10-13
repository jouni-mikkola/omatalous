// Decision: cancel or renegotiate a contract that got dearer
import { query } from "../../../api.ts";
import { date, money, signedMoney } from "../../../format.ts";
import { printedEuroCents } from "../../../components/bills/series.tsx";
import { Section } from "../../../components/Section.tsx";
import { addsUp } from "../../../marks.ts";
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
  const partClass = (i: number) => (!bracket ? undefined : i === 0 ? "part-first" : i === r.items.length - 1 ? "part-last" : undefined);
  return (
    <Section id={section.id} title={section.title}>
      <div className="table-wrap">
        <table className="ruled">
          <thead>
            <tr>
              <th>Saaja</th>
              <th className="hide-phone">Muuttunut</th>
              <th className="num">Aiempi hinta</th>
              <th className="num">Uusi hinta</th>
              <th className="num">Vuodessa</th>
            </tr>
          </thead>
          <tbody className={bracket ? "adds-up" : undefined}>
            {r.items.map((p, i) => (
              <tr key={`${p.merchant}-${p.date}`} className={partClass(i)}>
                <td>
                  <a href={`#/transactions${query({ merchant: p.merchant })}`}>{p.merchant}</a>
                </td>
                <td className="hide-phone">{date(p.date)}</td>
                <td className="num">{money(p.fromCents)}</td>
                <td className="num">{money(p.toCents)}</td>
                <td className={`num sum ${p.yearlyEffectCents > 0 ? "worse" : "better"}`}>
                  <strong>{signedMoney(p.yearlyEffectCents)}</strong>
                </td>
              </tr>
            ))}
            {foot.map((f) => (
              <tr key={f.label} className="foot-row">
                <th scope="row">{f.label}</th>
                <td className="hide-phone" />
                <td className="num" />
                <td className="num" />
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
  // beside Harvinaiset laskut, after the contracts and the savings (the numbers are shared with the cards of pages/Bills.tsx)
  order: 55,
  page: "bills",
  reports: ["priceChanges"],
  // no price changed in the last year: the card would only say so
  visible: (ctx) => ctx.data.priceChanges.items.length > 0,
  Component: PriceChanges,
};
