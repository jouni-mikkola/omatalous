// Decision: find the month a category jumped
import { money, monthLabel, monthLong } from "../../../format.ts";
import { ExportLink, NEGATIVE_TOTAL_NOTE } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/quality.css";

/**
 * Shade by where a month sits between the row's own lowest and highest month,
 * so a steady bill stays plain and a category that swings shows its peaks.
 */
function heatLevel(value: number, min: number, max: number): number {
  if (value <= 0 || max <= min * 1.15) return 0;
  const f = Math.max(0, (value - min) / (max - min));
  return f > 0.8 ? 4 : f > 0.55 ? 3 : f > 0.3 ? 2 : 1;
}

type Report = SectionProps["ctx"]["data"]["pivot"];

/** The shade of one cell. An incomplete month is low only because it is not whole, and a month without spending is blank: neither sets the low end of the row. */
function cellLevels(r: Report, row: Report["rows"][number]): number[] {
  const full = row.values.filter((v, i) => r.complete[i] && v > 0);
  const max = full.length ? Math.max(...full) : 0;
  const min = full.length ? Math.min(...full) : 0;
  return row.values.map((v, i) => (r.complete[i] ? heatLevel(v, min, max) : 0));
}

function Pivot({ ctx }: SectionProps) {
  const r = ctx.data.pivot;
  // a running month is no monthly figure: without a complete month in the range the column is left out
  const hasAverage = r.averageCents !== null;
  return (
    <Section id={section.id} title={section.title} actions={<ExportLink href={ctx.exportHref("pivot")} />}>
      <div className="table-wrap pivot-wide">
        <table className="heat-table">
          <thead>
            <tr>
              <th>Kategoria</th>
              {r.months.map((m, i) => (
                <th key={m} className="num">
                  {monthLabel(m, m.endsWith("-01") || m === r.months[0])}
                  {!r.complete[i] && <span className="partial-tag">vajaa</span>}
                </th>
              ))}
              <th className="num">Yhteensä</th>
              {hasAverage && <th className="num">Keskimäärin kuussa</th>}
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => {
              const levels = cellLevels(r, row);
              return (
                <tr key={row.category}>
                  <td style={{ whiteSpace: "nowrap" }}>{row.label}</td>
                  {row.values.map((v, i) => (
                    <td key={i} className={`num cell heat-l${levels[i]}${r.complete[i] ? "" : " partial-cell"}`} title={`${row.label}, ${monthLong(r.months[i]!)}: ${money(v)}`}>
                      {v ? money(v, false) : ""}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{money(row.totalCents, false)}</strong>
                  </td>
                  {hasAverage && <td className="num">{row.averageCents === null ? "–" : money(row.averageCents, false)}</td>}
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
              {hasAverage && <td className="num">{money(r.averageCents!, false)}</td>}
            </tr>
          </tbody>
        </table>
      </div>
      <PivotList r={r} />
      {r.rows.some((row) => row.totalCents < 0) && <p className="small muted">{NEGATIVE_TOTAL_NOTE}</p>}
    </Section>
  );
}

/**
 * The same figures for a phone: one line per category with its total and monthly average, and the months behind a tap.
 * Twelve month columns do not fit 390 px, and a table that scrolls sideways hides the months it is about.
 */
function PivotList({ r }: { r: Report }) {
  return (
    <ul className="pivot-list pivot-narrow">
      {r.rows.map((row) => {
        const levels = cellLevels(r, row);
        return (
          <li key={row.category}>
            <details>
              <summary>
                <span className="pivot-name">{row.label}</span>
                <strong className="pivot-total">{money(row.totalCents, false)}</strong>
                {row.averageCents !== null && <span className="pivot-avg muted">Keskimäärin kuussa {money(row.averageCents, false)}</span>}
              </summary>
              <dl className="pivot-months">
                {row.values.map((v, i) =>
                  v ? (
                    <div key={r.months[i]} className={`heat-l${levels[i]}${r.complete[i] ? "" : " partial-cell"}`}>
                      <dt>{monthLabel(r.months[i]!, r.months[i]!.endsWith("-01") || i === 0)}</dt>
                      <dd>{money(v, false)}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </details>
          </li>
        );
      })}
      <li className="pivot-sum">
        <span className="pivot-name">Yhteensä</span>
        <strong className="pivot-total">{money(r.totalCents, false)}</strong>
        {r.averageCents !== null && <span className="pivot-avg muted">Keskimäärin kuussa {money(r.averageCents, false)}</span>}
      </li>
    </ul>
  );
}

export const section: ReportSection = {
  id: "kuukaudet",
  title: "Kuukausitaulukko",
  order: 50,
  page: "reports",
  reports: ["pivot"],
  Component: Pivot,
};
