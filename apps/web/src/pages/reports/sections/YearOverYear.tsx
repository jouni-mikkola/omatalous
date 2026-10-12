// Decision: is the household spending more than a year ago
import { LineChart } from "../../../charts/LineChart.tsx";
import { money, MONTHS_SHORT, signedMoney } from "../../../format.ts";
import { Kv } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

function YearOverYear({ ctx }: SectionProps) {
  const r = ctx.data.yearOverYear;
  const { summary } = ctx.data;
  const diff = r.previousYtdCents ? (r.ytdCents - r.previousYtdCents) / r.previousYtdCents : null;
  // the section is visible with at least three comparable months, so `from` is a month
  const from = r.comparableFromMonth!;
  const lastMonth = r.current.filter((v) => v !== null).length;
  // "Menot 2026 tähän asti", or the months both years have: "Menot elo–syyskuu 2026"
  const span = from > 1 ? `${MONTHS_SHORT[from - 1]}–${MONTHS_SHORT[lastMonth - 1]}kuu ` : "";
  const changes = summary.comparable ? summary.changes : [];
  return (
    <Section id={section.id} title={section.title} sub={from > 1 ? `Molemmilta vuosilta on tiedot ${MONTHS_SHORT[from - 1]}kuusta alkaen.` : undefined}>
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
          <table className="compact">
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
  // one or two months say nothing: the section waits for three whole months of both years
  visible: (ctx) => ctx.data.yearOverYear.comparable,
  Component: YearOverYear,
};
