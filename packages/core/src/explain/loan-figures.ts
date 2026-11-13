/**
 * Which figures are the loan figures of `explain/loans.ts`. Kept apart from the calculations so the first page, which
 * only asks the door of a figure, does not load the loan, holdings and transfer code for it.
 */
import type { LoanFigureId } from "./types.ts";

/** The figures whose basis is a calculation: their door says "Näytä laskelma". */
const LOAN_FIGURES = ["loans.total", "loans.interest", "loans.payments", "holdings.loans", "loan.balance", "loan.interest", "loan.payment", "loan.monthly"] as const satisfies readonly LoanFigureId[];

export const isLoanFigure = (figure: string): figure is LoanFigureId => (LOAN_FIGURES as readonly string[]).includes(figure);

/** The figures of one loan: they need the loan's id. */
export const isOneLoan = (figure: LoanFigureId): boolean => figure.startsWith("loan.");
