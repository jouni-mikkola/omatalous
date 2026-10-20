/**
 * The plan of a loan: its due dates and the payments it promises, one at a time from the balance date (see loans.ts for
 * how a loan is counted). Every figure of a loan is told in loans.ts; this file only places the payments.
 */
import { addMonthsToDate, monthIndex, monthOf } from "./dates.ts";
import type { LoanUnknown } from "./loans.ts";
import type { IsoDate, Loan } from "./types.ts";

/** A plan that takes more payments than this (100 years of months) counts as never ending. */
export const MAX_LOAN_PAYMENTS = 1200;

/**
 * n / d to the nearest whole number, a half up: the rounding of every interest figure in this file. Whole numbers in
 * and out, so no float decides the side of a half cent.
 */
export function divRound(n: number, d: number): number {
  const rest = ((n % d) + d) % d;
  return (n - rest) / d + (2 * rest >= d ? 1 : 0);
}

/**
 * The interest of one interval of `months` months: balance × rate × months / 12, to the nearest cent, a half cent up
 * (120 000 = hundredths of a percent × months a year).
 */
export function loanPeriodInterest(balanceCents: number, rateBp: number, months: number): number {
  return divRound(balanceCents * rateBp * months, 120_000);
}

/** The payments a loan promises. */
export interface Instalments {
  months: number;
  paymentCents: number;
  /** Null only for equal principal, whose balance moves without the rate. */
  rateBp: number | null;
  /** The payment holds the interest (annuity, fixed instalment). Otherwise the interest comes on top. */
  withInterest: boolean;
}

/** No payments to place: the balance stays as stated. `missing` names the field that would have given a plan. */
interface Kept {
  missing: LoanUnknown | null;
}

/** The last due date when it can end the loan; one on or before the balance date says nothing of the days after it. With none the plan counts from the balance date, not the bank's days. */
export const endOf = (loan: Loan): IsoDate | null => (loan.endDate !== null && loan.endDate > loan.balanceDate ? loan.endDate : null);

/** The months between a loan's payments when it names a whole number of them, else null. */
export const intervalOf = (loan: Loan): number | null =>
  loan.intervalMonths !== null && Number.isInteger(loan.intervalMonths) && loan.intervalMonths >= 1 ? loan.intervalMonths : null;

/** A bullet with a last due date lacks nothing: its balance stays until that day. */
export function planOf(loan: Loan): Instalments | Kept {
  if (loan.repayment === null) return { missing: "repayment" };
  if (loan.repayment === "bullet") return { missing: endOf(loan) === null ? "end_date" : null };
  const months = intervalOf(loan);
  if (months === null) return { missing: "interval" };
  if (loan.paymentCents === null || loan.paymentCents <= 0) return { missing: "payment" };
  const withInterest = loan.repayment !== "equal_principal";
  if (withInterest && loan.rateBp === null) return { missing: "rate" };
  return { months, paymentCents: loan.paymentCents, rateBp: loan.rateBp, withInterest };
}

/** The due dates after the balance date, oldest first, each a whole number of intervals from its anchor. */
function* dueDates(loan: Loan, months: number): Generator<IsoDate> {
  const end = endOf(loan);
  if (end === null) {
    for (let k = 1; k <= MAX_LOAN_PAYMENTS; k++) yield addMonthsToDate(loan.balanceDate, k * months);
    return;
  }
  let back = Math.floor((monthIndex(monthOf(end)) - monthIndex(monthOf(loan.balanceDate))) / months);
  // in the balance date's own month the day decides whether that due date is still ahead
  while (addMonthsToDate(end, -back * months) <= loan.balanceDate) back--;
  for (let k = back, n = 0; k >= 0 && n < MAX_LOAN_PAYMENTS; k--, n++) yield addMonthsToDate(end, -k * months);
}

/**
 * The latest due date of a loan's plan on or before a day, null when none has passed since the balance date. A loan
 * with no payments to place has one due date, its last. A plan goes on at its interval past its last due date, for a
 * loan that is still owed after it. Each date is counted from the one before it, as the plan of a loan whose balance
 * is dated there counts them: no due date of that plan lies after the answer and on or before the day.
 */
export function loanLastDueDate(loan: Loan, day: IsoDate): IsoDate | null {
  const plan = planOf(loan);
  if ("missing" in plan) {
    const end = endOf(loan);
    return end !== null && end <= day ? end : null;
  }
  let last: IsoDate | null = null;
  for (;;) {
    const next = dueDates({ ...loan, balanceDate: last ?? loan.balanceDate }, plan.months).next();
    if (next.done || next.value > day) return last;
    last = next.value;
  }
}

export interface Payment {
  date: IsoDate;
  /** The interest of the interval that ends on the date. Null without a rate. */
  interestCents: number | null;
  amortisationCents: number;
  /** Owed after the payment. */
  balanceCents: number;
}

/**
 * The plan's payments after the balance date, until nothing is owed. The last one pays what is left, so no payment is
 * larger than what is owed with its interest. `from` starts the plan later, on the loan's own due dates: what was owed
 * on a day and the payments after that day, for a plan whose rate or payment changes there.
 */
export function* payments(loan: Loan, plan: Instalments, from: { balanceCents: number; after: IsoDate } = { balanceCents: loan.balanceCents, after: loan.balanceDate }): Generator<Payment> {
  const end = endOf(loan);
  let balance = from.balanceCents;
  for (const date of dueDates(loan, plan.months)) {
    if (date <= from.after) continue;
    if (balance <= 0) return;
    const interest = plan.rateBp === null ? null : loanPeriodInterest(balance, plan.rateBp, plan.months);
    const planned = plan.withInterest ? plan.paymentCents - (interest ?? 0) : plan.paymentCents;
    const amortisation = date === end || planned > balance ? balance : planned;
    balance -= amortisation;
    yield { date, interestCents: interest, amortisationCents: amortisation, balanceCents: balance };
  }
}
