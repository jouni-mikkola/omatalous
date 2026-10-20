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
 * - A debt that is partly another user's (`Debt.part`) is counted whole, and each cent figure told of it is cut to the
 *   part once, at the end (`partCents`): the parts of a debt's users add up to the debt, to the cent, on every day.
 *
 * Money flows do not read this file: an instalment is debt whether or not its loan is known.
 */
import { partCents } from "./account-use.ts";
import { addMonthsToDate, daysBetween } from "./dates.ts";
import { centsOf, type Debt, figureOf, partly } from "./debt-part.ts";
import { divRound, endOf, type Instalments, intervalOf, loanLastDueDate, loanPeriodInterest, MAX_LOAN_PAYMENTS, type Payment, payments, planOf } from "./loan-plan.ts";
import type { Account, IsoDate, Loan, UserInputs } from "./types.ts";
import { loanKindOfName } from "./wording-loan-pages.ts";

export { endOf, intervalOf, loanLastDueDate, loanPeriodInterest, MAX_LOAN_PAYMENTS };

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

/** The loans in the inputs. Inputs built without the field have none. */
export const loansOf = (inputs: UserInputs): readonly Loan[] => inputs.loans ?? [];

/**
 * What is owed on a day: the stated balance moved forward by the plan. A loan without a plan keeps its stated balance
 * until its last due date and names the missing field. Before the balance date nothing is known.
 */
export function loanBalanceOn(loan: Debt, day: IsoDate): LoanFigure {
  const cut = partly(loan);
  if (cut) return figureOf(loanBalanceOn(cut.whole, day), cut.part);
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
export function loanInterestNext12Months(loan: Debt, day: IsoDate): LoanFigure {
  const cut = partly(loan);
  if (cut) return figureOf(loanInterestNext12Months(cut.whole, day), cut.part);
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

/**
 * How much of a credit line or card is in use: the balance on the day over the limit. Of a debt at a part, what is
 * used and the limit are parts and what is left is the one less the other, so the two add up to the part of the limit.
 * The whole line decides whether it is over, and the share is the whole line's.
 */
export function creditUse(loan: Debt, day: IsoDate): CreditUse {
  const cut = partly(loan);
  if (cut) {
    const whole = creditUse(cut.whole, day);
    const usedCents = centsOf(whole.usedCents, cut.part);
    const limitCents = centsOf(whole.limitCents, cut.part);
    if (usedCents === null || limitCents === null || whole.overCents === null) return { ...whole, usedCents, limitCents };
    const over = whole.overCents > 0;
    return { ...whole, usedCents, limitCents, availableCents: over ? 0 : Math.max(0, limitCents - usedCents), overCents: over ? Math.max(0, usedCents - limitCents) : 0 };
  }
  const usedCents = loanBalanceOn(loan, day).cents;
  const limitCents = loan.limitCents;
  if (usedCents === null || limitCents === null || limitCents <= 0) {
    return { usedCents, limitCents, share: null, availableCents: null, overCents: null, unknown: usedCents === null ? "before_balance_date" : "limit" };
  }
  return { usedCents, limitCents, share: usedCents / limitCents, availableCents: Math.max(0, limitCents - usedCents), overCents: Math.max(0, usedCents - limitCents), unknown: null };
}

/**
 * A connected account with credit as a loan, so its use and its debt come from the functions of this file: a card, an
 * account with a credit limit (kind `credit_line`), or an account of type loan (the kind its name tells, never a card
 * or a credit line, and no rate, payment or plan until a saved loan is linked to it). Credit in use is a balance below
 * zero: what is owed is that balance with its sign turned, and nothing when the account is in credit. The sync stores a
 * loan account's plus as a minus (`storedBalanceCents`, server), since a bank tells what is owed there with either
 * sign; a card's plus is money the bank owes the holder. The balance is the bank's latest, read as owed on `day`. Null
 * when the bank gave no balance. The id is `account:<account id>`, which no typed loan has.
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
    kind: account.type === "credit_card" ? "card" : account.type === "loan" ? loanKindOfName(account.name) : "credit_line",
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

function sumOf(loans: readonly Debt[], figure: (loan: Debt) => LoanFigure): DebtFigure {
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
export const debtTotalOn = (loans: readonly Debt[], day: IsoDate): DebtFigure => sumOf(loans, (loan) => loanBalanceOn(loan, day));

/** What the debt costs over the 12 months after a day: the sum of `loanInterestNext12Months`. */
export const debtInterestNext12Months = (loans: readonly Debt[], day: IsoDate): DebtFigure => sumOf(loans, (loan) => loanInterestNext12Months(loan, day));

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
  /** The due date of the payment, the plan's own. Null where no plan places it: nothing is due, or a field is missing. */
  date: IsoDate | null;
  unknown: LoanUnknown | null;
}

/**
 * What the bank charges for a loan at one payment, whole: the plan's next payment, else the payment as typed. Null where
 * none is typed. A saved loan with no series linked takes the series this fits (`fitsPayment`), in Asuminen and in the proposals.
 */
export function typedBill(loan: Debt, today: IsoDate): number | null {
  if (loan.paymentCents === null || loan.paymentCents <= 0) return null;
  return loanNextPayment(loan, today).cents ?? loan.paymentCents;
}

/**
 * The next payment after `day`, read from the plan's own payments (`payments`): the last one is what is left with its
 * interest, and a loan that owes nothing has none. Equal principal pays its interval's interest on top of the typed
 * amortisation. A loan without a plan (a card, a credit line, a loan that lacks its interval or its rate) keeps its
 * balance: a payment typed for it is told as typed, at most what is owed with the interest that can be counted, and
 * neither its split nor its due date is known. A bullet has no payment before its last due date.
 */
export function loanNextPayment(loan: Debt, day: IsoDate): NextPayment {
  const cut = partly(loan);
  if (cut) {
    const whole = loanNextPayment(cut.whole, day);
    const interestCents = centsOf(whole.interestCents, cut.part);
    const amortisationCents = centsOf(whole.amortisationCents, cut.part);
    // the payment is its two parts where both are told, so the row adds up in every view
    const cents = whole.cents !== null && interestCents !== null && amortisationCents !== null ? interestCents + amortisationCents : centsOf(whole.cents, cut.part);
    return { ...whole, cents, interestCents, amortisationCents };
  }
  const intervalMonths = intervalOf(loan);
  const none = (unknown: LoanUnknown | null): NextPayment => ({ cents: null, interestCents: null, amortisationCents: null, intervalMonths, date: null, unknown });
  if (day < loan.balanceDate) return none("before_balance_date");
  if (loan.repayment === "bullet") return none(null);
  const plan = planOf(loan);
  if (!("missing" in plan)) {
    for (const p of payments(loan, plan)) {
      if (p.date <= day) continue;
      const cents = p.interestCents === null ? null : p.interestCents + p.amortisationCents;
      return { cents, interestCents: p.interestCents, amortisationCents: p.amortisationCents, intervalMonths, date: p.date, unknown: cents === null ? "rate" : null };
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

/**
 * What the loans take a month on `day`: `loanNextPayment` of each, spread over its interval. A loan that owes nothing
 * adds nothing. A debt at a part adds that part of the whole loan's month.
 */
export function debtPaymentsPerMonth(loans: readonly Debt[], day: IsoDate): DebtPayments {
  const sum = { monthlyCents: 0, counted: 0, unknown: 0, bullets: 0 };
  for (const loan of loans) {
    const cut = partly(loan);
    const whole = cut?.whole ?? loan;
    const next = loanNextPayment(whole, day);
    if (next.cents !== null && next.intervalMonths !== null) {
      const monthly = divRound(next.cents, next.intervalMonths);
      sum.monthlyCents += cut ? partCents(monthly, cut.part) : monthly;
      sum.counted++;
    } else {
      // a balance dated after the day is no payment of zero: nothing is known of it
      const owed = loanBalanceOn(whole, day).cents;
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

/** A rate moved by `shiftBp`, a fall at most to the margin: a rate already under its margin does not rise when the reference rate falls. */
export const movedRate = (rateBp: number, marginBp: number | null, shiftBp: number): number => Math.max(Math.min(rateBp, marginBp ?? 0), rateBp + shiftBp);

/**
 * The plan of a loan from `day` on at `rateBp`: what it owes on the day, how many payments it has left and those
 * payments, at the new rate and, for an annuity, the payment that ends it in the payments it has left (the annuity
 * formula scaled from the old payment). Null for an annuity whose rate moved and which never ends: no new payment to tell.
 */
export function planFrom(loan: Loan, plan: Instalments, day: IsoDate, rateBp: number): { balanceCents: number; left: number; payments: () => Generator<Payment> } | null {
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
  let payment = plan.paymentCents;
  if (left > 0 && loan.repayment === "annuity" && loan.rateBp !== null && rateBp !== loan.rateBp) {
    if (!ends) return null;
    const anInterval = (bp: number) => (bp * plan.months) / 120_000;
    payment = Math.round((plan.paymentCents * annuityShare(anInterval(rateBp), left)) / annuityShare(anInterval(loan.rateBp), left));
  }
  // the same plan from the day on, at the new rate and payment
  const moved = { ...plan, rateBp, paymentCents: payment };
  return { balanceCents: balance, left, payments: () => payments(loan, moved, { balanceCents: balance, after: day }) };
}

/**
 * The loan with its rate moved by `shiftBp` from `day` on, a fall at most to the margin. A move of zero gives the loan
 * as it is: the next payment of its plan (`loanNextPayment`) and the interest of `loanInterestNext12Months`. A loan without a plan keeps its balance, so only its interest
 * moves. The new annuity payment is the old one scaled by the annuity formula, to the nearest cent: the bank's own
 * rounding and the day its rate is reset decide the real one, so this is what the move does and no quote. An annuity
 * that never ends has no new payment to tell, and names the last due date it lacks.
 */
export function loanRateScenario(loan: Debt, day: IsoDate, shiftBp: number): RateScenario {
  const cut = partly(loan);
  if (cut) {
    const whole = loanRateScenario(cut.whole, day, shiftBp);
    return { ...whole, paymentCents: centsOf(whole.paymentCents, cut.part), interestCents: centsOf(whole.interestCents, cut.part) };
  }
  if (loan.rateBp === null) return { shiftBp, movedBp: null, rateBp: null, paymentCents: null, interestCents: null, unknown: "rate" };
  const rateBp = movedRate(loan.rateBp, loan.marginBp, shiftBp);
  const moved = { shiftBp, movedBp: rateBp - loan.rateBp, rateBp };
  const none = (unknown: LoanUnknown | null): RateScenario => ({ ...moved, paymentCents: null, interestCents: null, unknown });
  if (day < loan.balanceDate) return none("before_balance_date");
  const plan = planOf(loan);
  if ("missing" in plan) {
    const interest = loanInterestNext12Months({ ...loan, rateBp }, day);
    return { ...moved, paymentCents: null, interestCents: interest.cents, unknown: interest.unknown };
  }
  const from = planFrom(loan, plan, day, rateBp);
  if (from === null) return none("end_date");
  if (from.left === 0) return { ...none(null), interestCents: 0 };
  const to = addMonthsToDate(day, 12);
  let interestCents = 0;
  let paymentCents: number | null = null;
  for (const p of from.payments()) {
    paymentCents ??= p.interestCents! + p.amortisationCents;
    if (p.date > to) break;
    interestCents += p.interestCents!;
  }
  return { ...moved, paymentCents, interestCents, unknown: null };
}

