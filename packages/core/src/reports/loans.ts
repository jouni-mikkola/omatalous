/**
 * Decision: which debt to pay down first, and whether the payments hold when the reference rate moves.
 *
 * What the household owes: the loans it saved and the connected accounts that carry debt. Which debts count, and
 * that a saved loan linked to an account counts once, is `householdDebts` of `household-debts.ts`, the one list behind
 * the debt total of this report, of the accounts less the debts in Saldot and of the Säästövinkit loan area. Every
 * figure of a loan is `loans.ts`'s (ADR 0004). This file lays the figures side by side, with the debts that may be
 * in a figure twice because no link says they are one (`maybeTwice` and `overdraftTwice` of `household-debts.ts`).
 */
import type { AnalysisContext } from "../analysis/context.ts";
import { householdDebts, type MaybeTwice, maybeTwice, overdraftTwice } from "../household-debts.ts";
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

// where the loan area of Säästövinkit and the reports' index read them, as before they moved
export { type MaybeTwice, maybeTwice };

// The words the Lainat report shares with Saldot and the loan area of Optimoi, so the three say a thing one way. The
// full sentences that name the debts are the report's own (the web section).

/** What the household did not tell is said so. A figure that is not known is never printed as zero. */
export const FIGURE_UNKNOWN = "ei tiedossa";

/** The short warning for a debt that may be in a total twice (`maybeTwice`). The report adds which debts and what to do. */
export const SAME_DEBT_TWICE = "Sama velka voi olla summassa kahdesti";

/** The name of the accounts less the debts. It holds no home and no investments, so it is not called net worth. */
export const ACCOUNTS_LESS_DEBT = { label: "Tilit miinus velat", sub: "Asunnon ja sijoitusten arvo ei ole mukana." } as const;

/**
 * Loans counted for a figure that cannot be told of them: "yksi laina, jonka korkoa ei tiedetä", "3 lainaa, joiden
 * korkoa ei tiedetä". `after` gives "yhtä lainaa" for a sentence that needs the partitive ("ilman yhtä lainaa, ...").
 * `what` is the field in the partitive.
 */
export const loansWithout = (n: number, what: string, after = false): string =>
  n === 1 ? `${after ? "yhtä lainaa" : "yksi laina"}, jonka ${what} ei tiedetä` : `${n} lainaa, joiden ${what} ei tiedetä`;

/** The reference rate moves the scenario lines tell, in hundredths of a percent: one percentage point down and up. */
const RATE_SHIFTS_BP = [-100, 100] as const;

/**
 * How many loans an interest total leaves out for their rate: they owe and no rate was told. A loan whose balance is
 * dated after the day is left out too, for its balance, and is not one of these.
 */
export const loansWithoutRate = (interest: DebtFigure): number => interest.unknown.filter((u) => !u.counted && u.unknown === "rate").length;

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
  rateBp: number | null;
  reference: Loan["reference"];
  repayment: Loan["repayment"];
  /** The next payment in full and its parts (`loanNextPayment`). A loan that owes nothing has none. */
  payment: NextPayment;
  /** Interest of the 12 months after the day. */
  interest: LoanFigure;
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
  /** How many loans the household saved, linked ones too. The section shows only when there is one. */
  saved: number;
  loans: LoanRow[];
  /** What is owed in all (`householdDebts`). */
  total: DebtFigure;
  /** Interest of the 12 months after the day (`householdDebts`). A loan in `unknown` with `counted: false` owes and has no rate: it is left out. */
  interest: DebtFigure;
  /** False when no loan that owes has a rate: the interest reads "ei tiedossa". */
  interestKnown: boolean;
  /** Loans that `interest` leaves out for their rate (`loansWithoutRate`). */
  withoutRate: number;
  /** The payments of a month (`debtPaymentsPerMonth`). */
  payments: DebtPayments;
  /** Saved loans beside connected cards and loan accounts that may tell the same debt and are not linked: both are in `total`. */
  maybeTwice: readonly MaybeTwice[];
  /** Saved credit lines beside accounts below zero: the debt may be twice in the accounts less the debts, and is once in `total`. */
  overdraftTwice: readonly MaybeTwice[];
}

/** The household's debts on the context's today, each with its figures from `loans.ts`. */
export function loansReport(ctx: Pick<AnalysisContext, "today">, balances: readonly BalanceInput[], inputs: UserInputs): LoansReport {
  const debts = householdDebts(balances, inputs, ctx.today);
  const { day } = debts;
  const accountOf = new Map(balances.map((b) => [b.id, b]));
  const sourceOf = new Map(debts.sources.map((s) => [s.loanId, s]));
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
      rateBp: loan.rateBp,
      reference: loan.reference,
      repayment: loan.repayment,
      payment: loanNextPayment(loan, day),
      interest: loanInterestNext12Months(loan, day),
      payoff: loanPayoffDate(loan),
      scenarios: moves ? RATE_SHIFTS_BP.map((shift) => loanRateScenario(loan, day, shift)).filter((s) => s.movedBp !== 0 && (s.paymentCents !== null || s.interestCents !== null)) : [],
    };
  });
  return {
    day,
    saved: loansOf(inputs).length,
    loans,
    total: debts.total,
    interest: debts.interest,
    interestKnown: debts.interestKnown,
    withoutRate: loansWithoutRate(debts.interest),
    payments: debtPaymentsPerMonth(debts.loans, day),
    maybeTwice: maybeTwice(balances, debts),
    overdraftTwice: overdraftTwice(balances, debts),
  };
}
