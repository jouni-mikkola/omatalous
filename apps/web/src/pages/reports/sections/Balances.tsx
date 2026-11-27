// Decision: is the buffer growing and the debt shrinking
import type { LoansReport } from "@banking/core";
import { useAddLoan } from "../../../components/loans/AddLoan.tsx";
import { BalanceLine } from "../../../charts/forms/BalanceLine.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { FigureRow } from "../holdings/FigureRow.tsx";
import { Holdings } from "../holdings/Holdings.tsx";
import { answerMoney, date, money, monthLong, moneyIn, plural, signedMoney } from "../../../format.ts";
import { LOAN_TERMS_HASH } from "../../../routes.ts";
import { Tiles, type TileItem } from "../../../components/Tiles.tsx";
import "../../../styles/statement.css";
import { BALANCES_ID } from "./ids.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { listsLoans } from "./Loans.tsx";
import { headAsks, lackingDebts, netLabelOf, showsHead } from "../../../components/net-label.ts";
import { t, tn } from "../../../text.ts";

/**
 * The page's answer in one row, each figure the one of `holdings` under the name its group has below: what the accounts
 * hold, what is owed and what is left of the first after the second. The debts say so when they are the known ones only,
 * and then no net is told: one line under the row counts the debts that lack a balance and leads to their question.
 */
export function BalancesTiles({ ctx }: SectionProps) {
  const h = ctx.data.balances.holdings;
  if (!showsHead(ctx.data.balances)) return null;
  const lacking = lackingDebts(h);
  const owes = h.debtCents !== null && h.debtCents > 0;
  const netLabel = netLabelOf(h);
  const items: TileItem[] = [
    { label: t("holdings.accounts_total"), figure: answerMoney(h.accountsCents!) },
    ...(owes ? [{ label: t(lacking > 0 ? "holdings.debts_known" : "holdings.debts_total"), figure: answerMoney(h.debtCents!) }] : []),
    ...(owes && lacking === 0 && h.netCents !== null && netLabel ? [{ label: netLabel, figure: answerMoney(h.netCents) }] : []),
  ];
  // with no debt left to ask in Tarkistettavat the line has no link
  const asks = headAsks(ctx.data.balances);
  return (
    <>
      <Tiles items={items} />
      {lacking > 0 && (
        <p className="bal-lacking">
          <span>{tn(lacking, "rpt.bal_lacking_one", "rpt.bal_lacking_many")}</span>
          {asks && (
            <>
              {" "}
              <a className="btn-link" href={LOAN_TERMS_HASH}>{t("rpt.ln_fill")}</a>
            </>
          )}
        </p>
      )}
    </>
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
  // how far the line of the chart moved over its range, said under its heading; a move under a euro is no move
  const moved = r.change !== null && Math.abs(r.change.cents) >= 100 ? r.change : null;
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
          <QuestionChart
            id="saldot-kaavio"
            question={t("rpt.bal_q_trend")}
            answer={
              moved && (
                <>
                  <span className={`strip-delta ${moved.cents > 0 ? "good" : "bad"}`}>{signedMoney(moved.cents)}</span> {t("rpt.bal_since", { date: date(moved.from) })}
                </>
              )
            }
            table={tableView}
          >
            <BalanceLine r={r} />
          </QuestionChart>
          {/* the page is named Varat ja velat and its net figure is the row above the page; Lainat (shown with a saved or an unsaved loan) lists the loans and their total */}
          <Holdings holdings={r.holdings} meta={ctx.meta} title={null} net={false} loansListed={listsLoans(ctx.data.loans)} />
          {ctx.data.loans.ended.length > 0 && <hr className="qc-rule" />}
          <EndedCredits ended={ctx.data.loans.ended} />
          {r.missing.length > 0 && (
            <>
              <hr className="qc-rule" />
              <QuestionChart id="saldot-puuttuvat" question={t("rpt.bal_q_missing")} answer={<span className="strip-delta bad">{t("rpt.bal_missing", { count: plural(r.missing.length, t("rpt.u_account"), t("rpt.u_accounts")) })}</span>}>
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
