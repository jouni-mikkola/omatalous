// Decision: spend less or save more
import { useState } from "react";
import { DivergingColumns } from "../../../charts/DivergingColumns.tsx";
import { SurplusBridge } from "../../../components/SurplusBridge.tsx";
import { money, monthLong, percent } from "../../../format.ts";
import { ExportLink, Kv, TableToggle } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

function Cashflow({ ctx }: SectionProps) {
  const r = ctx.data.cashflow;
  const [table, setTable] = useState(false);
  const t = r.totals;
  // a month that has not ended, or that the history does not cover from the 1st, is partial
  const monthLabelOf = (x: { month: string; complete: boolean }) => `${monthLong(x.month)}${x.complete ? "" : " (vajaa)"}`;
  // the month in progress has its bills but maybe not its salary: the margin is told from the complete months
  const settled = r.running ? r.closed : t;
  const whole = r.running ? ", valmiit kuukaudet" : "";
  return (
    <Section
      id={section.id}
      title={section.title}
      sub={r.average ? `Kuukaudessa keskimäärin tulot ${money(r.average.incomeCents, false)}, menot ${money(r.average.consumptionCents + r.average.debtCents, false)}` : undefined}
      actions={
        <>
          <TableToggle table={table} onToggle={() => setTable((v) => !v)} />
          <ExportLink href={ctx.exportHref("cashflow")} />
        </>
      }
    >
      {/* the bar holds the figures of the settled months; with none there is no bar, and the totals stand in its place */}
      {!settled && (
        <Kv
          items={[
            ["Tulot", money(t.incomeCents, false)],
            ["Menot", money(t.expenseCents, false)],
            ["Säästöön", money(t.savedCents, false)],
            ...(t.borrowedCents ? ([["Luotonnostot", money(t.borrowedCents, false)]] as [string, string][]) : []),
          ]}
        />
      )}
      {settled && <SurplusBridge totals={settled} title={`Mihin tulot menivät${whole}`} />}
      {table ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kuukausi</th>
                <th className="num">Tulot</th>
                <th className="num">Kulutus</th>
                <th className="num">Velanhoito</th>
                <th className="num">Säästöön</th>
                {t.borrowedCents !== 0 && <th className="num">Luotonnostot</th>}
                <th className="num">Yli jäi</th>
                <th className="num">Säästöaste</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.month}>
                  <td>{monthLabelOf(x)}</td>
                  <td className="num">{money(x.incomeCents, false)}</td>
                  <td className="num">{money(x.consumptionCents, false)}</td>
                  <td className="num">{money(x.debtCents, false)}</td>
                  <td className="num">{money(x.savedCents, false)}</td>
                  {t.borrowedCents !== 0 && <td className="num">{money(x.borrowedCents, false)}</td>}
                  <td className="num">
                    <strong>{money(x.leftCents, false)}</strong>
                  </td>
                  <td className="num">{x.savingsRate === null ? "–" : percent(x.savingsRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <DivergingColumns
          months={r.rows.map((x) => x.month)}
          up={{ key: "income", label: "Tulot", color: "var(--series-1)", values: r.rows.map((x) => x.incomeCents) }}
          down={[
            { key: "consumption", label: "Kulutus", color: "var(--series-2)", values: r.rows.map((x) => x.consumptionCents) },
            { key: "debt", label: "Velanhoito", color: "var(--series-7)", values: r.rows.map((x) => x.debtCents) },
            { key: "saved", label: "Säästöön", color: "var(--series-3)", values: r.rows.map((x) => Math.max(0, x.savedCents)) },
          ]}
        />
      )}
    </Section>
  );
}

export const section: ReportSection = {
  id: "kassavirta",
  title: "Tulot ja menot",
  order: 20,
  page: "reports",
  reports: ["cashflow"],
  Component: Cashflow,
};
