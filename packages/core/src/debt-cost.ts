/**
 * What each debt costs, fees in. Decision: the household decides which debt to pay down first, and whether a debt is
 * dear enough to move elsewhere. A debt is judged by its cost and never by its kind: a plan at 0 % with a fee on each
 * payment is dear, an instalment plan with no interest and no fee costs nothing.
 *
 * The yearly cost is the rate at which the payments still to come, fees in, pay off what is owed today (the internal
 * rate of return of those cash flows), compounded monthly to a year. It differs from the legal *todellinen vuosikorko*,
 * which counts from the day the credit was drawn. No tax deduction comes off: interest on a home loan has not been
 * deductible since 2023 and on a student loan it is not deductible either (vero.fi, Vähennykset pääomatuloista). Only
 * debt taken for taxable income is, and nothing here tells that apart from a home loan, so its cost reads too high,
 * which is the safe side.
 */
import { addMonthsToDate, DAYS_PER_MONTH, daysBetween, monthIndex, monthOf } from "./dates.ts";
import { centsOf, type Debt, partly } from "./debt-part.ts";
import { dueDates, endOf, intervalOf } from "./loan-plan.ts";
import { loanSchedule, type ScheduleRow } from "./loan-schedule.ts";
import { loanBalanceOn, loanInterestNext12Months, type LoanUnknown } from "./loans.ts";
import { median } from "./stats.ts";
import { THRESHOLDS } from "./thresholds.ts";
import { type IsoDate, isRevolving, type Loan } from "./types.ts";

/** How dear a debt is by its yearly cost: nothing at all, under 7 %, under 15 %, and 15 % or more (`thresholds.ts`). */
type DebtClass = "free" | "cheap" | "dear" | "very_dear";

/** A payment of the debt's linked series as the bank booked it: the whole sum that left the account, positive, fees in. */
export interface SeriesPayment {
  date: IsoDate;
  cents: number;
}

/** The field the cost needs: a field of the loan's plan, or the fee of a plan at 0 % that nothing tells. */
type DebtCostUnknown = LoanUnknown | "fee";

/** The interest and fees of the payments due in the 12 months after the day. */
interface Cost12 {
  /** `interestCents` and `feeCents` together; the whole cost of those payments where the parts are not known. */
  cents: number;
  /** Null where the rows price the debt and do not split a payment. */
  interestCents: number | null;
  feeCents: number | null;
}

export interface DebtCost {
  /** The yearly cost in thousandths of a percent, as `rateMilli`. Null when it is not known, never 0 for it. */
  rateMilli: number | null;
  /** Null with the rate. */
  costClass: DebtClass | null;
  /** The viewer's part of what the payments of the next 12 months cost. Null when it is not known. */
  next12: Cost12 | null;
  /** The viewer's part of the interest and fees of every payment left. Null when it is not known. */
  leftCents: number | null;
  /** The fee each payment of the whole loan's plan carries. Null where the rows price the debt or nothing tells the fee. */
  feePerPaymentCents: number | null;
  /** The field that leaves the cost unknown. */
  unknown: DebtCostUnknown | null;
}

/** A cash flow of the debt: a payment `months` after the first day of the flows. */
interface Flow {
  months: number;
  cents: number;
}

/** The rate tried at most, in thousandths of a percent: a cost over this is no figure to tell. */
const MAX_RATE_MILLI = 100_000_000;

/** The months from one day to another, a part month by its days. Due dates on the same day of the month are whole months apart. */
const monthsBetween = (from: IsoDate, to: IsoDate): number =>
  monthIndex(monthOf(to)) - monthIndex(monthOf(from)) + (Number(to.slice(8)) - Number(from.slice(8))) / DAYS_PER_MONTH;

/**
 * The day the flows count from: one interval before the first payment left, where the interval that payment pays
 * interest for begins. What is owed on a day inside the interval is owed from its start, so a day mid-interval does not
 * read the interest of a whole interval paid over a part of it as a higher rate.
 */
const flowStart = (firstDue: IsoDate, months: number): IsoDate => addMonthsToDate(firstDue, -months);

/** What the flows are worth on their first day at a yearly rate, less what is owed. Falls as the rate rises. */
const presentValue = (owedCents: number, flows: readonly Flow[], rateMilli: number): number =>
  flows.reduce((sum, f) => sum + f.cents * (1 + rateMilli / 100_000) ** (-f.months / 12), -owedCents);

/**
 * The yearly rate at which the flows pay off what is owed: the highest whole thousandth of a percent whose present
 * value is not below zero, found by halving the range, so the same flows give the same rate on every machine. Null when
 * the flows pay less than is owed (no cost to tell) or cost more than `MAX_RATE_MILLI`.
 */
function yearlyRateMilli(owedCents: number, flows: readonly Flow[]): number | null {
  if (presentValue(owedCents, flows, 0) < 0 || presentValue(owedCents, flows, MAX_RATE_MILLI) > 0) return null;
  let lo = 0;
  let hi = MAX_RATE_MILLI;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (presentValue(owedCents, flows, mid) >= 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The class of a debt: free only when its payments cost not a cent more than is owed. */
function classOf(rateMilli: number, costCents: number): DebtClass {
  if (costCents === 0) return "free";
  if (rateMilli < THRESHOLDS.cheapDebtBelowPoints.value * 1000) return "cheap";
  return rateMilli < THRESHOLDS.dearDebtBelowPoints.value * 1000 ? "dear" : "very_dear";
}

/** The room between a planned payment and a booked one, as the loan rows are matched (`debt-split.ts`). */
const toleranceOf = (cents: number): number =>
  Math.max(THRESHOLDS.loanRowToleranceCents.value, Math.round(cents * THRESHOLDS.loanRowToleranceShare.value));

/** The newest payments read: the median of three is not moved by one odd row. */
const NEWEST_ROWS = 3;

/**
 * The plan's payment a row pays: the one due nearest the row's date, so a row booked before a rate change is read
 * against the payment of its own rate. A row before the plan's first payment is read against that one. The room is
 * the rounding of an annuity, and none for a payment with no interest, which has nothing to round.
 */
function plannedOn(due: readonly ScheduleRow[], date: IsoDate): { cents: number; room: number } {
  const row = due.reduce((a, b) => (Math.abs(daysBetween(date, b.date)) < Math.abs(daysBetween(date, a.date)) ? b : a));
  const cents = row.interestCents! + row.principalCents;
  return { cents, room: row.interestCents === 0 ? 0 : toleranceOf(cents) };
}

/**
 * The fee the rows measure on top of the plan's payments (`due`): 0 when the newest three rows are the plan's payment,
 * their median excess when all three exceed it alike, and null when they tell neither (too few rows, or an extra
 * repayment).
 */
function measuredFee(due: readonly ScheduleRow[], rows: readonly SeriesPayment[]): number | null {
  const newest = [...rows].sort((a, b) => a.date.localeCompare(b.date)).slice(-NEWEST_ROWS);
  if (newest.length < NEWEST_ROWS || due.length === 0) return null;
  const read = newest.map((r) => {
    const planned = plannedOn(due, r.date);
    return { excess: r.cents - planned.cents, room: planned.room };
  });
  const excess = read.map((r) => r.excess);
  const room = Math.max(...read.map((r) => r.room));
  if (read.every((r) => Math.abs(r.excess) <= r.room)) return 0;
  if (read.some((r) => r.excess <= r.room) || Math.max(...excess) - Math.min(...excess) > room) return null;
  return Math.round(median(excess));
}

const unknownCost = (unknown: DebtCostUnknown): DebtCost => ({ rateMilli: null, costClass: null, next12: null, leftCents: null, feePerPaymentCents: null, unknown });

/**
 * Source 1, the plan: the payments of `loanSchedule` after the day, each with its interest, repayment and fee. The fee is
 * the one a document stated, else the one the rows measure. A plan at 0 % with neither has a cost nothing tells (`fee`);
 * a plan with interest and neither costs its interest.
 */
function planCost(loan: Loan, day: IsoDate, owedCents: number, rows: readonly SeriesPayment[]): DebtCost {
  const schedule = loanSchedule(loan, day);
  if (schedule.unknown !== null) return unknownCost(schedule.unknown);
  if (schedule.summary === null) return unknownCost(schedule.never ? "payment" : "end_date");
  const first = schedule.rows[0]!;
  const stated = loan.paymentParts?.length ? first.feeCents : null;
  const interestFree = schedule.rows.every((r) => r.interestCents === 0);
  // each row against the payment of its own date: the plan from the balance date holds those before the day too
  const fee = stated ?? (rows.length > 0 ? measuredFee(loanSchedule(loan, loan.balanceDate).rows, rows) : null) ?? (interestFree ? null : 0);
  if (fee === null) return unknownCost("fee");
  // a revolving loan's plan pays each month, every other the loan's own interval
  const start = flowStart(first.date, isRevolving(loan.kind) ? 1 : (intervalOf(loan) ?? 1));
  const flows = schedule.rows.map((r) => ({ months: monthsBetween(start, r.date), cents: r.interestCents! + r.principalCents + fee }));
  const rateMilli = yearlyRateMilli(owedCents, flows);
  if (rateMilli === null) return unknownCost("payment");
  const to = addMonthsToDate(day, 12);
  const interestCents = loanInterestNext12Months(loan, day).cents;
  const feeCents = fee * schedule.rows.filter((r) => r.date <= to).length;
  const leftCents = flows.reduce((sum, f) => sum + f.cents, -owedCents);
  const next12 = interestCents === null ? null : { cents: interestCents + feeCents, interestCents, feeCents };
  return { rateMilli, costClass: classOf(rateMilli, leftCents), next12, leftCents, feePerPaymentCents: fee, unknown: null };
}

/**
 * Source 2, the rows, for a loan with no rate: the newest payment of its linked series (the median of the newest three)
 * on each due date after the balance date to the last one prices the balance, with no rate asked and none assumed. A
 * level payment costs the same rate from any day of its plan, so the rate is counted from the balance, where it is
 * known. Each payment's cost is what it pays over the balance's fall at that rate.
 */
function rowsCost(loan: Loan, day: IsoDate, rows: readonly SeriesPayment[]): DebtCost {
  const end = endOf(loan);
  const months = intervalOf(loan);
  if (loan.seriesKey === null || rows.length === 0) return unknownCost("rate");
  if (end === null) return unknownCost("end_date");
  if (months === null) return unknownCost("interval");
  const paid = Math.round(median([...rows].sort((a, b) => a.date.localeCompare(b.date)).slice(-NEWEST_ROWS).map((r) => r.cents)));
  const dates = [...dueDates(loan, months)];
  if (dates.length === 0) return unknownCost("end_date");
  const from = flowStart(dates[0]!, months);
  const flows = dates.map((date) => ({ months: monthsBetween(from, date), cents: paid }));
  const rateMilli = yearlyRateMilli(loan.balanceCents, flows);
  if (rateMilli === null) return unknownCost("rate");
  // the balance at that rate, payment by payment: what each payment pays over its fall is its cost, the last one clears it
  const to = addMonthsToDate(day, 12);
  const last = dates.at(-1);
  let balance = loan.balanceCents;
  let start = from;
  let cents = 0;
  let leftCents = 0;
  for (const date of dates) {
    const grown = Math.round(balance * (1 + rateMilli / 100_000) ** (monthsBetween(start, date) / 12));
    const repaid = date === last ? balance : Math.min(balance, paid - (grown - balance));
    if (date > day) leftCents += paid - repaid;
    if (date > day && date <= to) cents += paid - repaid;
    balance -= repaid;
    start = date;
  }
  const costClass = classOf(rateMilli, paid * dates.length - loan.balanceCents);
  return { rateMilli, costClass, next12: { cents, interestCents: null, feeCents: null }, leftCents, feePerPaymentCents: null, unknown: null };
}

/**
 * What a debt costs from `day` on: its yearly cost with fees in, its class, and the interest and fees of its next 12
 * months, the viewer's part of the debt. `rows` are the payments of the loan's linked series (`seriesKey`), which
 * measure a fee a plan does not state and price a loan with no rate. The rate of a debt that changes rate on a day
 * (`ratePath`), a promotional rate that ends among them, is judged over the whole plan left.
 *
 * Null when the debt owes nothing on the day, and for a card whose statement is paid in full (`settledCardLoan`): it
 * costs nothing and is no debt to pay down. A cost that is not known has no rate, no class and no 12 months, and names
 * the missing field: an unknown cost is never 0.
 */
export function debtCost(debt: Debt, day: IsoDate, rows: readonly SeriesPayment[] = []): DebtCost | null {
  const cut = partly(debt);
  const loan = cut?.whole ?? debt;
  // a revolving debt has no repayment type of its own: one with a bullet is a card paid in full
  if (isRevolving(loan.kind) && loan.repayment === "bullet") return null;
  const owed = loanBalanceOn(loan, day);
  if (owed.cents === null) return unknownCost(owed.unknown);
  if (owed.cents <= 0) return null;
  const cost = loan.rateBp === null ? rowsCost(loan, day, rows) : planCost(loan, day, owed.cents, rows);
  if (!cut) return cost;
  const part = (cents: number | null) => centsOf(cents, cut.part);
  if (cost.next12 === null) return { ...cost, leftCents: part(cost.leftCents) };
  const { interestCents, feeCents } = cost.next12;
  // each part cut on its own and the whole their sum, so the parts the drill shows add up to it
  const next12 = interestCents === null || feeCents === null ? { cents: part(cost.next12.cents)!, interestCents, feeCents } : { cents: part(interestCents)! + part(feeCents)!, interestCents: part(interestCents), feeCents: part(feeCents) };
  return { ...cost, next12, leftCents: part(cost.leftCents) };
}
