/**
 * Decision: which debt to pay down first, and whether the payments hold when the reference rate moves.
 *
 * What the household owes: the loans it saved and the connected accounts that carry debt. Which loans count is
 * `householdDebts` of `loans.ts`, the one list behind the debt total of this report, of the accounts less the debts in
 * Saldot and of the Säästövinkit loan area, and every figure of a loan is `loans.ts`'s too (ADR 0004). This file lays
 * the figures side by side and names the debts that may be in a figure twice (`maybeTwice`, `overdraftTwice`).
 */
import type { AnalysisContext } from "../analysis/context.ts";
import {
  type DebtFigure,
  type DebtPayments,
  debtPaymentsPerMonth,
  hasReferenceRate,
  householdDebts,
  type HouseholdDebts,
  loanBalanceOn,
  type LoanFigure,
  loanInterestNext12Months,
  loanNextPayment,
  type LoanPayoff,
  loanPayoffDate,
  loanRateScenario,
  type NextPayment,
  type RateScenario,
} from "../loans.ts";
import { type AccountType, type BalanceInput, type IsoDate, isRevolving, type Loan, type UserInputs } from "../types.ts";

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

/** Saved loans and the connected accounts that may tell the debt they tell. */
export interface MaybeTwice {
  loans: readonly { id: string; name: string }[];
  /** Every account that stands beside this set of saved loans. */
  accounts: readonly { id: string; name: string }[];
}

/** The saved loans that owe on the day. A saved loan that owes nothing adds nothing, so it is never named. */
const owing = (debts: HouseholdDebts): Loan[] => debts.saved.filter((loan) => (loanBalanceOn(loan, debts.day).cents ?? 0) > 0);

/** One entry per set of saved loans, with the accounts that stand beside it, so a page says each set once. */
function pairs(balances: readonly BalanceInput[], beside: (account: BalanceInput) => readonly Loan[]): MaybeTwice[] {
  const sets = new Map<string, { loans: MaybeTwice["loans"]; accounts: { id: string; name: string }[] }>();
  for (const b of balances) {
    const loans = beside(b);
    if (!loans.length) continue;
    const key = JSON.stringify(loans.map((l) => l.id));
    const set = sets.get(key) ?? { loans: loans.map((l) => ({ id: l.id, name: l.name })), accounts: [] };
    set.accounts.push({ id: b.id, name: b.name });
    sets.set(key, set);
  }
  return [...sets.values()];
}

/**
 * The debts that may be in the debt total twice, and so in the accounts less the debts too. A loan names no account,
 * so nothing proves that a saved loan and a connected account are one debt, and both count. A connected card that owes
 * stands beside every saved card and credit line that owes, whatever their names: a household calls its card what it
 * likes, and some save it as a credit line. A connected loan account that owes stands beside every saved loan that is
 * no card: the bank shows the mortgage as an account, and the household saved it by hand too.
 */
export function maybeTwice(balances: readonly BalanceInput[], debts: HouseholdDebts): MaybeTwice[] {
  const saved = owing(debts);
  const counted = new Set(debts.connected.map((c) => c.id));
  return pairs(balances, (b) => {
    if (!counted.has(`account:${b.id}`)) return [];
    return saved.filter((loan) => (b.type === "credit_card" ? isRevolving(loan.kind) : loan.kind !== "card"));
  });
}

/**
 * The debts that may be in the accounts less the debts twice and are in the debt total once. An account that is no
 * card and no loan account is no debt of `householdDebts`, so its balance below zero is in the accounts' total alone.
 * Beside a saved credit line that owes it may be that credit, drawn on the account: the saved loan then takes off what
 * the account's minus took already.
 */
export function overdraftTwice(balances: readonly BalanceInput[], debts: HouseholdDebts): MaybeTwice[] {
  const lines = owing(debts).filter((loan) => loan.kind === "credit_line");
  const counted = new Set(debts.connected.map((c) => c.id));
  return pairs(balances, (b) => (!counted.has(`account:${b.id}`) && (b.balanceCents ?? 0) < 0 ? lines : []));
}

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
  /** The type of the connected account the debt is read from, null for a saved loan. */
  accountType: AccountType | null;
  /** Owed on the day. With `unknown` set it is the balance as stated, which no plan moved forward. */
  balance: LoanFigure;
  /** The day the stated balance is from. */
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
  /** How many loans the household saved. The section shows only when there is one. */
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
  /** Saved loans beside connected cards and loan accounts that may tell the same debt: both are in `total`. */
  maybeTwice: readonly MaybeTwice[];
  /** Saved credit lines beside accounts below zero: the debt may be twice in the accounts less the debts, and is once in `total`. */
  overdraftTwice: readonly MaybeTwice[];
}

/** The household's debts on the context's today, each with its figures from `loans.ts`. */
export function loansReport(ctx: Pick<AnalysisContext, "today">, balances: readonly BalanceInput[], inputs: UserInputs): LoansReport {
  const debts = householdDebts(balances, inputs, ctx.today);
  const { day } = debts;
  const typeOf = new Map(balances.map((b) => [`account:${b.id}`, b.type]));
  const loans = debts.loans.map((loan): LoanRow => {
    const balance = loanBalanceOn(loan, day);
    const moves = hasReferenceRate(loan) && loan.rateBp !== null && (balance.cents ?? 0) > 0;
    return {
      id: loan.id,
      name: loan.name,
      lender: loan.lender,
      kind: loan.kind,
      accountType: debts.connected.includes(loan) ? (typeOf.get(loan.id) ?? null) : null,
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
    saved: debts.saved.length,
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
