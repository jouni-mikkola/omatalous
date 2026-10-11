// Decision: find why a category rose and cap it
import { monthEnd } from "@banking/core";
import { query } from "../../../api.ts";
import { money, MONTHS_SHORT, signedMoney } from "../../../format.ts";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/** ["2026-07", "2026-08", "2026-09"] → "heinä–syyskuu 2026" */
function monthSpan(months: readonly string[]): string {
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const name = (m: string) => MONTHS_SHORT[Number(m.slice(5, 7)) - 1]!;
  return first.slice(0, 4) === last.slice(0, 4) ? `${name(first)}–${name(last)}kuu ${last.slice(0, 4)}` : `${name(first)}kuu ${first.slice(0, 4)}–${name(last)}kuu ${last.slice(0, 4)}`;
}

/** Categories that sat above their own level for three months. The card is only shown when there are some (`visible`). */
function Drift({ ctx }: SectionProps) {
  const r = ctx.data.drift;
  return (
    <Section id={section.id} title={section.title} sub={`Tavallista kalliimpi kolme kuukautta peräkkäin, ${monthSpan(r.months)}`}>
      <p className="lead">{r.advice}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Kategoria</th>
              <th className="num">Tavallisesti kuussa</th>
              <th className="num">Nyt kuussa</th>
              <th className="num">Vuodessa</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((i) => (
              <tr key={i.category}>
                <td>
                  <a href={`#/transactions${query({ category: i.category, from: `${i.months[0]}-01`, to: monthEnd(i.months[i.months.length - 1]!) })}`}>{ctx.label(i.category)}</a>
                </td>
                <td className="num muted">{money(i.usualCents, false)}</td>
                <td className="num">{money(i.recentCents, false)}</td>
                <td className="num worse">
                  <strong>{signedMoney(i.extraYearlyCents)}</strong>
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
  id: "nousseet",
  title: "Nousseet menot",
  order: 40,
  page: "reports",
  reports: ["drift"],
  // a card that only says nothing rose supports no decision
  visible: (ctx) => ctx.data.drift.items.length > 0,
  Component: Drift,
};
