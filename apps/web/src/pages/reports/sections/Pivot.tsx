import { daysInMonth } from "@banking/core";
import { money, monthLabel, monthLong } from "../../../format.ts";
import { ExportLink, Section } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/**
 * Shade by where a month sits between the row's own lowest and highest month,
 * so a steady bill stays plain and a category that swings shows its peaks.
 */
function heatLevel(value: number, min: number, max: number): number {
  if (value <= 0 || max <= min * 1.15) return 0;
  const f = Math.max(0, (value - min) / (max - min));
  return f > 0.8 ? 4 : f > 0.55 ? 3 : f > 0.3 ? 2 : 1;
}

function Pivot({ ctx }: SectionProps) {
  const r = ctx.data.pivot;
  const { range } = ctx;
  const partialLast = range.to < `${range.to.slice(0, 7)}-${daysInMonth(range.to.slice(0, 7))}`;
  return (
    <Section section={section} sub="Tummempi solu on kategorian kalleimpia kuukausia" actions={<ExportLink href={ctx.exportHref("pivot")} />}>
      <div className="table-wrap">
        <table className="heat-table">
          <thead>
            <tr>
              <th>Kategoria</th>
              {r.months.map((m) => (
                <th key={m} className="num">
                  {monthLabel(m, m.endsWith("-01") || m === r.months[0])}
                </th>
              ))}
              <th className="num">Yhteensä</th>
              <th className="num">Ka/kk</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => {
              // the running month is low only because it is not over yet, and a month without
              // spending is a blank cell: neither sets the low end of the row
              const full = (partialLast && row.values.length > 1 ? row.values.slice(0, -1) : row.values).filter((v) => v > 0);
              const max = full.length ? Math.max(...full) : 0;
              const min = full.length ? Math.min(...full) : 0;
              return (
                <tr key={row.category}>
                  <td style={{ whiteSpace: "nowrap" }}>{row.label}</td>
                  {row.values.map((v, i) => (
                    <td key={i} className={`num cell heat-l${heatLevel(v, min, max)}`} title={`${row.label}, ${monthLong(r.months[i]!)}: ${money(v)}`}>
                      {v ? money(v, false) : ""}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{money(row.totalCents, false)}</strong>
                  </td>
                  <td className="num">{money(row.averageCents, false)}</td>
                </tr>
              );
            })}
            <tr className="group-row">
              <td>Yhteensä</td>
              {r.monthTotals.map((v, i) => (
                <td key={i} className="num">
                  {money(v, false)}
                </td>
              ))}
              <td className="num">{money(r.totalCents, false)}</td>
              <td className="num">{money(r.averageCents, false)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export const section: ReportSection = {
  id: "kuukaudet",
  title: "Kuukausitaulukko",
  order: 50,
  reports: ["pivot"],
  Component: Pivot,
};
