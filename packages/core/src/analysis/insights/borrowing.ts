/**
 * Credit drawn in the period against the expected income of a month, and debt service when it takes more than
 * `DEBT_SHARE` of expected income (a mortgage at 15 % is ordinary and not news). Debt service is the monthly cost of the loan series as
 * they stand (`fixedSplit`), so an early repayment or a loan paid off at once is not counted as a monthly burden.
 * Usual income is the median of six complete months; with fewer months nothing is judged.
 */
import { cancelledSubjects, fixedSplit, isCancelled } from "../../commitments.ts";
import { getCategory } from "../../categories.ts";
import { monthOf } from "../../dates.ts";
import type { RecurringSeries } from "../../recurring.ts";
import type { IsoDate, UserInputs } from "../../types.ts";
import { type AnalysisContext, recurringAt } from "../context.ts";
import { coverOf } from "../flows.ts";
import { formatEur } from "../format.ts";
import { expectedIncome } from "../expected.ts";
import { DEBT_SHARE } from "../../thresholds.ts";
import { insightOf, lastCompleteMonths, monthRows, REPORT, shareOfExpectedIncome } from "./shared.ts";
import { messageIn } from "../../messages.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

const MONTHS = 6;

export interface DebtShare {
  /** Loan instalments a month as the series stand. */
  debtCents: number;
  /** Expected income (`expectedIncome`): the mean earned income of `months`. */
  incomeCents: number;
  /** The six complete months before `end`, oldest first. */
  months: string[];
  /** The debt series on `end`, cancelled merchants left out. */
  series: readonly RecurringSeries[];
}

/** Debt service against usual income, without the insight's line. Null under six complete months. */
export function debtShareOf(ctx: AnalysisContext, end: IsoDate, inputs: UserInputs): DebtShare | null {
  const months = lastCompleteMonths(ctx, end, MONTHS);
  if (months.length < MONTHS) return null;
  const cancelled = cancelledSubjects(inputs);
  const series = recurringAt(ctx, end).filter((s) => getCategory(s.category).kind === "debt" && !isCancelled(cancelled, s));
  const debtCents = fixedSplit(series, cancelled).debtCents;
  // six months give a usual income, so it is never null here
  const incomeCents = expectedIncome(ctx, monthOf(end))!;
  return { debtCents, incomeCents, months, series };
}

export function borrowing({ ctx, range, end, current, totals, inputs, lang }: InsightArgs): Insight[] {
  const out: Insight[] = [];
  // credit drawn is the window's net, never below zero (`coverOf`); the rows only tell how many draws made it
  const drawn = coverOf(totals).creditDrawnCents;
  const against = shareOfExpectedIncome(ctx, end, drawn);
  if (drawn > 0 && against) {
    const draws = current.filter((t) => t.flows.borrowed > 0);
    out.push(
      insightOf({
        lang,
        id: "borrowed",
        fact: { type: "credit-drawn", cents: drawn, draws: draws.length, from: range.from, to: end },
        comparison: against,
        action: { label: "seeDraws", target: { page: "transactions", filter: { category: "credit_draw", from: range.from, to: end } } },
        // the terms of the credit are not in the rows, so what it is worth is what has to be paid back
        yearlyCents: -drawn,
        kind: "single",
        rows: draws.map((t) => t.id),
        link: { category: "credit_draw", from: range.from, to: end },
        calc: [
          { label: messageIn(lang, "calc.drawn"), value: formatEur(drawn, false, lang) },
          { label: messageIn(lang, "calc.draws"), value: String(draws.length) },
          { label: messageIn(lang, "calc.expected_income_month"), value: formatEur(expectedIncome(ctx, monthOf(end)) ?? 0, false, lang) },
        ],
      }),
    );
  }
  const share = debtShareOf(ctx, end, inputs);
  if (!share) return out;
  const { months, series, debtCents: debt, incomeCents: income } = share;
  if (income > 0 && debt / income > DEBT_SHARE) {
    const first = months[0]!;
    const ids = new Set(series.flatMap((s) => s.transactionIds));
    const percent = Math.round((debt / income) * 100);
    out.push(
      insightOf({
        lang,
        id: "debt",
        fact: { type: "debt-share", percent, debtCents: debt, incomeCents: income },
        comparison: { label: "limit", value: q.percent(Math.round(DEBT_SHARE * 100)) },
        action: { label: "seeLoans", target: { page: "reports", anchor: REPORT.loans } },
        // the part above the limit, over a year
        yearlyCents: -Math.round((debt - DEBT_SHARE * income) * 12),
        kind: "pattern",
        rows: months.flatMap((m) => monthRows(ctx, m).txs.filter((t) => ids.has(t.id)).map((t) => t.id)),
        link: { from: `${first}-01`, to: end },
        calc: [
          { label: messageIn(lang, "calc.loan_instalments_month"), value: formatEur(debt, false, lang) },
          { label: messageIn(lang, "calc.expected_income_month"), value: formatEur(income, false, lang) },
          { label: messageIn(lang, "calc.share_of_income"), value: `${percent}\u00a0%` },
          { label: messageIn(lang, "calc.limit"), value: `${Math.round(DEBT_SHARE * 100)}\u00a0%` },
        ],
      }),
    );
  }
  return out;
}
