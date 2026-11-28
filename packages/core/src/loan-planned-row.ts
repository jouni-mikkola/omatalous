import { paysSeries } from "./loan-detect.ts";
import { loansOf } from "./loans.ts";
import { type IsoDate, isRevolving, type Transaction, type UserInputs } from "./types.ts";

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

/**
 * The plan's rows of the saved loans that no series pays and a bullet loan's lump sum, due from `from` to `until`: what the calendar walks in place of
 * the rows of the bank that `plannedLoanRow` takes out of the everyday spending. Jää palkkapäivänä and the walk of the
 * first page both take these, so the two figures meet on the payday.
 */
export function plannedLoanPayments(
  calendar: { months: readonly { rows: readonly { date: IsoDate; cents: number; state: string; kind: string; seriesId: string | null; lump?: true; onCard?: true }[] }[] },
  from: IsoDate,
  until: IsoDate,
): { date: IsoDate; cents: number }[] {
  return calendar.months.flatMap((m) => m.rows).filter((r) => r.kind === "loan" && (r.seriesId === null || r.lump === true) && r.state !== "paid" && !r.onCard && r.date >= from && r.date <= until).map((r) => ({ date: r.date, cents: r.cents }));
}
