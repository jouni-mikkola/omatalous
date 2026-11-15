/**
 * Decision: when the household's loans are paid at the pace they have now, and what interest is left to pay on the way
 * (an extra payment or a refinancing is worth most when much interest is left). Each loan is walked by its own plan
 * (`debtPath`), so the date is the due date of the last payment and the interest is the interest of the payments still
 * to come. A loan without what its plan needs (a rate, a payment, an end date) is not guessed: it is counted in `left`
 * and the sentence says how many. Told while the period runs, since it is judged from today. Under
 * `ITEM_GATE_MONTHLY_CENTS` a month of interest it is no news.
 */
import { debtInterestNext12Months, loansOf } from "../../loans.ts";
import { debtPath } from "../../loan-path.ts";
import { messageIn } from "../../messages.ts";
import { isRevolving } from "../../types.ts";
import { formatEur, formatFiDate } from "../format.ts";
import { insightOf, ITEM_GATE_MONTHLY_CENTS, REPORT } from "./shared.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

export function debtFree({ ctx, running, inputs, lang }: InsightArgs): Insight[] {
  if (!running) return [];
  // a card or a credit line is drawn and paid as its holder likes: it has no day on which it is paid
  const loans = loansOf(inputs).filter((l) => !isRevolving(l.kind));
  const path = debtPath(loans, ctx.today);
  if (path.payoff === null) return [];
  // a loan the path walks: each on its own, for the date and the interest of one loan
  const walked = loans.map((loan) => ({ loan, own: debtPath([loan], ctx.today) })).filter((w) => w.own.payoff !== null);
  const interestCents = path.interestCents[0] ?? 0;
  const yearCents = debtInterestNext12Months(walked.map((w) => w.loan), ctx.today).cents;
  if (yearCents < 12 * ITEM_GATE_MONTHLY_CENTS) return [];
  return [
    insightOf({
      lang,
      id: "debt-free",
      fact: { type: "debt-free", date: path.payoff, interestCents, loans: walked.length, left: path.left.length },
      comparison: { label: "interestYear", value: q.cents(yearCents) },
      action: { label: "seeLoans", target: { page: "reports", anchor: REPORT.loans } },
      yearlyCents: -yearCents,
      kind: "pattern",
      // the payments of the loans the household has linked to their rows: a loan typed by hand has none
      rows: ctx.recurring.filter((s) => walked.some((w) => w.loan.seriesKey === s.id)).flatMap((s) => s.transactionIds),
      calc: [
        ...walked.map((w) => ({ label: messageIn(lang, "calc.loan_free", { name: w.loan.name, date: formatFiDate(w.own.payoff!, lang) }), value: formatEur(w.own.interestCents[0] ?? 0, false, lang) })),
        { label: messageIn(lang, "calc.interest_to_end"), value: formatEur(interestCents, false, lang) },
      ],
    }),
  ];
}
