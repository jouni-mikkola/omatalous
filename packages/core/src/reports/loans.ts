/**
 * Decision: which debt to pay down first, and whether the payments hold when the reference rate moves.
 *
 * What the household owes: the loans it saved and the connected accounts that carry debt. Which debts count, and
 * that a saved loan linked to an account counts once, is `householdDebts` of `household-debts.ts`, the one list behind
 * the debt total of this report, of the accounts less the debts in Saldot and of the Säästövinkit loan area. Every
 * figure of a loan is `loans.ts`'s (ADR 0004). This file lays the figures side by side, with the debts that may be
 * in a figure twice because no link says they are one (`maybeTwice` and `overdraftTwice` of `household-debts.ts`).
 */
import { bufferCash } from "../analysis/buffer-cash.ts";
import { debtsOf } from "../analysis/card-settled.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { type DebtCost, debtCost } from "../debt-cost.ts";
import type { Debt } from "../debt-part.ts";
import { type ConsolidationBasis, consolidationBasis, payoffPlan, type PayoffPlan } from "../debt-plan.ts";
import { type DebtPath, debtPath } from "../loan-path.ts";
import { typedRateBpOn } from "../loan-schedule.ts";
import { type MaybeTwice, maybeTwice, overdraftTwice } from "../household-debts.ts";
import { debtPayments, type UnsavedRow, unsavedDebts } from "../holdings.ts";
import {
  type DebtFigure,
  type DebtPayments,
  debtPaymentsPerMonth,
  hasReferenceRate,
  loanBalanceOn,
  type LoanFigure,
  loanInterestNext12Months,
  loanNextPayment,
  type LoanPayoff,
  loanPayoffDate,
  loanRateScenario,
  loansOf,
  type NextPayment,
  type RateScenario,
} from "../loans.ts";
import type { AccountType, BalanceInput, IsoDate, Loan, Part, UserInputs } from "../types.ts";

export type { MaybeTwice };

/** The reference rate moves the scenario lines tell, in hundredths of a percent: one percentage point down and up. */
const RATE_SHIFTS_BP = [-100, 100] as const;

/**
 * How many loans an interest total leaves out for their rate: they owe and no rate was told. A loan whose balance is
 * dated after the day is left out too, for its balance, and is not one of these.
 */
const loansWithoutRate = (interest: DebtFigure): number => interest.unknown.filter((u) => !u.counted && u.unknown === "rate").length;

/** One debt and its figures on the report's day. */
export interface LoanRow {
  /** The saved loan's id, or `account:<account id>` for a connected account. */
  id: string;
  name: string;
  lender: string | null;
  kind: Loan["kind"];
  /** The type of the connected account when the row is that account alone. Null for a saved loan, linked or not. */
  accountType: AccountType | null;
  /**
   * The connected account a saved loan is linked to, when the link holds (`householdDebts`): the row is the saved loan
   * with that account's balance, and the pair is in every total once. Null for every other row, also for a saved loan
   * whose `accountId` names an account that is gone, is no card or loan account any more, or has no balance.
   */
  linkedAccount: { id: string; name: string } | null;
  /** Who typed the loan in, when that is another member (`Loan.typedBy`): the viewer cannot change or link such a loan. Left out on every other row. */
  typedBy?: string;
  /**
   * The viewer's part of the debt where it is below the whole (`HouseholdDebts.parts`): every cent figure of the row
   * is that part of the debt's own. Left out, the debt is all the viewer's, as every debt is in the household's view.
   */
  part?: Part;
  /** Owed on the day. With `unknown` set it is the balance as stated, which no plan moved forward. */
  balance: LoanFigure;
  /**
   * The day the stated balance is from: the report's day for a connected account. For a linked pair it is the latest
   * due date of the saved loan's plan on or before the report's day, or the saved loan's own balance date when none
   * has passed or when the account's balance is the older of the two (the row then holds the typed balance).
   */
  balanceDate: IsoDate;
  /** The typed rate in force on the day: after the day of a step in it, the step's rate. Not the cost: that is `cost.rateMilli`. */
  rateBp: number | null;
  reference: Loan["reference"];
  repayment: Loan["repayment"];
  /** The next payment in full and its parts (`loanNextPayment`). A loan that owes nothing has none. */
  payment: NextPayment;
  /** Interest of the 12 months after the day. */
  interest: LoanFigure;
  /**
   * What the debt costs (`debtCost`): Todellinen korko, its class, and Korot ja kulut 12 kk split into interest and fees.
   * Null when the debt owes nothing or is a card paid in full. A cost that is not known has no rate, class or 12 months
   * and `cost.unknown` names the field that is missing.
   */
  cost: DebtCost | null;
  payoff: LoanPayoff;
  /**
   * The payment and the year's interest with the reference rate moved by each of `RATE_SHIFTS_BP`. None for a loan a
   * reference rate does not move, one without a rate or with nothing owed, and no line for a fall that has no room or
   * for a move that has no figure to tell (an annuity that never ends).
   */
  scenarios: readonly RateScenario[];
}

export interface LoansReport {
  day: IsoDate;
  /** How many loans the household saved, linked ones too. The section shows only when there is one or `unsaved` has a row. */
  saved: number;
  loans: LoanRow[];
  /** The loans the rows show and the cards whose bills the rows show that nobody saved: no balance is known, so `total` holds none of them (`unsavedDebts`). */
  unsaved: readonly UnsavedRow[];
  /** What is owed in all (`householdDebts`). */
  total: DebtFigure;
  /** False when a loan is left out of `total` for its balance date (`householdDebts`): the total reads "ei tiedossa". */
  totalKnown: boolean;
  /** Interest of the 12 months after the day (`householdDebts`). A loan in `unknown` with `counted: false` is left out. */
  interest: DebtFigure;
  /** False when any loan is left out of `interest`: the interest reads "ei tiedossa", never the part that is known. */
  interestKnown: boolean;
  /** Loans that `interest` leaves out for their rate (`loansWithoutRate`). */
  withoutRate: number;
  /** Korot ja kulut 12 kk: the sum of the rows' `cost.next12`, null while any debt that owes has none. */
  cost12: Cost12Total;
  /**
   * The way out of debt on the debts' own payments, the payment of each ended debt rolled into the dearest next, with
   * the Puskuri buffer filled first (`payoffPlan` at no extra money). Null while `cost12` is, so never a debt-free
   * date of a part of the debts.
   */
  plan: PayoffPlan | null;
  /** The dear debts a new loan could take over (`consolidationBasis`), with what they cost from here. Null when none qualify and while `cost12` is null. */
  consolidation: ConsolidationBasis | null;
  /** The payments of a month (`debtPaymentsPerMonth`). */
  payments: DebtPayments;
  /**
   * The loans from the day to the day they are paid (`debtPath`): what is owed and the interest still to come, with a
   * line for each move of `RATE_SHIFTS_BP`. The Lainat chart draws it. Null when a debt that owes cannot be projected:
   * the path of the rest would tell a part as the whole.
   */
  path: DebtPath | null;
  /** Saved loans beside connected cards and loan accounts that may tell the same debt and are not linked: both are in `total`. */
  maybeTwice: readonly MaybeTwice[];
  /** Saved credit lines beside accounts below zero: the debt may be twice in the accounts less the debts, and is once in `total`. */
  overdraftTwice: readonly MaybeTwice[];
}

/** Korot ja kulut 12 kk of all the debts, and its parts where every debt splits them. */
interface Cost12Total {
  cents: number | null;
  interestCents: number | null;
  feeCents: number | null;
}

/** The classes from the dearest to the cheapest. */
const CLASSES_DEAREST_FIRST: readonly NonNullable<DebtCost["costClass"]>[] = ["very_dear", "dear", "cheap", "free"];

/**
 * The 12-month cost of the debts added up. A debt that owes nothing adds nothing; one whose cost is not known leaves the
 * whole null, never the sum of the others, and so does a debt the household has not saved (`lacksTerms`): it costs money
 * with no terms to price. A part is null when a debt does not split it.
 */
function cost12Of(costs: readonly (DebtCost | null)[], lacksTerms: boolean): Cost12Total {
  if (lacksTerms) return { cents: null, interestCents: null, feeCents: null };
  const sum = { cents: 0, interestCents: 0 as number | null, feeCents: 0 as number | null };
  for (const cost of costs) {
    if (cost === null) continue;
    if (cost.next12 === null) return { cents: null, interestCents: null, feeCents: null };
    sum.cents += cost.next12.cents;
    sum.interestCents = sum.interestCents === null || cost.next12.interestCents === null ? null : sum.interestCents + cost.next12.interestCents;
    sum.feeCents = sum.feeCents === null || cost.next12.feeCents === null ? null : sum.feeCents + cost.next12.feeCents;
  }
  return sum;
}

/**
 * The rows in the order the Lainat list shows them: the debts that cost something by Todellinen korko, highest first,
 * then the class, dearest first; then the debts whose cost is not known; a debt that is Maksuton (free) last, as it is
 * the last to pay down. Rows still equal go by the cost of the 12 months, highest first, a row without that figure after
 * those with one, and by the order given where both are equal. Only the order changes: no row, figure or sum does. A
 * pure view of rows, so `LoansReport.loans` itself stays in the order the debts are listed (saved loans, then connected
 * accounts).
 */
export function inCostOrder(rows: readonly LoanRow[]): LoanRow[] {
  const part = (r: LoanRow) => (r.cost?.rateMilli == null ? 1 : r.cost.costClass === "free" ? 2 : 0);
  const rate = (r: LoanRow) => r.cost?.rateMilli ?? Number.NEGATIVE_INFINITY;
  const dearness = (r: LoanRow) => (r.cost?.costClass ? CLASSES_DEAREST_FIRST.length - CLASSES_DEAREST_FIRST.indexOf(r.cost.costClass) : Number.NEGATIVE_INFINITY);
  const year = (r: LoanRow) => r.cost?.next12?.cents ?? Number.NEGATIVE_INFINITY;
  const byDescending = (a: number, b: number) => (a === b ? 0 : a < b ? 1 : -1);
  return [...rows].sort((a, b) => part(a) - part(b) || byDescending(rate(a), rate(b)) || byDescending(dearness(a), dearness(b)) || byDescending(year(a), year(b)));
}

/** The household's debts on the context's today, each with its figures from `loans.ts`. */
export function loansReport(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): LoansReport {
  const debts = debtsOf(ctx, balances, inputs);
  const { day } = debts;
  const accountOf = new Map(balances.map((b) => [b.id, b]));
  const sourceOf = new Map(debts.sources.map((s) => [s.loanId, s]));
  const unsaved = unsavedDebts(ctx, inputs);
  // the same rows the front page and Tarkistettavat price each debt from, so a debt costs the same on every page
  const keys = debts.loans.flatMap((l) => l.seriesKey ?? []);
  const rowsOf = (debt: Debt) => debtPayments(ctx, debt, keys);
  const loans = debts.loans.map((loan): LoanRow => {
    const balance = loanBalanceOn(loan, day);
    const moves = hasReferenceRate(loan) && loan.rateBp !== null && (balance.cents ?? 0) > 0;
    const source = sourceOf.get(loan.id);
    const account = source ? accountOf.get(source.accountId) : undefined;
    const part = debts.parts.get(loan.id);
    return {
      id: loan.id,
      name: loan.name,
      lender: loan.lender,
      kind: loan.kind,
      accountType: source && !source.linked ? (account?.type ?? null) : null,
      linkedAccount: source?.linked && account ? { id: account.id, name: account.name } : null,
      ...(loan.typedBy ? { typedBy: loan.typedBy } : {}),
      ...(part ? { part } : {}),
      balance,
      balanceDate: loan.balanceDate,
      rateBp: typedRateBpOn(loan, day),
      reference: loan.reference,
      repayment: loan.repayment,
      payment: loanNextPayment(loan, day),
      interest: loanInterestNext12Months(loan, day),
      cost: debtCost(loan, day, rowsOf(loan)),
      payoff: loanPayoffDate(loan),
      scenarios: moves ? RATE_SHIFTS_BP.map((shift) => loanRateScenario(loan, day, shift)).filter((s) => s.movedBp !== 0 && (s.paymentCents !== null || s.interestCents !== null)) : [],
    };
  });
  const cost12 = cost12Of(
    loans.map((l) => l.cost),
    unsaved.rows.length > 0 || unsaved.few > 0,
  );
  // a buffer nothing tells is no step before the debts: the plan keeps its dates for the debts alone
  const cash = bufferCash(ctx, balances, inputs);
  const buffer = { netCents: cash.netCents ?? 0, spendCents: cash.netCents === null ? 0 : (cash.spendExpected ?? 0) };
  return {
    day,
    saved: loansOf(inputs).length,
    loans,
    unsaved: unsaved.rows,
    total: debts.total,
    totalKnown: debts.totalKnown,
    interest: debts.interest,
    interestKnown: debts.interestKnown,
    withoutRate: loansWithoutRate(debts.interest),
    cost12,
    plan: cost12.cents === null ? null : payoffPlan(debts.loans, day, 0, buffer, rowsOf),
    consolidation: cost12.cents === null ? null : consolidationBasis(debts.loans, day, rowsOf),
    payments: debtPaymentsPerMonth(debts.loans, day),
    path: debtPath(debts.loans, day, RATE_SHIFTS_BP),
    maybeTwice: maybeTwice(balances, debts),
    overdraftTwice: overdraftTwice(balances, debts),
  };
}
