// Decision: is the buffer growing and the debt shrinking
import { ACCOUNTS_LESS_DEBT, SAME_DEBT_TWICE } from "@banking/core";
import { useState } from "react";
import { LineChart } from "../../../charts/LineChart.tsx";
import { date, money, monthLabel, monthLong } from "../../../format.ts";
import { TableToggle } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import { overdraftTwice } from "./Loans.tsx";

const TOTAL_LABEL = "Yhdistetyt tilit yhteensä, arvio";

function Balances({ ctx }: SectionProps) {
  const r = ctx.data.balances;
  const [table, setTable] = useState(false);
  const last = r.months.length - 1;
  // the month in progress has no end yet: its point is the balance of today
  const lastIsToday = last >= 0 && r.months[last] === ctx.running;
  const oldest = r.accounts.reduce((o, a) => (a.asOf < o ? a.asOf : o), ctx.meta.today);
  const sub = lastIsToday
    ? `Kuukauden lopussa, viimeinen piste tänään${oldest < ctx.meta.today ? `. Vanhin saldo on päivältä ${date(oldest)}` : ""}`
    : "Kuukauden lopussa";
  return (
    <Section id={section.id} title={section.title} sub={sub} actions={<TableToggle table={table} onToggle={() => setTable((v) => !v)} />}>
      {/* told for today only, as the debts are, and only to a household that saved a loan; with cents, so the three figures subtract */}
      {lastIsToday && r.debt.savedCents > 0 && r.accountsLessDebt[last] != null && r.total[last] != null && (
        <p className="muted">
          {ACCOUNTS_LESS_DEBT.label} tänään {money(r.accountsLessDebt[last]!)}: tilit yhteensä {money(r.total[last]!)},{" "}
          {ctx.scope === "household" ? "omat tallennetut lainasi" : "tallennetut lainat"} {money(r.debt.savedCents)}. {ACCOUNTS_LESS_DEBT.sub}
          {ctx.data.loans.maybeTwice.length > 0 && ` ${SAME_DEBT_TWICE}: katso Lainat.`}
          {ctx.data.loans.overdraftTwice.map((t) => ` ${overdraftTwice(t)}`).join("")}
        </p>
      )}
      {table ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kuukausi</th>
                <th className="num">Yhteensä, arvio</th>
                {r.accounts.map((a) => (
                  <th key={a.accountId} className="num">
                    {a.name}
                  </th>
                ))}
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
        <>
          <div className="legend" aria-hidden="true">
            <span>
              <i className="line-key" style={{ background: "var(--series-1)" }} />
              {TOTAL_LABEL}
            </span>
          </div>
          <LineChart
            labels={r.months.map((m, i) => (i === last && lastIsToday ? "tänään" : monthLabel(m, m.endsWith("-01"))))}
            series={[{ key: "total", label: TOTAL_LABEL, color: "var(--series-1)", values: r.total }]}
          />
        </>
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
