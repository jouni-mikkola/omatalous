/**
 * The questions of Tarkistettavat about a saved loan: the fact its plan lacks, the payment the bank charges that the plan
 * did not expect, and the mark that sets a question aside. The loan's own form is the answer that settles either; the
 * mark `dismissed` only puts a question away, one subject per loan: `question:loan-terms:<loan id>`. A connected card no
 * saved loan is linked to is asked the same way, by the id its debt has (`account:<account id>`).
 *
 * Decision: the household types the one fact the app cannot find, and sees a payment that departs from the plan once,
 * with the new payment ready to save.
 */
import { billCents } from "./account-use.ts";
import { daysBetween } from "./dates.ts";
import { type LoanProposal, paysSeries } from "./loan-detect.ts";
import { STEADY_BAND } from "./returns.ts";
import { endOf, intervalOf, planOf, typedPayment } from "./loan-plan.ts";
import { payments } from "./loan-schedule.ts";
import { hasReferenceRate } from "./loans.ts";
import { parseSeriesId } from "./series-id.ts";
import { hasMonthly, type MonthlyProposal, paymentOf } from "./shared.ts";
import { type IsoDate, isRevolving, type Loan, type Transaction, type UserMark } from "./types.ts";

/**
 * The facts of a plan a loan can lack, named as the loan form names its fields. `margin` and `review_date` are asked of a
 * loan on a reference rate. `fee` is the fee of each payment of a plan at 0 % that no document, row or answer tells: it
 * is told by the cost of the debt (`debtCost`), not by the loan alone, so `loanTermsGaps` never names it.
 */
export type LoanTermsMissing = "repayment" | "interval" | "payment" | "rate" | "end_date" | "margin" | "review_date" | "fee";

/**
 * Every fact a loan still owing lacks before its payments can be placed, in the order they are asked, so one form can ask
 * them all at once. A card or a credit line has no plan to ask for, and a loan with nothing owed needs none. The order:
 * the way of paying back, then for a bullet its last due date, for any other loan its interval, payment and rate (an
 * equal principal loan is placed without a rate), and for a loan on a reference rate its margin and review day.
 */
export function loanTermsGaps(loan: Loan): LoanTermsMissing[] {
  if (isRevolving(loan.kind) || loan.balanceCents <= 0) return [];
  const gaps: LoanTermsMissing[] = [];
  if (loan.repayment === null) gaps.push("repayment");
  if (loan.repayment === "bullet") {
    if (endOf(loan) === null) gaps.push("end_date");
  } else {
    if (intervalOf(loan) === null) gaps.push("interval");
    if (typedPayment(loan) === null) gaps.push("payment");
    if (loan.repayment !== "equal_principal" && loan.rateBp === null) gaps.push("rate");
  }
  if (hasReferenceRate(loan)) {
    if (loan.marginBp === null) gaps.push("margin");
    if (loan.rateReviewDate == null) gaps.push("review_date");
  }
  return gaps;
}

/** Whether the household may set the question aside. A loan's rate and payment decide every figure of it, and its fee the class, so those keep asking. */
export const loanTermsDismissible = (missing: LoanTermsMissing): boolean => missing !== "rate" && missing !== "payment" && missing !== "fee";

const LOAN_TERMS = "question:loan-terms:";
const SUBJECT = /^question:loan-terms:((?:account:)?[^:,\p{Cc}]{1,64})$/u;

/** The subject of the dismissal for one saved loan, or for a card by its debt's id. */
export const loanTermsSubject = (loanId: string): string => `${LOAN_TERMS}${loanId}`;

/** The loan id a dismissal subject names, or null for any other subject. */
export const parseLoanTermsSubject = (subject: string): string | null => SUBJECT.exec(subject)?.[1] ?? null;

/** Whether the loan's question is set aside. */
export const loanTermsDismissed = (marks: readonly Pick<UserMark, "subject" | "mark">[], loanId: string): boolean => marks.some((m) => m.mark === "dismissed" && m.subject === loanTermsSubject(loanId));

const LOAN_UNKNOWN = "question:loan-unknown:";
const UNKNOWN_SUBJECT = /^question:loan-unknown:(\d{1,9}|none):(.+)$/u;

/**
 * The subject of "En tiedä" on a loan the rows propose: the household does not know what it owes. The subject names the
 * series key and the monthly payment of that day (`none` when the rows tell none), so the question stays away while the
 * payment is the same and asks again when it changes. The mark is `in_use`, as a plan's answer is.
 */
export const loanUnknownSubject = (monthlyCents: number | null, key: string): string => `${LOAN_UNKNOWN}${monthlyCents ?? "none"}:${key}`;

/** The monthly payment (null: none was known) and series key an "En tiedä" subject names, or null for any other subject and for a key no series has. */
export function parseLoanUnknownSubject(subject: string): { monthlyCents: number | null; key: string } | null {
  const [, payment, key] = UNKNOWN_SUBJECT.exec(subject) ?? [];
  if (payment === undefined || key === undefined || !parseSeriesId(key)?.accountId) return null;
  return { monthlyCents: payment === "none" ? null : Number(payment), key };
}

const CREDIT_PAID = "question:credit-paid:";

/** The subject of "Maksettu pois" on the ended payments of `key` (`endedCredits`): the credit was paid off. The mark is `in_use`, and it holds for good. */
export const creditPaidSubject = (key: string): string => `${CREDIT_PAID}${key}`;

/** The series key a "Maksettu pois" subject names, or null for any other subject and for a key no series has. */
export function parseCreditPaidSubject(subject: string): string | null {
  const key = subject.startsWith(CREDIT_PAID) ? subject.slice(CREDIT_PAID.length) : "";
  return parseSeriesId(key)?.accountId ? key : null;
}

/** Whether the household said it does not know what the proposed loan of `key` owes while its monthly payment is `monthlyCents`. */
const loanUnknownAsked = (marks: readonly Pick<UserMark, "subject" | "mark">[], key: string, monthlyCents: number | null): boolean => marks.some((m) => m.mark === "in_use" && m.subject === loanUnknownSubject(monthlyCents, key));

/**
 * Whether the household said "En tiedä" of the card of `key` (`loanUnknownSubject`, with the sum of that day) and `cents`
 * has not risen since by more than `STEADY_BAND`: a card's bills differ each month, so only a clear rise asks again. A
 * sum that was not known holds while it is still not known.
 */
export function cardUnknownAsked(marks: readonly Pick<UserMark, "subject" | "mark">[], key: string, cents: number | null): boolean {
  return marks.some((m) => {
    const said = m.mark === "in_use" ? parseLoanUnknownSubject(m.subject) : null;
    if (said?.key !== key) return false;
    if (said.monthlyCents === null) return cents === null;
    return cents === null || cents <= said.monthlyCents * (1 + STEADY_BAND);
  });
}

/**
 * Whether the household answered a debt nobody saved, so Täydennä lainat no longer asks of it: a plan whose end was told,
 * a loan the rows propose said "En tiedä" at its monthly payment, a card said "En tiedä" while its bill has not risen. The
 * list of Tarkistettavat and the rows of `unsavedDebts` both read it, so a row the list leaves out never links there.
 */
export function unsavedDebtAnswered(
  marks: readonly Pick<UserMark, "subject" | "mark">[],
  debt: { proposal: Pick<LoanProposal, "key" | "plan" | "planAnswer" | "monthlyCents" | "paymentCents"> } | { card: MonthlyProposal<Pick<LoanProposal, "key" | "monthlyCents" | "paymentCents">> },
): boolean {
  if ("card" in debt) return cardUnknownAsked(marks, debt.card.key, paymentOf(debt.card).part);
  const p = debt.proposal;
  if (p.plan) return p.planAnswer !== null;
  return loanUnknownAsked(marks, p.key, hasMonthly(p) ? paymentOf(p).part : null);
}

/** A bank row is the payment of a due date when it falls within this many days of it. */
const DUE_DAYS = 7;
/** The bank's rounding and a fixing day's difference stay inside this: the larger of 1 EUR and 1 % of the expected payment. */
const FITS_MIN_CENTS = 100;
const FITS_PERCENT = 1;

/** Whether a payment the bank took is the one the plan expects. */
const paymentFits = (paidCents: number, expectedCents: number): boolean => Math.abs(paidCents - expectedCents) <= Math.max(FITS_MIN_CENTS, (expectedCents * FITS_PERCENT) / 100);

/** The fields of a bank row that the drift reads. */
type DriftRow = Pick<Transaction, "id" | "accountId" | "merchant" | "amountCents" | "wholeCents" | "bookingDate" | "status">;

/** A payment of a loan's series that the plan did not expect. */
interface LoanDrift {
  rowId: string;
  date: IsoDate;
  /** What the bank took, whole and positive. */
  paidCents: number;
  /** What the plan expected on the nearest due date. */
  expectedCents: number;
  /** The payment to type for the loan: the payment as the loan states it, which for an equal principal is the row less its interest. */
  newPaymentCents: number;
  /** For a loan on a reference rate, the due date the payment moved on, to propose as its review day. Null for the rest. */
  reviewDate: IsoDate | null;
}

/**
 * The newest payment of a saved loan's series, after `after` and after the loan's balance date, that is not the plan's.
 * The row is judged against the plan's payment of the due date nearest to it, within a week; a row with no due date
 * near it (an extra repayment) is not judged, and the question ends when the next judged row fits. A card or a credit
 * line has no plan, so its varying payments are never asked. `others` are the series keys of the household's saved loans.
 */
export function loanDrift(loan: Loan, rows: readonly DriftRow[], others: readonly string[], after: IsoDate): LoanDrift | null {
  const key = loan.seriesKey;
  if (key === null || isRevolving(loan.kind) || loan.balanceCents <= 0) return null;
  const plan = planOf(loan);
  if ("missing" in plan) return null;
  const start = after > loan.balanceDate ? after : loan.balanceDate;
  const own = rows
    .filter((r) => r.status === "booked" && r.amountCents < 0 && r.bookingDate > start && paysSeries(key, r, others))
    .sort((a, b) => (a.bookingDate === b.bookingDate ? (a.id < b.id ? 1 : -1) : a.bookingDate < b.bookingDate ? 1 : -1));
  if (!own.length) return null;
  const last = own[0]!.bookingDate;
  const due: { date: IsoDate; cents: number | null; interestCents: number | null }[] = [];
  for (const p of payments(loan, plan)) {
    if (daysBetween(last, p.date) > DUE_DAYS) break;
    due.push({ date: p.date, cents: p.interestCents === null ? null : p.interestCents + p.amortisationCents, interestCents: p.interestCents });
  }
  for (const row of own) {
    let near: (typeof due)[number] | undefined;
    for (const d of due) {
      const gap = Math.abs(daysBetween(row.bookingDate, d.date));
      if (gap <= DUE_DAYS && (near === undefined || gap < Math.abs(daysBetween(row.bookingDate, near.date)))) near = d;
    }
    if (near === undefined || near.cents === null) continue;
    const paidCents = -billCents(row);
    if (paymentFits(paidCents, near.cents)) return null;
    // an equal principal types the amortisation alone: the interest comes on top
    const newPaymentCents = plan.withInterest ? paidCents : paidCents - (near.interestCents ?? 0);
    if (newPaymentCents <= 0) return null;
    return { rowId: row.id, date: row.bookingDate, paidCents, expectedCents: near.cents, newPaymentCents, reviewDate: hasReferenceRate(loan) ? near.date : null };
  }
  return null;
}
