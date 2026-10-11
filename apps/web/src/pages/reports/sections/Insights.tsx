// Decision: what is worth changing first
import { query } from "../../../api.ts";
import { money, signedMoney } from "../../../format.ts";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/** Every insight that passed its gate, largest yearly figure first: the overview shows the first three. */
function Insights({ ctx }: SectionProps) {
  const r = ctx.data.insights;
  return (
    <Section id={section.id} title={section.title}>
      {r.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Havainto</th>
                <th className="num">Vuodessa</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.link ? <a href={`#/transactions${query({ ...i.link })}`}>{i.title}</a> : i.title}
                    <div className="sub">{i.detail}</div>
                  </td>
                  <td className="num">
                    <strong>{i.direction ? signedMoney(i.direction * i.yearlyCents) : money(i.yearlyCents, false)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          Tähän tulevat hinnankorotukset, päättyneet ja uudet maksut sekä osamaksut. Vuosivertailut
          tarvitsevat 18–24 kuukautta historiaa, nyt sitä on {r.months} kuukautta.
        </div>
      )}
    </Section>
  );
}

export const section: ReportSection = {
  id: "havainnot",
  title: "Havainnot",
  order: 15,
  page: "reports",
  reports: ["insights"],
  Component: Insights,
};
