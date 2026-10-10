import { LineChart } from "../../../charts/LineChart.tsx";
import { money, MONTHS_SHORT, signedMoney } from "../../../format.ts";
import { Kv, Section } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

function YearOverYear({ ctx }: SectionProps) {
  const r = ctx.data.yearOverYear;
  const { summary } = ctx.data;
  const diff = r.previousYtdCents ? (r.ytdCents - r.previousYtdCents) / r.previousYtdCents : null;
  const from = r.comparableFromMonth;
  const lastMonth = r.current.filter((v) => v !== null).length;
  // "Menot 2026 tähän asti", or the months both years have: "Menot elo–syys 2026"
  const span = from && from > 1 ? `${MONTHS_SHORT[from - 1]}–${MONTHS_SHORT[lastMonth - 1]} ` : "";
  const changes = summary.comparable ? summary.changes : [];
  return (
    <Section section={section} sub={from === null ? "Edellisen vuoden tietoja ei ole." : from > 1 ? `Molemmilta vuosilta on tiedot ${MONTHS_SHORT[from - 1]}kuusta alkaen.` : undefined}>
      <Kv
        items={[
          [`Menot ${span}${r.year}${span ? "" : " tähän asti"}`, money(r.ytdCents, false)],
          ...(from !== null
            ? ([
                [`Samaan aikaan ${r.year - 1}`, money(r.previousYtdCents, false)],
                ["Muutos", diff === null ? "–" : Math.round(diff * 100) === 0 ? "±0 %" : `${diff > 0 ? "+" : "−"}${Math.abs(Math.round(diff * 100))} %`],
              ] as [string, string][])
            : []),
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
          <h3 className="subhead">Suurimmat muutokset vuotta aiemmasta samasta jaksosta</h3>
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
  // the biggest changes under the chart come from the summary
  reports: ["yearOverYear", "summary"],
  Component: YearOverYear,
};
