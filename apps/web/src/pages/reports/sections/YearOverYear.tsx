// Decision: is the household spending more than a year ago
import { yearComparisonNote } from "@banking/core";
import { LineChart } from "../../../charts/LineChart.tsx";
import { money, MONTHS_SHORT, signedMoney } from "../../../format.ts";
import { Kv } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

function YearOverYear({ ctx }: SectionProps) {
  const r = ctx.data.yearOverYear;
  const { summary } = ctx.data;
  const note = yearComparisonNote(r);
  // too few months in common: no figures, only why
  if (!r.comparable) return <Section id={section.id} title={section.title} sub={note ?? undefined}>{null}</Section>;
  const diff = r.previousYtdCents ? (r.ytdCents - r.previousYtdCents) / r.previousYtdCents : null;
  const lastMonth = r.current.filter((v) => v !== null).length;
  // the months the figures hold: "Menot 2026 tähän asti" when every month so far is in, else "Menot touko–syyskuu 2026"
  const whole = r.comparedMonths.length === lastMonth;
  const span = whole ? "" : `${MONTHS_SHORT[r.comparedMonths[0]! - 1]}–${MONTHS_SHORT[r.comparedMonths[r.comparedMonths.length - 1]! - 1]}kuu `;
  const changes = summary.comparable ? summary.changes : [];
  return (
    <Section id={section.id} title={section.title} sub={note ?? undefined}>
      <Kv
        items={[
          [`Menot ${span}${r.year}${span ? "" : " tähän asti"}`, money(r.ytdCents, false)],
          [`Samaan aikaan ${r.year - 1}`, money(r.previousYtdCents, false)],
          ["Muutos", diff === null ? "–" : Math.round(diff * 100) === 0 ? "±0 %" : `${diff > 0 ? "+" : "−"}${Math.abs(Math.round(diff * 100))} %`],
          [`Tulot ${span}${r.year}${span ? "" : " tähän asti"}`, money(r.incomeYtdCents, false)],
        ]}
      />
      <LineChart
        labels={MONTHS_SHORT}
        series={[
          { key: "prev", label: String(r.year - 1), color: "var(--series-avg)", values: r.previous },
          // the running month is not over: the line ends at the last complete one
          { key: "cur", label: String(r.year), color: "var(--series-1)", values: r.partialMonth === null ? r.current : r.current.map((v, i) => (i + 1 >= r.partialMonth! ? null : v)) },
        ]}
      />
      {changes.length > 0 && (
        <>
          <h3 className="subhead">Suurimmat muutokset samasta jaksosta vuotta aiemmin</h3>
          <table className="compact ruled">
            <tbody>
              {changes.map((c) => (
                <tr key={c.category}>
                  <td>{c.label}</td>
                  <td className="num muted">
                    {money(c.previousCents, false)} → {money(c.cents, false)}
                  </td>
                  <td className={`num ${c.cents > c.previousCents ? "worse" : "better"}`}>{signedMoney(c.cents - c.previousCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}

export const section: ReportSection = {
  id: "vuodet",
  title: "Vuosivertailu",
  order: 90,
  page: "reports",
  // the biggest changes under the chart come from the summary
  reports: ["yearOverYear", "summary"],
  // one or two months say nothing: with fewer than three whole months of both years the section says why
  visible: (ctx) => ctx.data.yearOverYear.comparable || ctx.data.yearOverYear.dataFrom !== null,
  Component: YearOverYear,
};
