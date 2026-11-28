/**
 * The series that pays a saved loan and the last day its charges count. The bill calendar (Laskut) and `aheadBasis`
 * (the walk and Jää palkkapäivänä) both read them, so the three keep the same charges of a loan's series.
 */
import { type AnalysisContext, standingById } from "./analysis/context.ts";
import { isBillSeries } from "./commitments.ts";
import { fitsPayment, takenSeries } from "./loan-detect.ts";
import { loanNextPayment, loansOf, typedBill } from "./loans.ts";
import type { RecurringSeries } from "./recurring.ts";
import { type IsoDate, isRevolving, type Loan, type UserInputs } from "./types.ts";

/** The series that pays each saved loan that is no card or credit line, by loan id: the one its key names, or the one whose charges fit its typed payment. */
export function payingSeries(ctx: AnalysisContext, inputs: UserInputs, today: IsoDate): Map<string, RecurringSeries> {
  const byId = standingById(ctx);
  const rowsOf = (s: RecurringSeries) => s.transactionIds.flatMap((id) => byId.get(id) ?? []);
  const paying = new Map<string, RecurringSeries>();
  for (const loan of loansOf(inputs)) {
    if (isRevolving(loan.kind)) continue;
    const named = loan.seriesKey ? takenSeries({ marks: [], expectedBills: [], loans: [loan] }) : null;
    const bill = typedBill(loan, today);
    const taken = new Set([...paying.values()].map((s) => s.id));
    const s = ctx.recurring.find((c) => c.active && isBillSeries(c) && !taken.has(c.id) && (named ? named(c, rowsOf(c)) : bill !== null && fitsPayment(bill, c, rowsOf(c))));
    if (s) paying.set(loan.id, s);
  }
  return paying;
}

/** The loan's end date or, with none, the plan's last due date when it falls on or before `until`; null while the loan goes on past `until` or has no day. */
function loanLastChargeDay(loan: Loan, today: IsoDate, until: IsoDate): IsoDate | null {
  if (loan.endDate !== null) return loan.endDate;
  const first = loanNextPayment(loan, today);
  if (first.date === null) return null;
  let end: IsoDate = first.date;
  for (let next = loanNextPayment(loan, first.date); next.date !== null && next.date <= until; next = loanNextPayment(loan, next.date)) end = next.date;
  return loanNextPayment(loan, end).date === null ? end : null;
}

/** The last charge day of each series that pays a loan, by series id, for the loans that have one up to `until`. */
export function loanChargeEnds(ctx: AnalysisContext, inputs: UserInputs, today: IsoDate, until: IsoDate): Map<string, IsoDate> {
  const loans = loansOf(inputs);
  const ends = new Map<string, IsoDate>();
  for (const [loanId, s] of payingSeries(ctx, inputs, today)) {
    const loan = loans.find((l) => l.id === loanId);
    const last = loan ? loanLastChargeDay(loan, today, until) : null;
    if (last !== null) ends.set(s.id, last);
  }
  return ends;
}
