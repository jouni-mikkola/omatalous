/**
 * A debt that is partly another user's, and the one way its figures are cut. `loans.ts` counts every loan whole and
 * cuts each cent figure once, at the end, so the parts of a debt's users add up to the debt, to the cent, on every day.
 */
import { partCents } from "./account-use.ts";
import type { Loan, Part } from "./types.ts";

/**
 * A loan as a list of debts holds it (`householdDebts`). `part` is the viewer's part of the debt where that is below
 * the whole: the loan's own fields stay whole, and every cent figure `loans.ts` tells is that part of the whole
 * figure. Left out, the loan counts as it stands.
 */
export type Debt = Loan & { part?: Part };

/** The loan as it stands and the part its figures are cut by, or null for a loan that counts whole. */
export function partly(loan: Debt): { whole: Loan; part: Part } | null {
  if (!loan.part) return null;
  const { part, ...whole } = loan;
  return { whole, part };
}

/** A figure in cents at a part. One that is not known stays so. */
export const centsOf = (cents: number | null, part: Part): number | null => (cents === null ? null : partCents(cents, part));

/** A figure with its reason (`LoanFigure`) at a part. */
export const figureOf = <F extends { cents: number | null }>(figure: F, part: Part): F => (figure.cents === null ? figure : { ...figure, cents: partCents(figure.cents, part) });
