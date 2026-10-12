/**
 * Loans the user typed in, and every figure told about one. This file is the one owner of each (ADR 0004, ADR 0012): the
 * balance on a day, the debt total, the interest of the next 12 months, the payoff date, a credit line's use, the
 * next payment and the payments of a month (`loanNextPayment`, `debtPaymentsPerMonth`), what a move of the reference
 * rate does to a payment and a year's interest (`loanRateScenario`). Which debts the household has is the list of
 * `household-debts.ts`.
 *
 * How a loan is counted:
 * - Interest of one payment interval is balance × rate × months / 12 (`loanPeriodInterest`). Months, since the loan
 *   does not say how its bank counts days. Every interest figure is rounded once, to the nearest cent, a half cent up.
 * - A loan moves forward from its balance date by its plan, one payment at a time. The balance stays between due
 *   dates, so each payment carries a whole interval's interest. The due dates count back from the last due date.
 *   Without one the first payment is a whole interval after the balance date, the latest it can be, so the balance is
 *   never told too low.
 * - On the last due date whatever is left falls due: a bullet loan, or a larger last instalment.
 * - A figure that needs a field the loan lacks is null and names the field in `unknown`. A loan whose plan lacks a
 *   field keeps its stated balance, and the figures that stand on that balance name the field too.
 *
 * Money flows do not read this file: an instalment is debt whether or not its loan is known.
 */
import { addMonthsToDate, daysBetween, monthIndex, monthOf } from "./dates.ts";
import type { Account, IsoDate, Loan, UserInputs } from "./types.ts";

/** What a figure could not know: a field the loan lacks, or a day before the day its balance was told. */
export type LoanUnknown = "repayment" | "interval" | "payment" | "rate" | "end_date" | "limit" | "before_balance_date";

/**
 * One figure of one loan. `cents: null` is no figure, and `unknown` says why. A figure with `unknown` set stands on
 * the stated balance, which the plan could not move forward without that field.
 */
export type LoanFigure = { cents: number; unknown: LoanUnknown | null } | { cents: null; unknown: LoanUnknown };

/** A sum over loans. `unknown` lists each loan that is left out (`counted: false`) or counted at its stated balance. */
export interface DebtFigure {
  cents: number;
  unknown: readonly { loanId: string; unknown: LoanUnknown; counted: boolean }[];
}

export interface LoanPayoff {
  /** The due date from which nothing is owed. */
  date: IsoDate | null;
  /** The field a date would need. With no date, no `unknown` and no `never`, nothing was owed to begin with. */
  unknown: LoanUnknown | null;
  /** The payments never bring the balance to zero: one does not cover its interest, or the plan runs past `MAX_LOAN_PAYMENTS`. */
  never: boolean;
}

export interface CreditUse {
  /** Owed on the day. */
  usedCents: number | null;
  limitCents: number | null;
  /** Owed over the limit: 1 is a full line, more is over it. */
  share: number | null;
  /** Left to draw, zero at and over the limit. */
  availableCents: number | null;
  /** Owed above the limit, zero within it. */
  overCents: number | null;
  /** `limit` or `before_balance_date`. A credit line rarely has a plan, so a kept balance is not told here. */
  unknown: LoanUnknown | null;
}

/** A plan that takes more payments than this (100 years of months) counts as never ending. */
export const MAX_LOAN_PAYMENTS = 1200;

/** The loans in the inputs. Inputs built without the field have none. */
export const loansOf = (inputs: UserInputs): readonly Loan[] => inputs.loans ?? [];

/**
 * n / d to the nearest whole number, a half up: the rounding of every interest figure in this file. Whole numbers in
 * and out, so no float decides the side of a half cent.
 */
function divRound(n: number, d: number): number {
  const rest = ((n % d) + d) % d;
  return (n - rest) / d + (2 * rest >= d ? 1 : 0);
}

/**
 * The interest of one interval of `months` months: balance × rate × months / 12, to the nearest cent, a half cent up
 * (120 000 = hundredths of a percent × months a year).
 */
export function loanPeriodInterest(balanceCents: number, rateBp: number, months: number): number {
  return divRound(balanceCents * rateBp * months, 120_000);
}

/** The payments a loan promises. */
interface Instalments {
  months: number;
  paymentCents: number;
  /** Null only for equal principal, whose balance moves without the rate. */
  rateBp: number | null;
  /** The payment holds the interest (annuity, fixed instalment). Otherwise the interest comes on top. */
  withInterest: boolean;
}

/** No payments to place: the balance stays as stated. `missing` names the field that would have given a plan. */
interface Kept {
  missing: LoanUnknown | null;
}

/** The last due date when it can end the loan. One on or before the balance date says nothing about the days after it. */
const endOf = (loan: Loan): IsoDate | null => (loan.endDate !== null && loan.endDate > loan.balanceDate ? loan.endDate : null);

/** The months between a loan's payments when it names a whole number of them, else null. */
export const intervalOf = (loan: Loan): number | null =>
  loan.intervalMonths !== null && Number.isInteger(loan.intervalMonths) && loan.intervalMonths >= 1 ? loan.intervalMonths : null;

/** A bullet with a last due date lacks nothing: its balance stays until that day. */
function planOf(loan: Loan): Instalments | Kept {
  if (loan.repayment === null) return { missing: "repayment" };
  if (loan.repayment === "bullet") return { missing: endOf(loan) === null ? "end_date" : null };
  const months = intervalOf(loan);
  if (months === null) return { missing: "interval" };
  if (loan.paymentCents === null || loan.paymentCents <= 0) return { missing: "payment" };
  const withInterest = loan.repayment !== "equal_principal";
  if (withInterest && loan.rateBp === null) return { missing: "rate" };
  return { months, paymentCents: loan.paymentCents, rateBp: loan.rateBp, withInterest };
}

/** The due dates after the balance date, oldest first, each a whole number of intervals from its anchor. */
function* dueDates(loan: Loan, months: number): Generator<IsoDate> {
  const end = endOf(loan);
  if (end === null) {
    for (let k = 1; k <= MAX_LOAN_PAYMENTS; k++) yield addMonthsToDate(loan.balanceDate, k * months);
    return;
  }
  let back = Math.floor((monthIndex(monthOf(end)) - monthIndex(monthOf(loan.balanceDate))) / months);
  // in the balance date's own month the day decides whether that due date is still ahead
  while (addMonthsToDate(end, -back * months) <= loan.balanceDate) back--;
  for (let k = back, n = 0; k >= 0 && n < MAX_LOAN_PAYMENTS; k--, n++) yield addMonthsToDate(end, -k * months);
}

/**
 * The latest due date of a loan's plan on or before a day, null when none has passed since the balance date. A loan
 * with no payments to place has one due date, its last. A plan goes on at its interval past its last due date, for a
 * loan that is still owed after it. Each date is counted from the one before it, as the plan of a loan whose balance
 * is dated there counts them: no due date of that plan lies after the answer and on or before the day.
 */
export function loanLastDueDate(loan: Loan, day: IsoDate): IsoDate | null {
  const plan = planOf(loan);
  if ("missing" in plan) {
    const end = endOf(loan);
    return end !== null && end <= day ? end : null;
  }
  let last: IsoDate | null = null;
  for (;;) {
    const next = dueDates({ ...loan, balanceDate: last ?? loan.balanceDate }, plan.months).next();
    if (next.done || next.value > day) return last;
    last = next.value;
  }
}

interface Payment {
  date: IsoDate;
  /** The interest of the interval that ends on the date. Null without a rate. */
  interestCents: number | null;
  amortisationCents: number;
  /** Owed after the payment. */
  balanceCents: number;
}

/**
 * The plan's payments after the balance date, until nothing is owed. The last one pays what is left, so no payment is
 * larger than what is owed with its interest. `from` starts the plan later, on the loan's own due dates: what was owed
 * on a day and the payments after that day, for a plan whose rate or payment changes there.
 */
function* payments(loan: Loan, plan: Instalments, from: { balanceCents: number; after: IsoDate } = { balanceCents: loan.balanceCents, after: loan.balanceDate }): Generator<Payment> {
  const end = endOf(loan);
  let balance = from.balanceCents;
  for (const date of dueDates(loan, plan.months)) {
    if (date <= from.after) continue;
    if (balance <= 0) return;
    const interest = plan.rateBp === null ? null : loanPeriodInterest(balance, plan.rateBp, plan.months);
    const planned = plan.withInterest ? plan.paymentCents - (interest ?? 0) : plan.paymentCents;
    const amortisation = date === end || planned > balance ? balance : planned;
    balance -= amortisation;
    yield { date, interestCents: interest, amortisationCents: amortisation, balanceCents: balance };
  }
}

/**
 * What is owed on a day: the stated balance moved forward by the plan. A loan without a plan keeps its stated balance
 * until its last due date and names the missing field. Before the balance date nothing is known.
 */
export function loanBalanceOn(loan: Loan, day: IsoDate): LoanFigure {
  if (day < loan.balanceDate) return { cents: null, unknown: "before_balance_date" };
  const plan = planOf(loan);
  if ("missing" in plan) {
    const end = endOf(loan);
    return end !== null && day >= end ? { cents: 0, unknown: null } : { cents: loan.balanceCents, unknown: plan.missing };
  }
  let cents = loan.balanceCents;
  for (const p of payments(loan, plan)) {
    if (p.date > day) break;
    cents = p.balanceCents;
  }
  return { cents, unknown: null };
}

/**
 * The interest of the 12 months after a day: the interest parts of the payments due in them. A loan whose balance
 * stays (no plan, or a bullet) owes its rate on that balance for the days before its last due date, a whole year being
 * balance × rate whatever the year's length. A loan that owes nothing on the day costs nothing at any rate, so it
 * needs no rate to say so.
 */
export function loanInterestNext12Months(loan: Loan, day: IsoDate): LoanFigure {
  if (loan.rateBp === null) {
    const owed = loanBalanceOn(loan, day);
    return owed.cents === 0 ? owed : { cents: null, unknown: "rate" };
  }
  if (day < loan.balanceDate) return { cents: null, unknown: "before_balance_date" };
  const to = addMonthsToDate(day, 12);
  const plan = planOf(loan);
  if ("missing" in plan) {
    const end = endOf(loan);
    if (end !== null && day >= end) return { cents: 0, unknown: null };
    const owedDays = daysBetween(day, end !== null && end < to ? end : to);
    return { cents: divRound(Math.max(0, loan.balanceCents) * loan.rateBp * owedDays, 10_000 * daysBetween(day, to)), unknown: plan.missing };
  }
  let cents = 0;
  for (const p of payments(loan, plan)) {
    if (p.date > to) break;
    if (p.date > day) cents += p.interestCents ?? 0;
  }
  return { cents, unknown: null };
}

/** The due date that brings the balance to zero, at the latest the last due date. */
export function loanPayoffDate(loan: Loan): LoanPayoff {
  if (loan.balanceCents <= 0) return { date: null, unknown: null, never: false };
  const plan = planOf(loan);
  if ("missing" in plan) {
    const end = endOf(loan);
    return { date: end, unknown: end === null ? plan.missing : null, never: false };
  }
  for (const p of payments(loan, plan)) if (p.balanceCents <= 0) return { date: p.date, unknown: null, never: false };
  return { date: null, unknown: null, never: true };
}

/** How much of a credit line or card is in use: the balance on the day over the limit. */
export function creditUse(loan: Loan, day: IsoDate): CreditUse {
  const usedCents = loanBalanceOn(loan, day).cents;
  const limitCents = loan.limitCents;
  if (usedCents === null || limitCents === null || limitCents <= 0) {
    return { usedCents, limitCents, share: null, availableCents: null, overCents: null, unknown: usedCents === null ? "before_balance_date" : "limit" };
  }
  return { usedCents, limitCents, share: usedCents / limitCents, availableCents: Math.max(0, limitCents - usedCents), overCents: Math.max(0, usedCents - limitCents), unknown: null };
}

/**
 * A connected account with credit as a loan, so its use and its debt come from the functions of this file: a card, or
 * an account with a credit limit (kind `credit_line`). The bank reports credit in use as a balance below zero: what is
 * owed is that balance with its sign turned, and nothing when the account is in credit. The sign is the bank's: the
 * Enable Banking connector (`balance()` in `connectors/enable-banking/connector.ts`) stores the amount as given, so a
 * bank that reported a card's debt as a positive number would read here as no debt. The balance is the bank's latest,
 * read as owed on `day`. Null when the bank gave no balance. The id is `account:<account id>`, which no typed loan
 * has, so a list that holds both tells them apart.
 */
export function creditAccountLoan(
  account: { id: string; name: string; type: Account["type"]; balanceCents: number | null; creditLimitCents?: number | null },
  day: IsoDate,
): Loan | null {
  if (account.balanceCents === null) return null;
  return {
    id: `account:${account.id}`,
    name: account.name,
    lender: null,
    kind: account.type === "credit_card" ? "card" : "credit_line",
    grantedCents: null,
    balanceCents: Math.max(0, -account.balanceCents),
    balanceDate: day,
    rateBp: null,
    reference: null,
    marginBp: null,
    repayment: null,
    intervalMonths: null,
    paymentCents: null,
    endDate: null,
    limitCents: account.creditLimitCents ?? null,
    seriesKey: null,
  };
}

function sumOf(loans: readonly Loan[], figure: (loan: Loan) => LoanFigure): DebtFigure {
  let cents = 0;
  const unknown: DebtFigure["unknown"][number][] = [];
  for (const loan of loans) {
    const f = figure(loan);
    cents += f.cents ?? 0;
    if (f.unknown !== null) unknown.push({ loanId: loan.id, unknown: f.unknown, counted: f.cents !== null });
  }
  return { cents, unknown };
}

/** What the household owes on a day: the sum of `loanBalanceOn`. */
export const debtTotalOn = (loans: readonly Loan[], day: IsoDate): DebtFigure => sumOf(loans, (loan) => loanBalanceOn(loan, day));

/** What the debt costs over the 12 months after a day: the sum of `loanInterestNext12Months`. */
export const debtInterestNext12Months = (loans: readonly Loan[], day: IsoDate): DebtFigure => sumOf(loans, (loan) => loanInterestNext12Months(loan, day));

/** The next payment of a loan after a day. */
export interface NextPayment {
  /**
   * The payment in full, its interest in it, never more than what is owed with that interest. Null when nothing is due
   * (`unknown` null: nothing is owed, or the loan is a bullet) and when it is not known (`unknown` names the field).
   */
  cents: number | null;
  /** The interest and the amortisation in it. Null where the plan lacks a field: `unknown` names it. */
  interestCents: number | null;
  amortisationCents: number | null;
  /** Months between payments. Null when the loan does not say. */
  intervalMonths: number | null;
  unknown: LoanUnknown | null;
}

/**
 * The next payment after `day`, read from the plan's own payments (`payments`): the last one is what is left with its
 * interest, and a loan that owes nothing has none. Equal principal pays its interval's interest on top of the typed
 * amortisation. A loan without a plan (a card, a credit line, a loan that lacks its interval or its rate) keeps its
 * balance: a payment typed for it is told as typed, at most what is owed with the interest that can be counted, and
 * its split is not known. A bullet has no payment before its last due date.
 */
export function loanNextPayment(loan: Loan, day: IsoDate): NextPayment {
  const intervalMonths = intervalOf(loan);
  const none = (unknown: LoanUnknown | null): NextPayment => ({ cents: null, interestCents: null, amortisationCents: null, intervalMonths, unknown });
  if (day < loan.balanceDate) return none("before_balance_date");
  if (loan.repayment === "bullet") return none(null);
  const plan = planOf(loan);
  if (!("missing" in plan)) {
    for (const p of payments(loan, plan)) {
      if (p.date <= day) continue;
      const cents = p.interestCents === null ? null : p.interestCents + p.amortisationCents;
      return { cents, interestCents: p.interestCents, amortisationCents: p.amortisationCents, intervalMonths, unknown: cents === null ? "rate" : null };
    }
    return none(null);
  }
  const owed = loanBalanceOn(loan, day).cents ?? 0;
  if (owed <= 0) return none(null);
  if (loan.paymentCents === null || loan.paymentCents <= 0) return none(plan.missing);
  // the typed amortisation is known, the interest on top of it is not
  if (loan.repayment === "equal_principal") return { ...none(plan.missing), amortisationCents: Math.min(loan.paymentCents, owed) };
  const interest = loan.rateBp !== null && intervalMonths !== null ? loanPeriodInterest(owed, loan.rateBp, intervalMonths) : 0;
  return { ...none(plan.missing), cents: Math.min(loan.paymentCents, owed + interest) };
}

/** The payments of a month over a list of loans. */
export interface DebtPayments {
  /**
   * The next payment of each loan spread over its interval: payment / months, each loan's share to the nearest cent, a
   * half cent up, then added.
   */
  monthlyCents: number;
  /** Loans in the sum. */
  counted: number;
  /** Loans left out: they owe and the payment or its interval is not known, or what they owe on the day is not known. */
  unknown: number;
  /** Bullet loans that owe: they have no payment, and what interest they pay before the last due date is not in the sum. */
  bullets: number;
}

/** What the loans take a month on `day`: `loanNextPayment` of each, spread over its interval. A loan that owes nothing adds nothing. */
export function debtPaymentsPerMonth(loans: readonly Loan[], day: IsoDate): DebtPayments {
  const sum = { monthlyCents: 0, counted: 0, unknown: 0, bullets: 0 };
  for (const loan of loans) {
    const next = loanNextPayment(loan, day);
    if (next.cents !== null && next.intervalMonths !== null) {
      sum.monthlyCents += divRound(next.cents, next.intervalMonths);
      sum.counted++;
    } else {
      // a balance dated after the day is no payment of zero: nothing is known of it
      const owed = loanBalanceOn(loan, day).cents;
      if (owed === null || (owed > 0 && loan.repayment !== "bullet")) sum.unknown++;
      else if (owed > 0) sum.bullets++;
    }
  }
  return sum;
}

/** A loan's payment and its interest of a year with the rate moved: what a change in the reference rate does. */
export interface RateScenario {
  /** The move asked for in hundredths of a percent: 100 is one percentage point up. */
  shiftBp: number;
  /**
   * The move the rate made. A fall stops where the reference rate is zero, which leaves the margin (zero for a loan
   * that names no margin), so it can be smaller than `shiftBp` and nothing at all. Null without a rate.
   */
  movedBp: number | null;
  /** The whole rate after the move. Null without a rate. */
  rateBp: number | null;
  /**
   * The next payment in full at that rate, never more than what is owed with its interest. Annuity: the payment that
   * ends the loan in the payments it has left, as a bank sets it when the rate changes. Fixed instalment: the payment
   * as it is, since its term gives way instead. Equal principal: the amortisation with the next interval's interest on
   * top. Null without a plan, and when no payment is left.
   */
  paymentCents: number | null;
  /** The interest parts of the payments due in the 12 months after the day, every one at that rate. */
  interestCents: number | null;
  unknown: LoanUnknown | null;
}

/** Whether a reference rate moves the loan's rate: the loan names one and its rate is not fixed. */
export const hasReferenceRate = (loan: Pick<Loan, "reference">): boolean => loan.reference !== null && loan.reference !== "fixed";

/** The share of a balance one annuity payment is, at `rate` an interval over `n` payments. */
const annuityShare = (rate: number, n: number): number => (rate === 0 ? 1 / n : rate / (1 - (1 + rate) ** -n));

/**
 * The loan with its rate moved by `shiftBp` from `day` on, a fall at most to the margin. A move of zero gives the loan
 * as it is: the next payment of its plan (`loanNextPayment`) and the interest of `loanInterestNext12Months`. A loan without a plan keeps its balance, so only its interest
 * moves. The new annuity payment is the old one scaled by the annuity formula, to the nearest cent: the bank's own
 * rounding and the day its rate is reset decide the real one, so this is what the move does and no quote. An annuity
 * that never ends has no new payment to tell, and names the last due date it lacks.
 */
export function loanRateScenario(loan: Loan, day: IsoDate, shiftBp: number): RateScenario {
  if (loan.rateBp === null) return { shiftBp, movedBp: null, rateBp: null, paymentCents: null, interestCents: null, unknown: "rate" };
  // a rate already under its margin does not rise when the reference rate falls
  const floorBp = Math.min(loan.rateBp, loan.marginBp ?? 0);
  const rateBp = Math.max(floorBp, loan.rateBp + shiftBp);
  const moved = { shiftBp, movedBp: rateBp - loan.rateBp, rateBp };
  const none = (unknown: LoanUnknown | null): RateScenario => ({ ...moved, paymentCents: null, interestCents: null, unknown });
  if (day < loan.balanceDate) return none("before_balance_date");
  const plan = planOf(loan);
  if ("missing" in plan) {
    const interest = loanInterestNext12Months({ ...loan, rateBp }, day);
    return { ...moved, paymentCents: null, interestCents: interest.cents, unknown: interest.unknown };
  }
  // where the plan stands on the day, and the payments it has left from there
  let balance = loan.balanceCents;
  let left = 0;
  let ends = false;
  for (const p of payments(loan, plan)) {
    if (p.date <= day) balance = p.balanceCents;
    else {
      left++;
      ends = p.balanceCents <= 0;
    }
  }
  if (left === 0) return { ...none(null), interestCents: 0 };
  let payment = plan.paymentCents;
  if (loan.repayment === "annuity" && rateBp !== loan.rateBp) {
    if (!ends) return none("end_date");
    const anInterval = (bp: number) => (bp * plan.months) / 120_000;
    payment = Math.round((plan.paymentCents * annuityShare(anInterval(rateBp), left)) / annuityShare(anInterval(loan.rateBp), left));
  }
  // the same plan from the day on, at the new rate and payment
  const to = addMonthsToDate(day, 12);
  let interestCents = 0;
  let paymentCents: number | null = null;
  for (const p of payments(loan, { ...plan, rateBp, paymentCents: payment }, { balanceCents: balance, after: day })) {
    paymentCents ??= p.interestCents! + p.amortisationCents;
    if (p.date > to) break;
    interestCents += p.interestCents!;
  }
  return { ...moved, paymentCents, interestCents, unknown: null };
}
