// No view reads this in this release; a later release links a loan to its account and shows the parts.
import { addDays } from "./dates.ts";
import { intervalOf, type LoanUnknown, loanBalanceOn, loanPeriodInterest } from "./loans.ts";
import type { IsoDate, Loan } from "./types.ts";

export interface PaymentSplit {
  interestCents: number | null;
  /** The payment less its interest, so the parts add up to the payment. Negative when the payment did not cover the interest. */
  amortisationCents: number | null;
  unknown: LoanUnknown | null;
}

/**
 * One payment split in two: the interest of one interval on what was owed the day before, and the rest as
 * amortisation. `paidCents` is positive and `day` the due date the payment belongs to, also for a row the bank booked
 * after a weekend.
 */
export function splitLoanPayment(loan: Loan, paidCents: number, day: IsoDate): PaymentSplit {
  const none = (unknown: LoanUnknown): PaymentSplit => ({ interestCents: null, amortisationCents: null, unknown });
  if (loan.rateBp === null) return none("rate");
  const months = intervalOf(loan);
  if (months === null) return none("interval");
  const before = loanBalanceOn(loan, addDays(day, -1));
  if (before.cents === null) return none(before.unknown);
  const interestCents = loanPeriodInterest(Math.max(0, before.cents), loan.rateBp, months);
  return { interestCents, amortisationCents: paidCents - interestCents, unknown: before.unknown };
}
