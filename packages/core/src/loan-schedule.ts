/**
 * The whole remaining term of a loan, payment by payment. Decision: the household decides how much to pay each month
 * and whether to repay extra. Every figure of `loans.ts` reads the payments placed here, so the balance in Lainat and
 * the debt total agree on every day (ADR 0004).
 *
 * Rates are thousandths of a percent (`rateMilli`): a typed rate is `rateBp * 10`, a reference rate from a review day on
 * is `max(0, fixing) + margin` (`ratePathOf`). A loan with no `ratePath` counts at its typed rate on every day.
 */
import { addMonthsToDate, monthIndex, monthOf } from "./dates.ts";
import { dueDates, endOf, type Instalments, intervalInterest, intervalOf, MAX_LOAN_PAYMENTS, planOf, typedPayment } from "./loan-plan.ts";
import type { LoanUnknown } from "./loans.ts";
import { type Fixings, type IsoDate, isRevolving, type Loan, type RatePath } from "./types.ts";

/** One payment of the plan. */
export interface Payment {
  date: IsoDate;
  /** The interest of the interval that ends on the date. Null without a rate. */
  interestCents: number | null;
  amortisationCents: number;
  /** Owed after the payment. */
  balanceCents: number;
}

/** The months a reference rate is reset at. */
const REVIEW_MONTHS = { euribor_3: 3, euribor_6: 6, euribor_12: 12 } as const;

/** The rate in force on a day: the newest of the path on or before it, and the typed rate before the path begins. */
export function rateMilliAt(path: RatePath | undefined, typedBp: number, day: IsoDate): number {
  let milli = typedBp * 10;
  if (path === undefined) return milli;
  for (const [from, rate] of path) {
    if (from > day) break;
    milli = rate;
  }
  return milli;
}

/** The payment that ends a balance in `left` payments at a rate, to the nearest cent, a half cent up. */
export function annuityPayment(balanceCents: number, rateMilli: number, months: number, left: number): number {
  if (left <= 1) return balanceCents;
  const i = (rateMilli * months) / 1_200_000;
  return Math.round(i === 0 ? balanceCents / left : (balanceCents * i) / (1 - (1 + i) ** -left));
}

/**
 * The plan's payments after the balance date, until nothing is owed. The last one pays what is left, so no payment is
 * larger than what is owed with its interest. `from` starts the plan later, on the loan's own due dates: what was owed
 * on a day and the payments after that day, for a plan whose rate or payment changes there. Each interval counts at the
 * rate in force when it starts. An annuity with a last due date and a rate path sets its payment again whenever the rate
 * changes, so it ends on that date (`keepPayment` leaves the payment as it is).
 */
export function* payments(loan: Loan, plan: Instalments, from: { balanceCents: number; after: IsoDate } = { balanceCents: loan.balanceCents, after: loan.balanceDate }, keepPayment = false): Generator<Payment> {
  const end = endOf(loan);
  const path = loan.ratePath;
  const reset = !keepPayment && plan.withInterest && loan.repayment === "annuity" && end !== null && path !== undefined;
  const listed = reset ? [...dueDates(loan, plan.months)] : null;
  const dates = listed ?? dueDates(loan, plan.months);
  const total = listed?.length ?? 0;
  let balance = from.balanceCents;
  let payment = plan.paymentCents;
  let start = from.after;
  let set = plan.rateBp === null ? null : rateMilliAt(path, plan.rateBp, start);
  let index = -1;
  for (const date of dates) {
    index++;
    if (date <= from.after) continue;
    if (balance <= 0) return;
    const rate = plan.rateBp === null ? null : rateMilliAt(path, plan.rateBp, start);
    if (reset && rate !== set) payment = annuityPayment(balance, rate!, plan.months, total - index);
    set = rate;
    const interest = rate === null ? null : intervalInterest(balance, rate, plan.months);
    const planned = plan.withInterest ? payment - interest! : payment;
    const amortisation = date === end || planned > balance ? balance : planned;
    balance -= amortisation;
    start = date;
    yield { date, interestCents: interest, amortisationCents: amortisation, balanceCents: balance };
  }
}

/** The rate a loan's path and the reviews of its reference rate give, and the first review that counts the newest fixing again. */
export function ratePathOf(loan: Loan, fixings: Fixings): { path: RatePath; flatFrom: IsoDate | null } | null {
  const { reference, rateBp, marginBp, rateReviewDate } = loan;
  if (reference === null || reference === "fixed" || rateBp === null || marginBp === null || !rateReviewDate) return null;
  const series = fixings[reference];
  if (series === undefined || series.length === 0) return null;
  const months = REVIEW_MONTHS[reference];
  // every review day is counted from the typed one, never from the one before it, so a 31st does not drift
  const reviewDay = (k: number) => addMonthsToDate(rateReviewDate, k * months);
  // the typed rate holds from the latest review day on or before the balance date
  let k = Math.floor((monthIndex(monthOf(loan.balanceDate)) - monthIndex(monthOf(rateReviewDate))) / months);
  while (reviewDay(k) > loan.balanceDate) k--;
  while (reviewDay(k + 1) <= loan.balanceDate) k++;
  const path: [IsoDate, number][] = [[reviewDay(k), rateBp * 10]];
  const stop = endOf(loan) ?? addMonthsToDate(loan.balanceDate, MAX_LOAN_PAYMENTS);
  const newest = series[series.length - 1]![0];
  let flatFrom: IsoDate | null = null;
  for (let next = Math.max(0, k + 1); reviewDay(next) < stop; next++) {
    const day = reviewDay(next);
    const fixing = series.filter(([on]) => on <= day).at(-1);
    if (fixing === undefined) continue;
    if (flatFrom === null && day > newest) flatFrom = day;
    path.push([day, Math.max(0, fixing[1]) + marginBp * 10]);
    // every later review counts the same fixing again: the rate holds from here on
    if (flatFrom !== null) break;
  }
  return { path, flatFrom };
}

/** What the user asks of a schedule: a payment from the next due date, an extra repayment on a day. */
interface ScheduleChange {
  paymentCents?: number;
  extra?: { cents: number; on: IsoDate };
}

interface ScheduleRow {
  date: IsoDate;
  /** The rate of the interval, in thousandths of a percent. Null without a rate. */
  rateMilli: number | null;
  interestCents: number | null;
  principalCents: number;
  /** The fee of the newest payment a document stated, in every payment to come. Shown apart: it is not in the balance. */
  feeCents: number;
  balanceCents: number;
}

interface Schedule {
  rows: ScheduleRow[];
  /** Null when nothing is left to pay, or the loan never ends. */
  summary: {
    paymentsLeft: number;
    /** Null where a rate is missing. */
    interestLeftCents: number | null;
    endDate: IsoDate;
    /** The first review that counts the newest fixing again: later rates are not published yet. */
    flatFrom: IsoDate | null;
  } | null;
  /** The field the schedule needs: no rows without a plan; `rate` when the interest is not known. */
  unknown: LoanUnknown | null;
  /** The payments do not clear the balance: one does not cover its interest, or the plan runs past `MAX_LOAN_PAYMENTS`. */
  never: boolean;
}

/** The plan a schedule follows: the loan's own, a revolving loan's typed payment each month, or a bullet's interest and its last day. */
function schedulePlan(loan: Loan): Instalments | LoanUnknown {
  if (isRevolving(loan.kind) && loan.repayment === null) {
    const paymentCents = typedPayment(loan);
    if (paymentCents === null) return "payment";
    return loan.rateBp === null ? "rate" : { months: 1, paymentCents, rateBp: loan.rateBp, withInterest: true };
  }
  if (loan.repayment === "bullet") {
    const months = intervalOf(loan);
    if (endOf(loan) === null) return "end_date";
    return months === null ? "interval" : { months, paymentCents: 0, rateBp: loan.rateBp, withInterest: false };
  }
  const plan = planOf(loan);
  return "missing" in plan ? (plan.missing ?? "repayment") : plan;
}

/** What a payment is of the plan: with its interest, or the amortisation alone. */
const paymentOf = (plan: Instalments, p: Payment): number => (plan.withInterest ? p.interestCents! + p.amortisationCents : p.amortisationCents);

/**
 * Where the plan stands on `from`: what is owed, the last due date on or before it (each interval counts at the rate of
 * its own start) and the payment in force, undefined where the plan has none left. What a change starts from.
 */
function startAt(loan: Loan, plan: Instalments, from: IsoDate): { balanceCents: number; last: IsoDate; payment: number | undefined } {
  let balanceCents = loan.balanceCents;
  let last = loan.balanceDate;
  let payment: number | undefined;
  for (const p of payments(loan, plan)) {
    if (p.date <= from) {
      balanceCents = p.balanceCents;
      last = p.date;
    } else if (payment === undefined && p.balanceCents > 0) payment = paymentOf(plan, p);
  }
  return { balanceCents, last, payment };
}

/**
 * The payments after `from` with a change made: the new payment from the next due date, and an extra repayment that
 * lowers the balance on its day. `lower` sets the payment again on that day so the loan still ends on its last due date.
 */
function paymentsAfter(loan: Loan, plan: Instalments, from: IsoDate, change: ScheduleChange, options: { keepPayment: boolean; lower: boolean; end?: IsoDate }): Payment[] {
  const at = startAt(loan, plan, from);
  const target = options.end === undefined ? loan : { ...loan, endDate: options.end };
  const newPayment = change.paymentCents ?? at.payment;
  const step: Instalments = newPayment === undefined ? plan : { ...plan, paymentCents: newPayment };
  const extra = change.extra;
  // the payments up to the day of a later extra repayment, which the change leaves as they are
  const head: Payment[] = [];
  if (extra !== undefined && extra.on > from) {
    for (const p of payments(target, step, { balanceCents: at.balanceCents, after: at.last }, options.keepPayment)) {
      if (p.date > extra.on) break;
      head.push(p);
    }
  }
  const base = head.at(-1);
  const lastDate = base?.date ?? at.last;
  const owed = Math.max(0, (base?.balanceCents ?? at.balanceCents) - (extra?.cents ?? 0));
  let next = step;
  if (options.lower && plan.rateBp !== null && owed > 0) {
    const left = [...dueDates(target, plan.months)].filter((d) => d > lastDate).length;
    next = { ...step, paymentCents: annuityPayment(owed, rateMilliAt(loan.ratePath, plan.rateBp, lastDate), plan.months, left) };
  }
  return [...head, ...payments(target, next, { balanceCents: owed, after: lastDate }, options.keepPayment)];
}

/**
 * The payments of a loan after `from`, each with its rate, interest, repayment and fee, and what is left in all. With a
 * `change` the same, as if the change were made on `from`. Without a plan, or before the balance date, no rows and the
 * field that is missing.
 */
export function loanSchedule(loan: Loan, from: IsoDate, change?: ScheduleChange): Schedule {
  const none = (unknown: LoanUnknown | null): Schedule => ({ rows: [], summary: null, unknown, never: false });
  if (from < loan.balanceDate) return none("before_balance_date");
  const plan = schedulePlan(loan);
  if (typeof plan === "string") return none(plan);
  const ahead = change === undefined ? [...payments(loan, plan)].filter((p) => p.date > from) : paymentsAfter(loan, plan, from, change, { keepPayment: false, lower: false });
  const fee = [...(loan.paymentParts ?? [])].sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0]?.feeCents ?? 0;
  let start = from;
  const rows = ahead.map((p): ScheduleRow => {
    const row = { date: p.date, rateMilli: plan.rateBp === null ? null : rateMilliAt(loan.ratePath, plan.rateBp, start), interestCents: p.interestCents, principalCents: p.amortisationCents, feeCents: fee, balanceCents: p.balanceCents };
    start = p.date;
    return row;
  });
  const unknown = plan.rateBp === null ? "rate" : null;
  const last = rows.at(-1);
  if (last === undefined) return { rows, summary: null, unknown, never: false };
  if (last.balanceCents > 0) return { rows, summary: null, unknown, never: true };
  const interestLeftCents = rows.some((r) => r.interestCents === null) ? null : rows.reduce((sum, r) => sum + r.interestCents!, 0);
  const flat = loan.rateFlatFrom ?? null;
  return { rows, summary: { paymentsLeft: rows.length, interestLeftCents, endDate: last.date, flatFrom: flat !== null && flat < last.date ? flat : null }, unknown, never: false };
}

/** What a change does to the loan's way to its last payment, at today's rates: the term, or the payment, that it moves. */
interface WhatIf {
  /** The payments go on and the loan ends sooner. */
  shorter: { endDate: IsoDate; monthsSooner: number; interestSavedCents: number };
  /** The loan ends when it was to and the payment is lower: an annuity with an extra repayment only. */
  lower: { paymentCents: number; interestSavedCents: number } | null;
}

/**
 * The shorter term and the lower payment of a change. The shorter term keeps the payment and moves the end to the day
 * the balance clears: an annuity sets its payment again at later reviews against that end. Interest saved is what the
 * loan costs from `from` without the change less with it, on the same rates. Null where the loan has no end to compare.
 */
export function loanWhatIf(loan: Loan, from: IsoDate, change: ScheduleChange): WhatIf | null {
  const plan = schedulePlan(loan);
  const base = loanSchedule(loan, from).summary;
  if (typeof plan === "string" || base === null || base.interestLeftCents === null) return null;
  const saved = (left: Payment[]) => base.interestLeftCents! - left.reduce((sum, p) => sum + p.interestCents!, 0);
  // the end of the branch that keeps the payment, then the same branch against that end so later reviews of an annuity aim at it
  const probe = paymentsAfter(loan, plan, from, change, { keepPayment: true, lower: false });
  const end = probe.at(-1);
  if (end === undefined || end.balanceCents > 0) return null;
  const resets = loan.repayment === "annuity" && endOf(loan) !== null;
  const shorter = resets ? paymentsAfter(loan, plan, from, change, { keepPayment: false, lower: false, end: end.date }) : probe;
  const last = shorter.at(-1)!;
  const lowerList = change.extra !== undefined && loan.repayment === "annuity" ? paymentsAfter(loan, plan, from, change, { keepPayment: false, lower: true }) : null;
  const first = lowerList?.find((p) => p.date > (change.extra?.on ?? from));
  return {
    shorter: { endDate: last.date, monthsSooner: monthIndex(monthOf(base.endDate)) - monthIndex(monthOf(last.date)), interestSavedCents: saved(shorter) },
    lower: lowerList === null || first === undefined || lowerList.at(-1)!.balanceCents > 0 ? null : { paymentCents: paymentOf(plan, first), interestSavedCents: saved(lowerList) },
  };
}
