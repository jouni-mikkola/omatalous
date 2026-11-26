// Decision: is the buffer growing and the debt shrinking
import type { LoansReport } from "@banking/core";
import { useAddLoan } from "../../../components/loans/AddLoan.tsx";
import { BalanceLine } from "../../../charts/forms/BalanceLine.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { FigureRow } from "../holdings/FigureRow.tsx";
import { Holdings } from "../holdings/Holdings.tsx";
import { answerMoney, date, money, monthLong, moneyIn, plural, signedMoney } from "../../../format.ts";
import { Lead } from "../Lead.tsx";
import "../../../styles/statement.css";
import { BALANCES_ID } from "./ids.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { listsLoans, overdraftTwice } from "./Loans.tsx";
import { accountsLessDebt, sameDebtTwice } from "../parts.tsx";
import { lackingDebts } from "../../../components/net-label.ts";
import { rich, t } from "../../../text.ts";

/** The saved loans of the rows. A loan linked to an account is in the accounts' total already, so with one the row says which loans its figure holds. */
const savedLabel = (linked: boolean) => t(linked ? "rpt.bal_saved_unlinked" : "rpt.bal_saved");

/** What the accounts and cards hold on the newest day, how that moved from the day the report counts from, and what is owed when it is known. */
export function BalancesLead({ ctx }: SectionProps) {
  const r = ctx.data.balances;
  const at = r.daily.cents.findLastIndex((v) => v !== null);
  if (at < 0 || r.accounts.length === 0) return null;
  const debt = r.debt.cents !== null && r.debt.cents > 0;
  // a move under a euro is no move
  const moved = r.change !== null && Math.abs(r.change.cents) >= 100 ? r.change : null;
  // while a debt has no known balance the debt total is incomplete, so the lead names no debt sum
  const key = `rpt.lead_bal${moved ? (moved.cents > 0 ? "_up" : "_down") : ""}${debt && lackingDebts(r.holdings) === 0 ? "_debt" : ""}` as const;
  return (
    <Lead>
      {t(key, {
        amount: answerMoney(r.daily.cents[at]!),
        change: answerMoney(Math.abs(moved?.cents ?? 0)),
        date: date(moved?.from),
        debt: answerMoney(r.debt.cents ?? 0),
      })}
    </Lead>
  );
}

/** The credits the household answered "Maksettu pois" for, each with the day of its last payment (the server's list, latest first): ended, no debt, and not gone from the page. */
export function EndedCredits({ ended }: { ended: LoansReport["ended"] }) {
  if (ended.length === 0) return null;
  return (
    <section>
      <h3 className="st-cap">{t("rpt.ln_ended")}</h3>
      <dl className="st-rows balance-rows">
        {ended.map((e) => (
          <FigureRow key={e.key} label={e.payee}>
            {t("rpt.ln_ended_row", { date: date(e.lastDate) })}
          </FigureRow>
        ))}
      </dl>
    </section>
  );
}

function Balances({ ctx }: SectionProps) {
  const r = ctx.data.balances;
  // the loans are added here, also by a viewer with no account, whose panel has nothing else
  const adding = useAddLoan(ctx.meta, ctx.sayLoan);
  const last = r.months.length - 1;
  // the month in progress has no end yet: its point is the balance of today
  const lastIsToday = last >= 0 && r.months[last] === ctx.running;
  const { maybeTwice, overdraftTwice: overdrafts } = ctx.data.loans;
  // the balance of the newest day and its change are the page's sentence above: the answer says only what that leaves out
  const lowest = r.lowest && rich("rpt.bal_lowest", { date: date(r.lowest.day), amount: money(r.lowest.cents, false) });
  // the highest day of the chart's line beside today's balance on it, told only while the two differ
  const now = lastIsToday ? (r.daily.cents.at(-1) ?? null) : null;
  const peak = r.peak && now !== null && r.peak.cents !== now ? rich("rpt.bal_peak", { date: date(r.peak.day), peak: money(r.peak.cents, false), now: money(now, false) }) : null;
  const answer = peak && lowest ? <>{peak} {lowest}</> : (peak ?? lowest);
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
      actions={adding.opener}
    >
      {ctx.loanSaid && (
        <p className="loan-said" role="status">
          {ctx.loanSaid}
        </p>
      )}
      {adding.form}
      {/* a viewer with no account has nothing more here */}
      {r.accounts.length > 0 && (
        <>
          {/* told for today only, as the debts are, and only to a household that saved a loan; with cents, so the three figures subtract */}
          {lastIsToday && r.debt.savedCents > 0 && r.accountsLessDebt[last] != null && r.total[last] != null && (
            <>
              <dl className="st-rows balance-rows">
                <FigureRow label={t("rpt.bal_row")}>{money(r.total[last]!)}</FigureRow>
                <FigureRow label={savedLabel(ctx.data.loans.loans.some((l) => l.linkedAccount !== null))}>{money(r.debt.savedCents)}</FigureRow>
                {/* while a debt has no balance the figure would be too high, and Holdings names its own net with what it lacks */}
                {lackingDebts(r.holdings) === 0 && <FigureRow label={accountsLessDebt().label}>{money(r.accountsLessDebt[last]!)}</FigureRow>}
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
          {/* the page is named Varat ja velat, and Lainat (shown with a saved or an unsaved loan) lists the loans and their total */}
          <Holdings holdings={r.holdings} meta={ctx.meta} title={null} loansListed={listsLoans(ctx.data.loans)} />
          {ctx.data.loans.ended.length > 0 && <hr className="qc-rule" />}
          <EndedCredits ended={ctx.data.loans.ended} />
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
  page: "balances",
  reports: ["balances", "loans"],
  Component: Balances,
};
