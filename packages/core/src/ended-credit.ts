/**
 * Payments to a lender or card issuer that stopped inside the twelve complete months. A running series is a loan
 * proposal (`loanProposals`) and a card's bills are the card gap, but payments that stopped more than
 * `LENDER_ACTIVE_DAYS` ago are neither: they are no debt service now, and the rows cannot say whether the credit was
 * paid off or is a card or credit line still owed whose purchases are missing. Tarkistettavat asks once.
 *
 * A lender paid from several accounts is one question: asked by the account of its latest payment, and settled by an
 * answer that names any of its accounts.
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
import { lenderInstalments, paidForOthers } from "./loan-detect.ts";
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

/** An ended series and whether the household answered "Maksettu pois" for it. */
interface ScannedCredit {
  credit: EndedCredit;
  paidOff: boolean;
}

/**
 * The payment series to a lender (a known lender, a payee named for a loan, or a card issuer's name with no word of a
 * loan) of the loans categories that have three payments in three months (all accounts together), the last inside the
 * twelve complete months and no longer a running series, the largest sum first. A payee with an active series, or paid
 * again lately in a payment no series holds, on any account, is running, so it is the proposals' to ask. One a saved loan or "Ei ole velan maksu" names, and one the household answered ("Maksettu pois",
 * "En tiedä"), is left out.
 */
export function endedCredits(ctx: Pick<AnalysisContext, "txs" | "recurring" | "standing" | "today">, inputs: UserInputs): EndedCredit[] {
  return scanEnded(ctx, inputs).flatMap((s) => (s.paidOff ? [] : [s.credit]));
}

/**
 * The credits the household answered "Maksettu pois" for that stopped inside the twelve complete months, the latest
 * payment first. They are no question and no debt, and a list of debts shows them as ended with the day of the last
 * payment, so an answered credit does not vanish from every page.
 */
export function paidOffCredits(ctx: Pick<AnalysisContext, "txs" | "recurring" | "standing" | "today">, inputs: UserInputs): EndedCredit[] {
  return scanEnded(ctx, inputs)
    .flatMap((s) => (s.paidOff ? [s.credit] : []))
    .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : a.key < b.key ? -1 : 1));
}

function scanEnded(ctx: Pick<AnalysisContext, "txs" | "recurring" | "standing" | "today">, inputs: UserInputs): ScannedCredit[] {
  const window = completeYear(ctx.today);
  const taken = takenBill(inputs);
  const paid = new Set(inputs.marks.flatMap((m) => (m.mark === "in_use" ? (parseCreditPaidSubject(m.subject) ?? []) : [])));
  // the series the proposals ask of: a payee with an active one is running. One that is no longer active (`isActiveAt`) is
  // ended from that day, so no day between the proposals and this list asks of nothing
  const series = [...ctx.recurring.filter((s) => s.kind !== "habit"), ...lenderInstalments(ctx)];
  const held = new Set(series.flatMap((s) => s.transactionIds));
  const running = new Set(series.filter((s) => s.active).map((s) => fold(s.merchant)));
  const byLender = new Map<string, AnalysisTx[]>();
  for (const t of standingOf(ctx).txs) {
    if (t.amountCents >= 0 || t.isTransfer || t.bookingDate > ctx.today || !LOAN_CATEGORIES.has(t.category)) continue;
    const payee = fold(t.merchant);
    // a payment no series holds is a lender's few payments (`fewPayments`), a proposal for `LENDER_ACTIVE_DAYS`
    if (!held.has(t.id) && daysBetween(t.bookingDate, ctx.today) <= LENDER_ACTIVE_DAYS) running.add(payee);
    byLender.set(payee, [...(byLender.get(payee) ?? []), t]);
  }
  const out: ScannedCredit[] = [];
  for (const [payee, rows] of byLender) {
    const last = rows.reduce((a, b) => (b.day > a.day ? b : a));
    if (running.has(payee) || last.bookingDate < window.from) continue;
    if (new Set(rows.map((t) => monthOf(t.bookingDate))).size < MIN_SERIES_MONTHS) continue;
    const text = fold([last.merchant, last.counterparty, last.description].filter(Boolean).join(" "));
    const lender = isLenderPayment(payee, text) || (isCreditIssuerText(text) && !isLoanText(text));
    if (!lender || paidForOthers(payee, text)) continue;
    const keyOf = (t: AnalysisTx) => seriesId({ direction: "out", accountId: t.accountId, merchant: t.merchant, product: null });
    const key = keyOf(last);
    const accountKeys = [...new Map(rows.map((t) => [t.accountId, t])).values()].map(keyOf);
    const paidOff = accountKeys.some((k) => paid.has(k));
    if (accountKeys.some((k) => !paid.has(k) && cardUnknownAsked(inputs.marks, k, null)) || rows.some(taken)) continue;
    out.push({
      paidOff,
      credit: {
        key,
        payee: withoutSwedishTwin(last.merchant),
        accountId: last.accountId,
        lastDate: last.bookingDate,
        count: rows.length,
        cents: rows.filter((t) => t.bookingDate >= window.from && t.bookingDate <= window.to).reduce((sum, t) => sum - billCents(t), 0),
      },
    });
  }
  return out.sort((a, b) => b.credit.cents - a.credit.cents || (a.credit.key < b.credit.key ? -1 : 1));
}
