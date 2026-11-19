/**
 * The list of Täydennä lainat in Tarkistettavat: every debt of the member whose balance, rate or payment is not known,
 * each once, the largest year of payments first. The sources tell the debts (saved loans, connected cards, the loans and
 * instalment plans of the rows, the cards paid and not connected); this file decides that one debt is one row and the
 * rows' order. A debt whose payment is not known has no year of payments: it is listed after the others and is never
 * weighed as 0.
 *
 * Decision: which debts the household still has to tell, so that every debt has a balance, a rate and a payment.
 */
import { loanTermsDismissible, loanTermsGaps, type LoanTermsMissing } from "./loan-terms-answer.ts";
import { intervalOf, typedPayment } from "./loan-plan.ts";
import { loanRateLine, loanSchedule, ratePathOf } from "./loan-schedule.ts";
import { type Fixings, type IsoDate, isRevolving, type Loan } from "./types.ts";

/** A debt of the list as its source tells it. */
export interface ListedDebt {
  /** The debt's id in the list: one id is one debt. */
  id: string;
  /** The series of the debt's payments, null for none: two sources that name one series are one debt, told by the first. */
  seriesId: string | null;
  /** A year of the debt's payments, null when no payment is known. */
  yearCents: number | null;
}

/**
 * The debts once each, in the order they are listed: a known year of payments first, the largest first, then the debts
 * with no known payment in the order the sources told them. The first source to tell a debt keeps it.
 */
export function loanTermsList<D extends ListedDebt>(debts: readonly D[]): D[] {
  const ids = new Set<string>();
  const series = new Set<string>();
  const once = debts.filter((d) => {
    if (ids.has(d.id) || (d.seriesId !== null && series.has(d.seriesId))) return false;
    ids.add(d.id);
    if (d.seriesId !== null) series.add(d.seriesId);
    return true;
  });
  const known = once.filter((d) => d.yearCents !== null).sort((a, b) => b.yearCents! - a.yearCents!);
  return [...known, ...once.filter((d) => d.yearCents === null)];
}

/** The known years of payments of the list added, null when no debt of it has one. */
export function loanTermsListCents(debts: readonly ListedDebt[]): number | null {
  const known = debts.flatMap((d) => (d.yearCents === null ? [] : [d.yearCents]));
  return known.length === 0 ? null : known.reduce((sum, cents) => sum + cents, 0);
}

/** A year of a saved loan's typed payments, null while its payment or its interval is not known. */
export function savedLoanYearCents(loan: Loan): number | null {
  const payment = typedPayment(loan);
  const interval = intervalOf(loan);
  return payment === null || interval === null ? null : Math.round((12 / interval) * payment);
}

/**
 * The facts a saved loan still owing lacks (`loanTermsGaps`), with what `owedCents` says it owes. A loan set aside with
 * "Älä muistuta tästä enää" (`dismissed`) keeps only the rate and the payment, which decide every figure of it. Empty:
 * the loan is complete and leaves the list.
 */
export function openLoanGaps(loan: Loan, owedCents: number, dismissed: boolean): LoanTermsMissing[] {
  const gaps = loanTermsGaps({ ...loan, balanceCents: owedCents });
  return dismissed ? gaps.filter((gap) => !loanTermsDismissible(gap)) : gaps;
}

/** The line a row of the list closes into once its loan is saved: what the loan owes, its rate on the day and its plan's end. */
export interface LoanTermsResult {
  /** The balance saved. */
  owedCents: number;
  /** The rate in force on the day, in thousandths of a percent; null while no rate is known. */
  rateMilli: number | null;
  /** The plan's last due date and the interest left to pay; null for a card or credit line and where the plan does not resolve. */
  endDate: IsoDate | null;
  interestLeftCents: number | null;
}

/** A saved loan's result line on `day`, its rate counted from the published fixings as `loansOf` counts it. */
export function loanTermsResult(loan: Loan, fixings: Fixings, day: IsoDate): LoanTermsResult {
  const rates = ratePathOf(loan, fixings);
  const counted = rates === null ? loan : { ...loan, ratePath: rates.path, rateFlatFrom: rates.flatFrom };
  const summary = isRevolving(loan.kind) ? null : loanSchedule(counted, day).summary;
  return { owedCents: loan.balanceCents, rateMilli: loanRateLine(counted, day)?.rateMilli ?? null, endDate: summary?.endDate ?? null, interestLeftCents: summary?.interestLeftCents ?? null };
}
