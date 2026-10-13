// Decision: is the buffer growing and the debt shrinking
import { ACCOUNTS_LESS_DEBT, SAME_DEBT_TWICE } from "@banking/core";
import { useState } from "react";
import { LineChart } from "../../../charts/LineChart.tsx";
import { FigureRow } from "../../../components/holdings/FigureRow.tsx";
import { money, monthLabel, monthLong } from "../../../format.ts";
import { ownPart, partText } from "../../../part.ts";
import "../../../styles/statement.css";
import { TableToggle } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import { overdraftTwice } from "./Loans.tsx";

/** The saved loans of the rows. A loan linked to an account is in the accounts' total already, so with one the row says which loans its figure holds. */
const savedLabel = (linked: boolean) => (linked ? "Tiliin liittämättömät tallennetut lainat" : "Tallennetut lainat");

function Balances({ ctx }: SectionProps) {
  const r = ctx.data.balances;
  const [table, setTable] = useState(false);
  const last = r.months.length - 1;
  // the month in progress has no end yet: its point is the balance of today
  const lastIsToday = last >= 0 && r.months[last] === ctx.running;
  const { maybeTwice, overdraftTwice: overdrafts } = ctx.data.loans;
  return (
    <Section id={section.id} title="Tilien saldo kuukauden lopussa (arvio)" actions={<TableToggle table={table} onToggle={() => setTable((v) => !v)} />}>
      {/* told for today only, as the debts are, and only to a household that saved a loan; with cents, so the three figures subtract */}
      {lastIsToday && r.debt.savedCents > 0 && r.accountsLessDebt[last] != null && r.total[last] != null && (
        <>
          <dl className="st-rows balance-rows">
            <FigureRow label="Tilit yhteensä">{money(r.total[last]!)}</FigureRow>
            <FigureRow label={savedLabel(ctx.data.loans.loans.some((l) => l.linkedAccount !== null))}>{money(r.debt.savedCents)}</FigureRow>
            <FigureRow label={ACCOUNTS_LESS_DEBT.label}>{money(r.accountsLessDebt[last]!)}</FigureRow>
          </dl>
          {(maybeTwice.length > 0 || overdrafts.length > 0) && (
            <ul className="loans-notes">
              {maybeTwice.length > 0 && <li className="warn">{SAME_DEBT_TWICE}: katso Lainat.</li>}
              {overdrafts.map((t) => {
                const text = overdraftTwice(t);
                return (
                  <li key={text} className="warn">
                    {text}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {table ? (
        <div className="table-wrap">
          <table className="ruled">
            <thead>
              <tr>
                <th>Kuukausi</th>
                <th className="num">Yhteensä, arvio</th>
                {r.accounts.map((a) => {
                  // the figures of an account at a part are that part: the own view only, Koko talous counts it whole
                  const part = partText(ctx.scope === "own" ? ownPart(ctx.meta, a.accountId) : undefined, "account");
                  return (
                    <th key={a.accountId} className="num">
                      {a.name}
                      {part && <div className="small muted">{part}</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {r.months.map((m, i) => (
                <tr key={m}>
                  <td>{i === last && lastIsToday ? `${monthLong(m)} (tänään)` : monthLong(m)}</td>
                  <td className="num">
                    <strong>{r.total[i] === null ? "–" : money(r.total[i]!, false)}</strong>
                  </td>
                  {r.accounts.map((a) => (
                    <td key={a.accountId} className="num">
                      {a.values[i] === null ? "–" : money(a.values[i]!, false)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <LineChart
          labels={r.months.map((m, i) => (i === last && lastIsToday ? "tänään" : monthLabel(m, m.endsWith("-01"))))}
          series={[{ key: "total", label: "Yhdistetyt tilit yhteensä, arvio", color: "var(--series-1)", values: r.total }]}
        />
      )}
    </Section>
  );
}

export const section: ReportSection = {
  id: "saldot",
  title: "Saldot",
  order: 110,
  page: "reports",
  reports: ["balances", "loans"],
  visible: (ctx) => ctx.data.balances.accounts.length > 0,
  Component: Balances,
};
