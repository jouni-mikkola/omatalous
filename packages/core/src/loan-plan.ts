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
 * The interest of one interval of `months` months at a rate in thousandths of a percent: balance × rate × months / 12,
 * to the nearest cent, a half cent up (1 200 000 = thousandths of a percent × months a year). Exact: a product past
 * 2^53 is computed in whole numbers of a wider type. The loan bounds stay under it (the largest balance at the highest
 * rate over twelve months is about 6e14); a rate with a margin and a fixing on top can pass it.
 */
export function intervalInterest(balanceCents: number, rateMilli: number, months: number): number {
  const product = balanceCents * rateMilli * months;
  if (Number.isSafeInteger(product) || ![balanceCents, rateMilli, months].every(Number.isSafeInteger)) return divRound(product, 1_200_000);
  const n = BigInt(balanceCents) * BigInt(rateMilli) * BigInt(months);
  const d = 1_200_000n;
  const rest = ((n % d) + d) % d;
  return Number((n - rest) / d + (2n * rest >= d ? 1n : 0n));
}

/** The interest of one interval at a typed rate in hundredths of a percent (`intervalInterest` at ten times the rate). */
export function loanPeriodInterest(balanceCents: number, rateBp: number, months: number): number {
  return intervalInterest(balanceCents, rateBp * 10, months);
}

/**
 * The payments a loan promises. A payment that holds its interest (annuity, fixed instalment) has its rate, or the split
 * of the payment into interest and repayment would be a guess; otherwise the interest comes on top, and equal principal
 * moves its balance without the rate.
 */
export type Instalments = { months: number; paymentCents: number } & ({ withInterest: true; rateBp: number } | { withInterest: false; rateBp: number | null });

/** No payments to place: the balance stays as stated. `missing` names the field that would have given a plan. */
interface Kept {
  missing: LoanUnknown | null;
}

/** The last due date when it can end the loan; one on or before the balance date says nothing of the days after it. With none the plan counts from the balance date, not the bank's days. */
export const endOf = (loan: Loan): IsoDate | null => (loan.endDate !== null && loan.endDate > loan.balanceDate ? loan.endDate : null);

/** The months between a loan's payments when it names a whole number of them, else null. */
export const intervalOf = (loan: Loan): number | null =>
  loan.intervalMonths !== null && Number.isInteger(loan.intervalMonths) && loan.intervalMonths >= 1 ? loan.intervalMonths : null;

/** The payment typed for a loan, null when none is or it is not above zero. */
export function typedPayment(loan: Loan): number | null {
  const payment = loan.paymentCents;
  return payment !== null && payment > 0 ? payment : null;
}

/** A bullet with a last due date lacks nothing: its balance stays until that day. */
export function planOf(loan: Loan): Instalments | Kept {
  if (loan.repayment === null) return { missing: "repayment" };
  if (loan.repayment === "bullet") return { missing: endOf(loan) === null ? "end_date" : null };
  const months = intervalOf(loan);
  if (months === null) return { missing: "interval" };
  const paymentCents = typedPayment(loan);
  if (paymentCents === null) return { missing: "payment" };
  const { rateBp } = loan;
  const terms = { months, paymentCents };
  if (loan.repayment === "equal_principal") return { ...terms, rateBp, withInterest: false };
  if (rateBp === null) return { missing: "rate" };
  return { ...terms, rateBp, withInterest: true };
}

/** The due dates after the balance date, oldest first, each a whole number of intervals from its anchor. */
export function* dueDates(loan: Loan, months: number): Generator<IsoDate> {
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
