/**
 * Payments to a lender or card issuer that stopped inside the twelve complete months. A running series is a loan
 * proposal (`loanProposals`) and a card's bills are the card gap, but payments that stopped more than
 * `LENDER_ACTIVE_DAYS` ago are neither: they are no debt service now, and the rows cannot say whether the credit was
 * paid off or is a card or credit line still owed whose purchases are missing. Tarkistettavat asks once.
 *
 * Decision: whether the credit the payments were for is paid off, still owed, or no loan of the household's.
 *
 * Its key is the series id with no product, as the key of a credit of unknown kind is (`LoanProposal.kindUnknown`), so a
 * loan saved from it or "Ei ole velan maksu" takes every payment of the payee on the account. The payments are no debt
 * service and are in no card gap: they count once, as the loans category counts them.
 */
import { billCents } from "./account-use.ts";
import { type AnalysisContext, type AnalysisTx, standingOf } from "./analysis/context.ts";
import { completeYear } from "./analysis/data-quality.ts";
import { daysBetween, monthOf } from "./dates.ts";
import { isLenderPayment, LENDER_ACTIVE_DAYS, LOAN_CATEGORIES } from "./lender-runs.ts";
import { paidForOthers } from "./loan-detect.ts";
import { cardUnknownAsked, parseCreditPaidSubject } from "./loan-terms-answer.ts";
import { fold } from "./merchant.ts";
import { seriesId } from "./series-id.ts";
import { takenBill } from "./unconnected-cards.ts";
import type { IsoDate, UserInputs } from "./types.ts";
import { withoutSwedishTwin } from "./wording-lenders.ts";
import { isCreditIssuerText, isLoanText } from "./wording.ts";

/** Payments in this many months make a series: two could be two purchases. */
const MIN_SERIES_MONTHS = 3;

/** Payments to a lender or card issuer that stopped inside the twelve complete months. */
export interface EndedCredit {
  /** The series key the answers name: the payee on the account, with no product. */
  key: string;
  payee: string;
  accountId: string;
  /** The day of the last payment, more than `LENDER_ACTIVE_DAYS` before today. */
  lastDate: IsoDate;
  /** How many payments the rows hold, and the sum of those of the twelve complete months. */
  count: number;
  cents: number;
}

/**
 * The payment series to a lender (a known lender, a payee named for a loan, or a card issuer's name with no word of a
 * loan) of the loans categories that have three payments in three months, the last inside the twelve complete months and
 * more than `LENDER_ACTIVE_DAYS` ago, the largest sum first. A payee paid again lately on any account is running, so it is
 * the proposals' to ask. One a saved loan or "Ei ole velan maksu" names, and one the household answered ("Maksettu pois",
 * "En tiedä"), is left out.
 */
export function endedCredits(ctx: Pick<AnalysisContext, "txs" | "recurring" | "standing" | "today">, inputs: UserInputs): EndedCredit[] {
  const window = completeYear(ctx.today);
  const taken = takenBill(inputs);
  const paid = new Set(inputs.marks.flatMap((m) => (m.mark === "in_use" ? (parseCreditPaidSubject(m.subject) ?? []) : [])));
  const byPayee = new Map<string, AnalysisTx[]>();
  const running = new Set(ctx.recurring.filter((s) => s.active).map((s) => fold(s.merchant)));
  for (const t of standingOf(ctx).txs) {
    if (t.amountCents >= 0 || t.isTransfer || t.bookingDate > ctx.today || !LOAN_CATEGORIES.has(t.category)) continue;
    const payee = fold(t.merchant);
    if (daysBetween(t.bookingDate, ctx.today) <= LENDER_ACTIVE_DAYS) running.add(payee);
    const key = `${t.accountId}\u0000${payee}`;
    byPayee.set(key, [...(byPayee.get(key) ?? []), t]);
  }
  const out: EndedCredit[] = [];
  for (const rows of byPayee.values()) {
    const last = rows.reduce((a, b) => (b.day > a.day ? b : a));
    const payee = fold(last.merchant);
    if (running.has(payee) || last.bookingDate < window.from) continue;
    if (new Set(rows.map((t) => monthOf(t.bookingDate))).size < MIN_SERIES_MONTHS) continue;
    const text = fold([last.merchant, last.counterparty, last.description].filter(Boolean).join(" "));
    const lender = isLenderPayment(payee, text) || (isCreditIssuerText(text) && !isLoanText(text));
    if (!lender || paidForOthers(payee, text)) continue;
    const key = seriesId({ direction: "out", accountId: last.accountId, merchant: last.merchant, product: null });
    if (paid.has(key) || cardUnknownAsked(inputs.marks, key, null) || rows.some(taken)) continue;
    out.push({
      key,
      payee: withoutSwedishTwin(last.merchant),
      accountId: last.accountId,
      lastDate: last.bookingDate,
      count: rows.length,
      cents: rows.filter((t) => t.bookingDate >= window.from && t.bookingDate <= window.to).reduce((sum, t) => sum - billCents(t), 0),
    });
  }
  return out.sort((a, b) => b.cents - a.cents || (a.key < b.key ? -1 : 1));
}
