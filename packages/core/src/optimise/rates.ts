/**
 * What a move of the reference rate does to each loan of the household: Säästövinkit's "Mitä koron nousu tai lasku
 * tekisi lainoille?". The payment and the year's interest at each move come from `loanRateScenario`, the change
 * against today from `loanNextPayment` and `loanInterestNext12Months`, so the page subtracts nothing. Facts only: the
 * moves are fixed steps, never a forecast of the market.
 */
import { householdDebts } from "../household-debts.ts";
import { hasReferenceRate, loanBalanceOn, loanInterestNext12Months, loanNextPayment, loanRateScenario } from "../loans.ts";
import { type BalanceInput, type IsoDate, isRevolving, type UserInputs } from "../types.ts";
import { LOAN_REFERENCE_LABEL } from "./inputs.ts";
import type { LoanRates } from "./types.ts";

/** The moves the table shows, in hundredths of a percentage point: one point down, one and two up. */
export const RATE_MOVES_BP = [-100, 100, 200] as const;

const less = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);

/** Every loan of the household that owes on the day, in `householdDebts` order. A card or a credit line has no payment plan a move could change, so it is left out. */
export function loanRatesOf(balances: readonly BalanceInput[], inputs: UserInputs, day: IsoDate): LoanRates[] {
  const { loans } = householdDebts(balances, inputs, day);
  return loans.flatMap((loan): LoanRates[] => {
    if (isRevolving(loan.kind)) return [];
    const balance = loanBalanceOn(loan, day).cents;
    if (balance === null || balance <= 0) return [];
    const payment = loanNextPayment(loan, day);
    const interest = loanInterestNext12Months(loan, day).cents;
    const moves = hasReferenceRate(loan) && loan.rateBp !== null;
    return [
      {
        loanId: loan.id,
        name: loan.name,
        lender: loan.lender,
        balanceCents: balance,
        rateBp: loan.rateBp,
        reference: loan.reference ? LOAN_REFERENCE_LABEL[loan.reference] : null,
        paymentCents: payment.cents,
        intervalMonths: payment.intervalMonths,
        interestCents: interest,
        moves: moves
          ? RATE_MOVES_BP.map((shift) => {
              const s = loanRateScenario(loan, day, shift);
              return {
                shiftBp: shift,
                movedBp: s.movedBp,
                paymentCents: s.paymentCents,
                paymentChangeCents: less(s.paymentCents, payment.cents),
                interestCents: s.interestCents,
                interestChangeCents: less(s.interestCents, interest),
              };
            })
          : [],
      },
    ];
  });
}
