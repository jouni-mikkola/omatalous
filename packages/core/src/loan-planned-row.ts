import { paysSeries } from "./loan-detect.ts";
import { loansOf } from "./loans.ts";
import { isRevolving, type Transaction, type UserInputs } from "./types.ts";

/**
 * Whether a bank row pays a saved loan that the bill calendar walks by its plan (a loan with a plan, not a card or credit
 * line): the plan's row stands for it, so the row is no everyday spending. A row of no such loan is a payment of its own.
 */
export function plannedLoanRow(inputs: UserInputs): (t: Pick<Transaction, "accountId" | "merchant" | "amountCents">) => boolean {
  const loans = loansOf(inputs);
  const keys = loans.flatMap((loan) => loan.seriesKey ?? []);
  const planned = loans.flatMap((loan) => (loan.seriesKey && !isRevolving(loan.kind) ? [loan.seriesKey] : []));
  return (t) => planned.some((key) => paysSeries(key, t, keys));
}
