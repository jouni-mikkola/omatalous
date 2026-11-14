// Decision: is the buffer growing and the debt shrinking
import { addDays } from "@banking/core";
import { BalanceLine } from "../../../charts/forms/BalanceLine.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { DeltaChip } from "../../../components/table/Cells.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { FigureRow } from "../holdings/FigureRow.tsx";
import { Holdings } from "../holdings/Holdings.tsx";
import { date, dayMonth, money, monthLong, moneyIn, plural, signedMoney } from "../../../format.ts";
import "../../../styles/statement.css";
import { BALANCES_ID } from "./ids.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { overdraftTwice } from "./Loans.tsx";
import { accountsLessDebt, sameDebtTwice } from "../parts.tsx";
import { rich, t } from "../../../text.ts";

/** The saved loans of the rows. A loan linked to an account is in the accounts' total already, so with one the row says which loans its figure holds. */
const savedLabel = (linked: boolean) => t(linked ? "rpt.bal_saved_unlinked" : "rpt.bal_saved");

function Balances({ ctx }: SectionProps) {
  const r = ctx.data.balances;
  const last = r.months.length - 1;
  // the month in progress has no end yet: its point is the balance of today
  const lastIsToday = last >= 0 && r.months[last] === ctx.running;
  const { maybeTwice, overdraftTwice: overdrafts } = ctx.data.loans;
  const biggest = r.events.reduce<(typeof r.events)[number] | null>((b, e) => (b === null || e.cents < b.cents ? e : b), null);
  const days = r.daily.cents;
  const nowAt = days.findLastIndex((v) => v !== null);
  const now = nowAt >= 0 ? days[nowAt]! : null;
  // the report's window is whole months, so the newest known day is often the last month's end, not today
  const nowDay = nowAt >= 0 ? addDays(r.daily.from, nowAt) : null;
  // the balance of the newest day and its change are the panel's figure above: the answer says only what that leaves out
  const answer = (
    <>
      {r.lowest && rich("rpt.bal_lowest", { date: date(r.lowest.day), amount: money(r.lowest.cents, false) })}
      {biggest && `${r.lowest ? " " : ""}${t("rpt.bal_biggest", { label: biggest.label, day: dayMonth(biggest.day), amount: money(-biggest.cents, false) })}`}
    </>
  );
  const monthRows = r.months.map((_, i) => i);
  const tableColumns: Column<number>[] = [
    {
      key: "month",
      label: t("rpt.month"),
      kind: "text",
      rowHead: true,
      cell: (i) => (i === last && lastIsToday ? t("rpt.sm_running", { month: monthLong(r.months[i]!) }) : monthLong(r.months[i]!)),
    },
    {
      key: "total",
      label: t("rpt.bal_total_est"),
      kind: "money",
      main: true,
      cell: (i) => (r.total[i] === null ? "–" : money(r.total[i]!, false)),
    },
    {
      key: "change",
      label: t("rpt.bal_month_change"),
      kind: "money",
      cell: (i) => (r.monthChange[i] === null || r.monthChange[i] === undefined ? "–" : signedMoney(r.monthChange[i]!)),
    },
  ];
  const tableView = (
    <Table caption={t("rpt.bal_by_month")} rows={monthRows} rowKey={(i) => r.months[i]!} search={false} columns={tableColumns} />
  );
  return (
    <ReportPanel
      id={section.id}
      title={section.title}
      datum={
        now === null ? undefined : (
          <span className="saldot-datum">
            {t("rpt.bal_datum", { date: date(nowDay), amount: money(now, false) })}
            {r.change !== null && Math.abs(r.change.cents) >= 100 && <DeltaChip delta={r.change.cents} text={signedMoney(r.change.cents)} meaning="gain" />}
          </span>
        )
      }
    >
      {/* told for today only, as the debts are, and only to a household that saved a loan; with cents, so the three figures subtract */}
      {lastIsToday && r.debt.savedCents > 0 && r.accountsLessDebt[last] != null && r.total[last] != null && (
        <>
          <dl className="st-rows balance-rows">
            <FigureRow label={t("rpt.bal_row")}>{money(r.total[last]!)}</FigureRow>
            <FigureRow label={savedLabel(ctx.data.loans.loans.some((l) => l.linkedAccount !== null))}>{money(r.debt.savedCents)}</FigureRow>
            <FigureRow label={accountsLessDebt().label}>{money(r.accountsLessDebt[last]!)}</FigureRow>
          </dl>
          {(maybeTwice.length > 0 || overdrafts.length > 0) && (
            <ul className="loans-notes">
              {maybeTwice.length > 0 && <li className="warn">{t("rpt.bal_twice_see", { text: sameDebtTwice() })}</li>}
              {overdrafts.length > 0 && <li className="warn">{overdraftTwice()}</li>}
            </ul>
          )}
        </>
      )}
      <QuestionChart id="saldot-kaavio" question={t("rpt.bal_q_trend")} answer={answer} table={tableView}>
        <BalanceLine r={r} />
      </QuestionChart>
      <hr className="qc-rule" />
      <Holdings holdings={r.holdings} meta={ctx.meta} scope={ctx.scope} />
      {r.missing.length > 0 && (
        <>
          <hr className="qc-rule" />
          <QuestionChart id="saldot-puuttuvat" question={t("rpt.bal_q_missing")} answer={t(r.missing.length === 1 ? "rpt.bal_missing_one" : "rpt.bal_missing_many", { count: plural(r.missing.length, t("rpt.u_account"), t("rpt.u_accounts")) })}>
            <dl className="st-rows balance-rows">
              {r.missing.map((m) => (
                <FigureRow key={m.accountId} label={m.name}>
                  {m.foreign ? moneyIn(m.foreign.cents, m.foreign.currency) : t("rpt.bal_unknown")}
                </FigureRow>
              ))}
            </dl>
          </QuestionChart>
        </>
      )}
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: BALANCES_ID,
  get title() {
    return t("rpt.sec_balances");
  },
  order: 110,
  page: "reports",
  reports: ["balances", "loans"],
  visible: (ctx) => ctx.data.balances.accounts.length > 0,
  Component: Balances,
};
