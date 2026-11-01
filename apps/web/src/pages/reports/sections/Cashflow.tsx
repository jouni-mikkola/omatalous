// Decision: spend less or save more
import { Table } from "../../../components/table/Table.tsx";
import { printedEuros } from "@banking/core";
import { query } from "../../../api.ts";
import type { CashflowReport, MoneyBridge, PeriodTotals } from "@banking/core";
import { IncomeUse } from "../../../charts/forms/IncomeUse.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { rateBounds, rateRange, rateStaysUsual } from "../rate-words.ts";
import { unknownPercent } from "../../../components/UnknownShare.tsx";
import { date, money, monthLongIn, percent, plural } from "../../../format.ts";
import { inSpan } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import { rich, t } from "../../../text.ts";

/** Money in nothing has told yet is no earned income until answered: over the limit, one line says so beside the spending's. */
export function UnknownIncome({ share, range }: { share: number; range: SectionProps["ctx"]["range"] }) {
  const percent = unknownPercent(share);
  if (percent === null) return null;
  return (
    <p className="question-line">
      {t("rpt.cf_unknown", { percent })}{" "}
      <a href={`#/transactions${query({ category: "income", from: range.from, to: range.to })}`}>{t("rpt.cf_show")}</a>
    </p>
  );
}

/** "syyskuu" → "Syyskuu". */
const capital = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
/** "syyskuussa" (in English "September"): the month as a sentence says what happened in it. */
const inMonth = (month: string) => monthLongIn(month).split(" ")[0]!;
/** The answer about the savings rate: the newest complete month against the usual band, both as printed. */
function rateAnswer(r: CashflowReport, flat: boolean) {
  const last = r.rows.findLast((x) => x.complete && x.savingsRate !== null);
  if (!last) return t("rpt.cf_need_month");
  const u = r.usualRate;
  if (flat && u) return <>{t("rpt.cf_flat", { range: rateBounds(u), months: t("rpt.cf_months", { n: u.months }) })}</>;
  const rate = Math.round(last.savingsRate! * 100);
  const where = !u ? "" : t(rate < Math.round(u.low * 100) ? "rpt.cf_below" : rate > Math.round(u.high * 100) ? "rpt.cf_above" : "rpt.cf_at");
  return (
    <>
      {rich("rpt.cf_rate_in", { month: capital(inMonth(last.month)), rate: percent(last.savingsRate!), where: last.savingsRate! < 0 ? t("rpt.cf_over") : where })}{u ? ` ${capital(rateRange(u))} (${t("rpt.cf_months", { n: u.months })}).` : ""}
    </>
  );
}

/** One earlier month's rate in percentage points against the newest month's; nothing for a month with no rate, which has nothing to set beside it. */
function rateAgainst(now: number, then: { month: string; rate: number | null }, name: string) {
  if (then.rate === null) return null;
  const points = Math.round(now * 100) - Math.round(then.rate * 100);
  return <li key={name}>{t("rpt.cf_vs", { name, rate: percent(then.rate), diff: points === 0 ? t("rpt.cf_same") : t("rpt.cf_points", { sign: points > 0 ? "+" : "−", n: Math.abs(points) }) })}</li>;
}

/**
 * The newest complete month's rate against the same month a year ago, and against the month before when the table above
 * has no row of it (a short period). The newest month's own rate is in the answer, so it is not said again.
 */
function RateCompareLine({ c, months }: { c: NonNullable<CashflowReport["rateCompare"]>; months: ReadonlySet<string> }) {
  const lines = [months.has(c.previous.month) ? null : rateAgainst(c.rate, c.previous, t("rpt.cf_prev_month")), rateAgainst(c.rate, c.yearAgo, t("rpt.cf_year_earlier"))].filter(Boolean);
  return lines.length === 0 ? null : <ul className="income-paydays">{lines}</ul>;
}

const BRIDGE_LABEL: Record<MoneyBridge["lines"][number]["key"], "rpt.cf_b_income" | "rpt.cf_b_consumption" | "rpt.cf_b_debt" | "rpt.cf_b_invested" | "rpt.cf_b_borrowed" | "rpt.cf_b_transfers" | "rpt.cf_b_loans"> = {
  income: "rpt.cf_b_income",
  consumption: "rpt.cf_b_consumption",
  debt: "rpt.cf_b_debt",
  investedOut: "rpt.cf_b_invested",
  borrowed: "rpt.cf_b_borrowed",
  transfersOut: "rpt.cf_b_transfers",
  loanAccounts: "rpt.cf_b_loans",
};

/** The answer under the bridge: the change of the accounts and the lines that carried it. */
function bridgeAnswer(b: MoneyBridge) {
  const up = b.changeCents >= 0;
  return (
    <>
      {rich("rpt.cf_bridge_answer", { to: date(b.to), amount: money(Math.abs(b.changeCents), false), direction: t(up ? "rep.more" : "rep.less"), from: date(b.from) })}
    </>
  );
}

/** The bridge from the money in to the change of the accounts: the lines add up to it with no remainder. */
function BridgeTable({ bridge }: { bridge: MoneyBridge }) {
  return (
    <Table
      caption={t("rpt.cf_bridge_caption")}
      rows={bridge.lines}
      rowKey={(l) => l.key}
      columns={[
        { key: "line", label: t("rpt.cf_line"), kind: "text", rowHead: true, cell: (l) => t(BRIDGE_LABEL[l.key]) },
        { key: "rows", label: t("rpt.cf_rows"), kind: "count", cell: (l) => l.rowIds.length },
        { key: "cents", label: t("rpt.sum"), kind: "money", main: true, precision: "cents", cents: (l) => l.cents },
      ]}
      total={{ label: t("rpt.cf_accounts_change"), cells: { cents: <strong>{money(bridge.changeCents)}</strong> } }}
    />
  );
}

type UseTotals = Pick<PeriodTotals, "incomeCents" | "borrowedCents" | "consumptionCents" | "debtCents" | "savedCents" | "leftCents">;

/**
 * The terms of the sentence under the income-use table, each as what it adds to Tulos (`leftOf`): income, credit
 * drawn, minus consumption, minus debt service and minus saved. Together they are Tulos to the cent. `printed` is each
 * in whole euros with its sign, rounded on its own from the exact sum (the one euro rule of docs/UI_STYLE.md), so a
 * figure here is the figure the table beside it rounds to and is never moved to make the others add up.
 */
export function useTerms(totals: UseTotals) {
  const adds = [totals.incomeCents, totals.borrowedCents, -totals.consumptionCents, -totals.debtCents, -totals.savedCents];
  const [income, borrowed, consumption, debt, saved] = adds.map((cents) => ({ cents, printed: printedEuros(cents) }));
  return { income: income!, borrowed: borrowed!, consumption: consumption!, debt: debt!, saved: saved! };
}

/**
 * The answer under the income-use table: one sentence for each term Tulos is made of, in the words of the term's
 * direction. A term below zero is told as what came back (a refund larger than the purchases, savings drawn on, credit
 * paid back), never as the same words with the sign dropped.
 */
export function useAnswer(totals: UseTotals) {
  const x = useTerms(totals);
  // each term as the euros it adds to Tulos: the words follow the sign, the figure is its size
  const size = (term: { printed: number }) => money(Math.abs(term.printed), false);
  const rest = [
    ...(x.borrowed.cents === 0 ? [] : [t(x.borrowed.printed >= 0 ? "rpt.cf_credit_drawn" : "rpt.cf_credit_repaid", { amount: size(x.borrowed) })]),
    t(x.consumption.printed <= 0 ? "rpt.cf_cons" : "rpt.cf_cons_back", { amount: size(x.consumption) }),
    t(x.debt.printed <= 0 ? "rpt.cf_debt" : "rpt.cf_debt_back", { amount: size(x.debt) }),
    t(x.saved.printed <= 0 ? "rpt.cf_saved" : "rpt.cf_saved_back", { amount: size(x.saved) }),
  ];
  return (
    <>
      {rich(x.income.printed >= 0 ? "rpt.cf_inc" : "rpt.cf_inc_neg", { amount: size(x.income) })} {rest.join(" ")} {rich("rpt.cf_result", { amount: money(totals.leftCents, false) })}
    </>
  );
}

function Cashflow({ ctx }: SectionProps) {
  const r = ctx.data.cashflow;
  const whole = r.whole;
  const n = r.rows.length;
  const span = plural(n, t("rpt.cf_span_m1"), t("rpt.cf_span_mn"));
  const totalLabel = plural(n, t("rpt.u_month"), t("rpt.u_months"));
  const flat = rateStaysUsual(r.rows, r.usualRate);
  return (
    <ReportPanel id={section.id} title={section.title} datum={inSpan(ctx, t("rpt.cf_datum", { amount: money(whole.leftCents, false) }))}>
      <UnknownIncome share={r.unknownIncomeShare} range={ctx.range} />
      <QuestionChart id="kassavirta-kaytto" question={t("rpt.cf_q_use", { span })} answer={useAnswer(whole)}>
        <IncomeUse rows={r.rows} total={whole} totalLabel={totalLabel} />
      </QuestionChart>
      {r.moneyBridge && (
        <>
          <hr className="qc-rule" />
          <QuestionChart id="kassavirta-silta" question={t("rpt.cf_q_bridge")} answer={bridgeAnswer(r.moneyBridge)}>
            <BridgeTable bridge={r.moneyBridge} />
          </QuestionChart>
        </>
      )}
      <hr className="qc-rule" />
      <QuestionChart id="kassavirta-aste" question={t("rpt.cf_q_rate")} answer={rateAnswer(r, flat)}>
        {r.rateCompare && <RateCompareLine c={r.rateCompare} months={new Set(r.rows.map((x) => x.month))} />}
      </QuestionChart>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "kassavirta",
  get title() {
    return t("rpt.sec_cashflow");
  },
  order: 20,
  page: "reports",
  reports: ["cashflow"],
  Component: Cashflow,
};
