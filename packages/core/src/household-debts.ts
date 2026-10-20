/**
 * The debts of the household: the one list behind each debt total (the Lainat report, the accounts less the debts in
 * Saldot, the loan area of Säästövinkit). This file alone decides which debts count, that one debt counts once
 * (ADR 0004) and how much of a debt is the viewer's. Every figure of a single loan stays in `loans.ts`. The debts that
 * may still be in a figure twice, because no link says they are one, are named here too (`maybeTwice`,
 * `overdraftTwice`).
 */
import { partCents } from "./account-use.ts";
import type { Debt } from "./debt-part.ts";
import type { LoanProposal } from "./loan-detect.ts";
import { creditAccountLoan, type DebtFigure, debtInterestNext12Months, debtTotalOn, loanBalanceOn, loanLastDueDate, loansOf } from "./loans.ts";
import { parseSeriesId } from "./recurring.ts";
import { type Account, type BalanceInput, type IsoDate, isRevolving, type Loan, type Part, type UserInputs } from "./types.ts";

/** The account types whose balance below zero is a debt. A checking account's overdraft stays in the accounts' total. */
export const DEBT_ACCOUNT_TYPES: readonly Account["type"][] = ["credit_card", "loan"];

/** The account a debt of `HouseholdDebts.connected` reads its balance from. */
export interface DebtSource {
  /** The debt's id in `connected`: the saved loan's id for a linked pair, `account:<account id>` otherwise. */
  loanId: string;
  accountId: string;
  /** The debt is a saved loan the household linked to the account (`Loan.accountId`): its terms are the saved loan's. */
  linked: boolean;
  /** The saved loan of a linked pair as it was typed, null with no link: what the pair counts as on a day its account tells nothing. It carries the account's part. */
  typed: Debt | null;
}

/**
 * A connected account as the debts read it: what `creditAccountLoan` reads, when the bank gave the balance, and the
 * viewer's part of the account. With a part below the whole the balance and the limit are that part already (the
 * request's balances are cut where they are read), so a debt the account tells is never cut a second time.
 */
export type DebtAccount = Parameters<typeof creditAccountLoan>[0] & { balanceAt?: string | null; part?: Part; loanPayment?: boolean };

/** A part below the whole: some of the account is another user's. */
export const belowWhole = (part: Part | undefined): part is Part => part !== undefined && part.to - part.from < part.of;

/**
 * The account in view a saved loan's payments leave: the one its series key names (`Loan.seriesKey`, the id of the
 * payments' series, which holds their account). Undefined for a loan with no payments linked yet, and when that
 * account is not in view.
 */
export function paidFrom<A extends { id: string }>(loan: Pick<Loan, "seriesKey">, accounts: readonly A[]): A | undefined {
  const series = loan.seriesKey === null ? null : parseSeriesId(loan.seriesKey);
  return series?.direction === "out" ? accounts.find((a) => a.id === series.accountId) : undefined;
}

/** A typed loan's own sums at a part: the terms that stand beside an account's balance that is that part already. */
function atPart(loan: Loan, part: Part): Loan {
  const cents = (whole: number | null) => (whole === null ? null : partCents(whole, part));
  return { ...loan, balanceCents: partCents(loan.balanceCents, part), grantedCents: cents(loan.grantedCents), paymentCents: cents(loan.paymentCents), limitCents: cents(loan.limitCents) };
}

/**
 * The day an account's balance stands for: the day of `balanceAt`, and `today` when that is unknown or in the future
 * (a clock error). The day walk of Saldot and the link of a saved loan read the one answer.
 */
export const balanceDayOf = (balanceAt: string | null | undefined, today: IsoDate): IsoDate => {
  const given = balanceAt && /^\d{4}-\d{2}-\d{2}/.test(balanceAt) ? balanceAt.slice(0, 10) : today;
  return given < today ? given : today;
};

interface HouseholdDebts {
  /** The day the debts are told on. */
  day: IsoDate;
  /**
   * The saved loans that are no connected account's debt, in the order they were saved. The accounts' total does not
   * hold them. A saved loan linked to an account is in `connected` instead. One whose payments leave an account that
   * is partly another user's carries the viewer's `part`, and `loans.ts` cuts its figures by it.
   */
  saved: readonly Debt[];
  /**
   * The debts a connected account tells, in the accounts' order. Their balances are in the accounts' total. An account
   * no saved loan is linked to counts when it owes something, as the bank tells it (`creditAccountLoan`). A linked pair
   * is the saved loan with the account's balance, dated on the plan's latest due date: one debt, whatever the account
   * owes. A pair whose account's balance is older than the typed one is the saved loan as typed. None carries a
   * `part`: the sums of each are the viewer's part already.
   */
  connected: readonly Debt[];
  /** One for each debt of `connected`, in its order: the account behind it, and whether a saved loan is linked to it. */
  sources: readonly DebtSource[];
  /** `saved` then `connected`. */
  loans: readonly Debt[];
  /** The viewer's part of each debt of `loans` that is below the whole, by the debt's id, so a row can say it. A debt without one is all the viewer's. */
  parts: ReadonlyMap<string, Part>;
  /** What is owed in all on the day: `debtTotalOn` of `loans`. */
  total: DebtFigure;
  /** What the debt costs over the 12 months after the day: `debtInterestNext12Months` of `loans`. */
  interest: DebtFigure;
  /**
   * False when the interest has no figure to tell: a loan is left out for its rate and no loan that owes is counted.
   * Such a sum reads "ei tiedossa", never zero.
   */
  interestKnown: boolean;
}

/**
 * The debts of the household on a day.
 * - A saved loan counts as typed, and a connected card or loan account that owes something counts as the bank tells
 *   it (`creditAccountLoan`).
 * - A saved loan that names such an account (`Loan.accountId`) is that account's debt, and the pair counts once: the
 *   balance is the account's, since the bank knows what is owed today, and the name, kind, rate, plan and last due
 *   date are the saved loan's, so its payment, interest and payoff stay known. The limit is the saved loan's, or the
 *   account's when the loan has none.
 * - The bank's balance is dated on the plan's latest due date on or before the day (`loanLastDueDate`), and on the
 *   loan's own balance date when none has passed: the payments after it fall on the loan's due days, so the payoff
 *   date does not move with the day the debts are read on.
 * - The link holds only for an account that is in `accounts`, is a card or a loan account today (its type can be
 *   changed after the link was made) and has a balance at or below zero. Otherwise both sides count as if no link
 *   was made: a loan account at a plus (the sync stores a bank's plus on a loan account as a minus, so this is a type changed by hand) is no debt, and the typed loan is.
 * - An account balance given before the loan's balance date (`balanceDayOf`) is the older word of the two: the pair
 *   keeps the typed balance and still counts once.
 * - No index in the database holds an account to one loan, so this does not trust it: the first saved loan that names
 *   an account takes it, and a later one counts as typed.
 * - Without a link nothing here knows that a saved loan and a connected account are one debt: both count, and
 *   `maybeTwice` names the pairs that may be.
 * - How much of a debt is the viewer's follows who uses the account behind it. A connected card or loan account has
 *   its own part, and so has a saved loan linked to it: the account's sums are that part already, and the typed
 *   payment, limit and granted sum of a pair are cut to stand beside them (`atPart`). A saved loan with no account
 *   has the part of the account its payments leave (`paidFrom`) and stays whole in this list, where `loans.ts` cuts
 *   every figure of it, so the users' parts add up to the loan on every day. With no payments linked it is whole.
 */
export function householdDebts(accounts: readonly DebtAccount[], inputs: UserInputs, day: IsoDate): HouseholdDebts {
  const typed = loansOf(inputs);
  const holders = new Map<string, Loan>();
  for (const loan of typed) {
    const accountId = loan.accountId ?? null;
    if (accountId !== null && !holders.has(accountId)) holders.set(accountId, loan);
  }
  const linked = new Set<Loan>();
  const connected: Debt[] = [];
  const sources: DebtSource[] = [];
  const parts = new Map<string, Part>();
  for (const account of accounts) {
    // a loan payment account carries the instalments and owes nothing itself
    const told = DEBT_ACCOUNT_TYPES.includes(account.type) && !account.loanPayment ? creditAccountLoan(account, day) : null;
    if (!told) continue;
    const part = belowWhole(account.part) ? account.part : null;
    const holder = holders.get(account.id);
    if (holder && !linked.has(holder) && (account.balanceCents ?? 0) <= 0) {
      linked.add(holder);
      const terms = part ? atPart(holder, part) : holder;
      const pair = { ...terms, limitCents: terms.limitCents ?? told.limitCents };
      const stale = balanceDayOf(account.balanceAt, day) < holder.balanceDate;
      connected.push(stale ? pair : { ...pair, balanceCents: told.balanceCents, balanceDate: loanLastDueDate(holder, day) ?? holder.balanceDate });
      // where the account tells nothing yet the pair counts as typed: whole terms, cut at each figure
      sources.push({ loanId: holder.id, accountId: account.id, linked: true, typed: part ? { ...holder, part } : holder });
      if (part) parts.set(holder.id, part);
    } else if (told.balanceCents > 0) {
      connected.push(told);
      sources.push({ loanId: told.id, accountId: account.id, linked: false, typed: null });
      if (part) parts.set(told.id, part);
    }
  }
  const saved = typed.flatMap((loan): Debt[] => {
    if (linked.has(loan)) return [];
    const part = paidFrom(loan, accounts)?.part;
    if (!belowWhole(part)) return [loan];
    parts.set(loan.id, part);
    return [{ ...loan, part }];
  });
  const loans = [...saved, ...connected];
  const interest = debtInterestNext12Months(loans, day);
  const out = new Set(interest.unknown.filter((u) => !u.counted).map((u) => u.loanId));
  const interestKnown = out.size === 0 || loans.some((loan) => !out.has(loan.id) && loanBalanceOn(loan, day).cents !== 0);
  return { day, saved, connected, sources, loans, parts, total: debtTotalOn(loans, day), interest, interestKnown };
}

/**
 * The part of the debts the accounts' total does not hold, on a day at or before the debts' own: the saved loans
 * with no account behind them, each at its balance on that day. It is what the accounts less the debts take from the
 * accounts' total. `told` says whether an account has a balance in that total on the day. A linked pair is left out
 * where its account tells it, and counts as the saved loan was typed where the account tells nothing yet (a day
 * before the account's first known one): the debt is in every day once.
 */
export const debtOutsideAccountsOn = (debts: HouseholdDebts, day: IsoDate, told: (accountId: string) => boolean = () => true): DebtFigure =>
  debtTotalOn([...debts.saved, ...debts.sources.flatMap((s) => (s.typed !== null && !told(s.accountId) ? [s.typed] : []))], day);

/** Saved loans and the connected accounts that may tell the debt they tell. */
export interface MaybeTwice {
  loans: readonly { id: string; name: string }[];
  /** Every account that stands beside this set of saved loans. */
  accounts: readonly { id: string; name: string }[];
}

/**
 * The saved loans that owe on the day and are linked to no account. A saved loan that owes nothing adds nothing, so it
 * is never named, and a linked one is its account's debt already (`HouseholdDebts.saved` leaves it out).
 */
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
 * The debts that may be in the debt total twice, and so in the accounts less the debts too: the fallback for a saved
 * loan and a connected account that no link ties. Nothing proves that the two are one debt, and both count. A linked
 * pair counts once (`householdDebts`), so neither its loan nor its account is named here. A connected card that owes
 * stands beside every saved card and credit line that owes, whatever their names: a household calls its card what it
 * likes, and some save it as a credit line. A connected loan account that owes stands beside every saved loan that is
 * no card: the bank shows the mortgage as an account, and the household saved it by hand too. Each entry carries the
 * ids of its loans and of its accounts, which is what a page needs to offer the link.
 */
export function maybeTwice(balances: readonly BalanceInput[], debts: HouseholdDebts): MaybeTwice[] {
  const saved = owing(debts);
  const unlinked = new Set(debts.sources.filter((s) => !s.linked).map((s) => s.accountId));
  return pairs(balances, (b) => {
    if (!unlinked.has(b.id)) return [];
    return saved.filter((loan) => (b.type === "credit_card" ? isRevolving(loan.kind) : loan.kind !== "card"));
  });
}

/**
 * The debts that may be in the accounts less the debts twice and are in the debt total once. An account that is no
 * card and no loan account is no debt of `householdDebts`, so its balance below zero is in the accounts' total alone.
 * Beside a saved credit line that owes it may be that credit, drawn on the account: the saved loan then takes off what
 * the account's minus took already. A linked pair is not named: its account is a debt of the list, and its loan is
 * no saved loan beside the accounts.
 */
export function overdraftTwice(balances: readonly BalanceInput[], debts: HouseholdDebts): MaybeTwice[] {
  const lines = owing(debts).filter((loan) => loan.kind === "credit_line");
  const counted = new Set(debts.sources.map((s) => s.accountId));
  return pairs(balances, (b) => (!counted.has(b.id) && (b.balanceCents ?? 0) < 0 ? lines : []));
}

/** The loans the rows show and nobody saved (`loanProposals`): how many, and their payments a month in all. */
export interface UnsavedLoans {
  count: number;
  paymentCents: number;
}

/**
 * The debts the total cannot hold: a lender paid every month whose loan was not saved has no balance, so the total
 * leaves it out and says so beside it. Null when every loan the rows show is saved or marked "Ei laina".
 */
export function unsavedLoans(proposals: readonly Pick<LoanProposal, "paymentCents">[]): UnsavedLoans | null {
  if (!proposals.length) return null;
  return { count: proposals.length, paymentCents: proposals.reduce((sum, p) => sum + p.paymentCents, 0) };
}

