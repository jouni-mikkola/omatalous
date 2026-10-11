// Decision: find why a category rose and cap it
import { addDays, daysInMonth } from "@banking/core";
import { query } from "../../../api.ts";
import { date, money, MONTHS_SHORT, plural, signedMoney } from "../../../format.ts";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/** ["2026-07", "2026-08", "2026-09"] → "heinä–syyskuu 2026" */
function monthSpan(months: readonly string[]): string {
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const name = (m: string) => MONTHS_SHORT[Number(m.slice(5, 7)) - 1]!;
  return first.slice(0, 4) === last.slice(0, 4) ? `${name(first)}–${name(last)}kuu ${last.slice(0, 4)}` : `${name(first)}kuu ${first.slice(0, 4)}–${name(last)}kuu ${last.slice(0, 4)}`;
}

const monthEnd = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

/** Why the check has nothing to show: too little history, a range that ends too early, or nothing rose. */
function emptyText(r: SectionProps["ctx"]["data"]["drift"], today: string): string {
  if (!r.months.length) {
    const need = `Tarkistus vertaa kolmea viimeisintä kuukautta tavalliseen ja tarvitsee ${r.neededMonths} valmista kuukautta historiaa.`;
    if (!r.readyFrom) return `${need} Tapahtumia ei ole vielä.`;
    if (r.readyFrom > today) return `${need} Tarkistus alkaa ${date(r.readyFrom)}.`;
    // readyFrom is the first day judged, so a period ending the day before already has its six months
    return `${need} Valitse jakso, joka päättyy ${date(addDays(r.readyFrom, -1))} tai myöhemmin.`;
  }
  if (!r.checked) return `Vertailtavia kategorioita ei ole. Mukana ovat kategoriat, joissa menoja on tavallisesti vähintään ${money(r.minLevelCents, false)} kuussa.`;
  return `Tarkistettu ${plural(r.checked, "kategoria", "kategoriaa")}, ${monthSpan(r.months)}. Yksikään ei ollut tavallista kalliimpi kolmea kuukautta peräkkäin.`;
}

/** Categories that sat above their own level for three months: always shown, so an empty answer says what was checked. */
function Drift({ ctx }: SectionProps) {
  const r = ctx.data.drift;
  if (!r.items.length) {
    return (
      <Section id={section.id} title={section.title}>
        <div className="empty">{emptyText(r, ctx.meta.today)}</div>
      </Section>
    );
  }
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
  reports: ["drift"],
  Component: Drift,
};
