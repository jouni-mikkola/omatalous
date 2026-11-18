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
import { paysSeries } from "./loan-detect.ts";
import { planOf } from "./loan-plan.ts";
import { payments } from "./loan-schedule.ts";
import { hasReferenceRate } from "./loans.ts";
import { type IsoDate, isRevolving, type Loan, type Transaction, type UserMark } from "./types.ts";

/** The facts of a plan a loan can lack, named as the loan form names its fields. `margin` and `review_date` are asked of a loan on a reference rate. */
export type LoanTermsMissing = "repayment" | "interval" | "payment" | "rate" | "end_date" | "margin" | "review_date";

/**
 * The one fact a loan still owing lacks before its payments can be placed, null when none is lacking. A card or a credit
 * line has no plan to ask for, and a loan with nothing owed needs none. A loan on a reference rate whose plan resolves is
 * asked its margin, then the day its rate is reviewed.
 */
export function loanTermsMissing(loan: Loan): LoanTermsMissing | null {
  if (isRevolving(loan.kind) || loan.balanceCents <= 0) return null;
  const plan = planOf(loan);
  if ("missing" in plan) {
    const { missing } = plan;
    return missing === "repayment" || missing === "interval" || missing === "payment" || missing === "rate" || missing === "end_date" ? missing : referenceFact(loan);
  }
  return referenceFact(loan);
}

/** The fact a loan on a reference rate still lacks: the bank's margin, then the day it sets the rate again. */
function referenceFact(loan: Loan): "margin" | "review_date" | null {
  if (!hasReferenceRate(loan)) return null;
  if (loan.marginBp === null) return "margin";
  return loan.rateReviewDate == null ? "review_date" : null;
}

/** Whether the household may set the question aside. A loan's rate and payment decide every figure of it, so those two keep asking. */
export const loanTermsDismissible = (missing: LoanTermsMissing): boolean => missing !== "rate" && missing !== "payment";

const LOAN_TERMS = "question:loan-terms:";
const SUBJECT = /^question:loan-terms:((?:account:)?[^:,\p{Cc}]{1,64})$/u;

/** The subject of the dismissal for one saved loan, or for a card by its debt's id. */
export const loanTermsSubject = (loanId: string): string => `${LOAN_TERMS}${loanId}`;

/** The loan id a dismissal subject names, or null for any other subject. */
export const parseLoanTermsSubject = (subject: string): string | null => SUBJECT.exec(subject)?.[1] ?? null;

/** Whether the loan's question is set aside. */
export const loanTermsDismissed = (marks: readonly Pick<UserMark, "subject" | "mark">[], loanId: string): boolean => marks.some((m) => m.mark === "dismissed" && m.subject === loanTermsSubject(loanId));

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
  paymentCents: number;
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
    const paymentCents = plan.withInterest ? paidCents : paidCents - (near.interestCents ?? 0);
    if (paymentCents <= 0) return null;
    return { rowId: row.id, date: row.bookingDate, paidCents, expectedCents: near.cents, paymentCents, reviewDate: hasReferenceRate(loan) ? near.date : null };
  }
  return null;
}
