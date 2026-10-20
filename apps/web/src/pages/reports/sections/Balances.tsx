// Decision: is the buffer growing and the debt shrinking
import { ACCOUNTS_LESS_DEBT, SAME_DEBT_TWICE } from "@banking/core";
import { BalanceLine } from "../../../charts/forms/BalanceLine.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { AccountMark } from "../../../components/BankLogo.tsx";
import { DeltaChip, SparkCell } from "../../../components/table/Cells.tsx";
import { type Column, DataTable } from "../../../components/table/DataTable.tsx";
import { RichTable } from "../../../components/table/RichTable.tsx";
import { FigureRow } from "../../../components/holdings/FigureRow.tsx";
import { date, dayMonth, money, monthLong, plural, signedMoney } from "../../../format.ts";
import { ownPart, partText } from "../../../part.ts";
import "../../../styles/statement.css";
import type { ReportSection, SectionProps } from "../types.ts";
import { overdraftTwice } from "./Loans.tsx";

/** The saved loans of the rows. A loan linked to an account is in the accounts' total already, so with one the row says which loans its figure holds. */
const savedLabel = (linked: boolean) => (linked ? "Tallennetut lainat, joita ei ole liitetty tiliin" : "Tallennetut lainat");

function Balances({ ctx }: SectionProps) {
  const r = ctx.data.balances;
  const last = r.months.length - 1;
  // the month in progress has no end yet: its point is the balance of today
  const lastIsToday = last >= 0 && r.months[last] === ctx.running;
  const { maybeTwice, overdraftTwice: overdrafts } = ctx.data.loans;
  const biggest = r.events.reduce<(typeof r.events)[number] | null>((b, e) => (b === null || e.cents < b.cents ? e : b), null);
  const days = r.daily.cents;
  const now = days.findLast((v) => v !== null) ?? null;
  const answer = (
    <>
      {now !== null && (
        <>
          Tileillä on nyt <strong>{money(now, false)}</strong>
          {r.change === null ? "." : <>, {money(Math.abs(r.change.cents), false)} {r.change.cents >= 0 ? "enemmän" : "vähemmän"} kuin {date(r.change.from)}.</>}
        </>
      )}
      {r.lowest && (
        <>
          {" "}
          Alimmillaan saldo oli {date(r.lowest.day)}, <strong>{money(r.lowest.cents, false)}</strong>.
        </>
      )}
      {biggest && ` Suurin kertaosto oli ${biggest.label} ${dayMonth(biggest.day)}, ${money(-biggest.cents, false)}.`}
    </>
  );
  const bankOf = (id: string) => r.holdings.accounts.find((h) => h.id === id)?.bank ?? r.holdings.cards.find((c) => c.id === id)?.bank ?? null;
  const accounts = (
    <RichTable density="comfortable" cards className="ruled saldot-accounts">
      <thead>
        <tr>
          <th>Tili</th>
          <th className="rt-spark-cell">Kuukaudet</th>
          <th className="num">Saldo</th>
          <th className="num">Muutos</th>
        </tr>
      </thead>
      <tbody>
        {r.accounts.map((a) => {
          const current = a.values.findLast((v) => v !== null) ?? null;
          return (
            <tr key={a.accountId}>
              <td>
                <span className="saldot-name">
                  <AccountMark name={a.name} institution={bankOf(a.accountId)} banks={ctx.meta.bank?.banks ?? []} />
                  {a.name}
                </span>
              </td>
              <td className="rt-spark-cell">
                <SparkCell values={a.values} label={`${a.name}: saldo kuukausittain`} />
              </td>
              <td className="num" data-rt="main">
                {current === null ? "–" : money(current, false)}
              </td>
              <td className="num rt-change">{a.changeCents !== null && Math.abs(a.changeCents) >= 100 ? <DeltaChip delta={a.changeCents} text={signedMoney(a.changeCents)} meaning="gain" /> : null}</td>
            </tr>
          );
        })}
      </tbody>
    </RichTable>
  );
  const monthRows = r.months.map((m, i) => i);
  const tableColumns: Column<number>[] = [
    {
      key: "month",
      label: "Kuukausi",
      kind: "text",
      cell: (i) => (i === last && lastIsToday ? `${monthLong(r.months[i]!)} (tänään)` : monthLong(r.months[i]!)),
    },
    {
      key: "total",
      label: "Yhteensä, arvio",
      kind: "money",
      cell: (i) => <strong>{r.total[i] === null ? "–" : money(r.total[i]!, false)}</strong>,
    },
    ...r.accounts.map((a): Column<number> => {
      // the figures of an account at a part are that part: the own view only, Koko talous counts it whole
      const part = partText(ctx.scope === "own" ? ownPart(ctx.meta, a.accountId) : undefined, "account");
      return {
        key: `account:${a.accountId}`,
        label: (
          <>
            {a.name}
            {part && <div className="small muted">{part}</div>}
          </>
        ),
        text: a.name,
        kind: "money",
        cell: (i) => (a.values[i] === null ? "–" : money(a.values[i]!, false)),
      };
    }),
  ];
  const tableView = (
    <DataTable id="balances-months" caption="Saldot kuukausittain" rows={monthRows} rowKey={(i) => r.months[i]!} columns={tableColumns} phone="scroll" />
  );
  return (
    <ReportPanel
      id={section.id}
      title={section.title}
      datum={
        now === null ? undefined : (
          <span className="saldot-datum">
            {`Tileillä ${money(now, false)}`}
            {r.change !== null && Math.abs(r.change.cents) >= 100 && <DeltaChip delta={r.change.cents} text={signedMoney(r.change.cents)} meaning="gain" />}
          </span>
        )
      }
    >
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
              {overdrafts.length > 0 && <li className="warn">{overdraftTwice()}</li>}
            </ul>
          )}
        </>
      )}
      <QuestionChart id="saldot-kaavio" question="Kasvaako puskuri, ja mikä sitä pienensi?" answer={answer} table={tableView}>
        <BalanceLine r={r} />
      </QuestionChart>
      <hr className="qc-rule" />
      <QuestionChart id="saldot-tilit" question="Millä tileillä rahat ovat?" answer={r.change ? `${plural(r.accounts.length, "tili", "tiliä")}. Tilien muutokset ${date(r.change.from)}–${date(r.change.to)} ovat yhteensä otsikon ${signedMoney(r.change.cents)}.` : plural(r.accounts.length, "tili", "tiliä")} table={accounts}>
        {accounts}
      </QuestionChart>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "saldot",
  title: "Saldot",
  order: 110,
  page: "reports",
  tab: "varat",
  reports: ["balances", "loans"],
  visible: (ctx) => ctx.data.balances.accounts.length > 0,
  Component: Balances,
};
