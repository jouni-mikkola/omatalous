/**
 * Tarkistettavat's questions about the member's own loans and cards, from the view the queue read once (`OwnView`):
 * - `loan_terms`, a saved loan that still owes and whose plan lacks one fact (core `loanTermsMissing`, from `planOf`): the
 *   loan's form answers it (PUT /api/loans/:id) and the item goes when the plan resolves;
 * - `loan_terms` for a connected card that owes while its rate is unknown: the bank tells the balance and nothing of
 *   its terms. The form of a new loan linked to the card answers it, or the form of the linked loan that saved no rate
 *   (`missing` is the rate). A card the rows show paid in full each month costs no interest (`debtsOf`), and a saved
 *   rate of 0 is a rate, so neither is asked;
 * - `loan_drift`, a payment of a saved loan's series that the loan's plan did not expect (core `loanDrift`): the loan's
 *   form opens with the payment the bank took, and the item goes when the loan is saved after that row or a later payment
 *   fits. A loan has one question at a time, its terms before its drift.
 * What a linked loan owes is what its account says, as the debt pages count it (`householdDebts`). "Älä muistuta tästä
 * enää" is the mark `dismissed` on `subject`, and it holds for every fact but the rate and the payment, which keep
 * asking (`loanTermsDismissible`). A debt stakes no money of the queue's order, so `cents` is 0 as the home loan
 * question's is.
 */
import { balanceDayOf, debtsOf, isRevolving, type Loan, loanDrift, loansOf, loanTermsDismissed, loanTermsDismissible, loanTermsMissing, type LoanTermsMissing, loanTermsSubject } from "@banking/core";
import { todayIn } from "../platform/config.ts";
import type { Services } from "./context.ts";
import type { OwnView } from "./review-own.ts";

export interface LoanTermsItem {
  kind: "loan_terms";
  id: string;
  cents: number;
  /** The saved loan asked about, null for a connected card that has none. */
  loanId: string | null;
  /** The connected card whose terms are asked for, null for a saved loan. A card with a saved loan names both. */
  accountId: string | null;
  name: string;
  /** What the debt owes, and the day that balance is of. */
  owedCents: number;
  balanceDate: string;
  missing: LoanTermsMissing;
  subject: string;
  /** The queue's own fields of every item: a debt has no rows. */
  rows?: { id: string; date: string; cents: number; name: string; text: string }[];
  rowCount?: number;
}

/** A payment of a saved loan that its plan did not expect: what the bank took, what the plan said, and what the form is filled with. */
export interface LoanDriftItem {
  kind: "loan_drift";
  id: string;
  cents: number;
  loanId: string;
  name: string;
  /** The day of the payment and what the bank took of it, whole. */
  date: string;
  paidCents: number;
  /** What the loan's plan expected on the nearest due date. */
  expectedCents: number;
  /** The payment to fill in the loan's form, and for a loan on a reference rate the day to fill in as its review day. */
  newPaymentCents: number;
  reviewDate: string | null;
  /** The payment's row, shown as the bank charged it. */
  rows?: { id: string; date: string; cents: number; name: string; text: string }[];
  rowCount?: number;
}

/** The member's own saved loans of the view: a loan another member typed in, paid from a shared account, is not asked of the viewer. */
const ownLoans = ({ inputs }: OwnView): Loan[] => (inputs.loans ?? []).filter((loan) => loan.typedBy === undefined);

/**
 * Only the member's own loans and accounts are read: an account another member shared is left out of the debts before
 * they are worked out, so another member's loan or card is never asked.
 */
export const loanTermsItems = async (_s: Services, _userId: string, view: OwnView): Promise<LoanTermsItem[]> => {
  const { ctx, balances, inputs } = view;
  const saved = ownLoans(view);
  const own = balances.filter((b) => b.ownerName === null);
  const debts = debtsOf(ctx, own, { ...inputs, loans: saved });
  const items = saved.flatMap((loan): LoanTermsItem[] => {
    // a loan linked to its account owes what the account says, unless the typed balance is the newer word of the two
    const at = debts.sources.findIndex((src) => src.linked && src.loanId === loan.id);
    const account = at < 0 ? undefined : own.find((b) => b.id === debts.sources[at]!.accountId);
    const told = account !== undefined && balanceDayOf(account.balanceAt, debts.day) >= loan.balanceDate;
    const owedCents = told ? debts.connected[at]!.balanceCents : loan.balanceCents;
    const balanceDate = told ? balanceDayOf(account.balanceAt, debts.day) : loan.balanceDate;
    const missing = loanTermsMissing({ ...loan, balanceCents: owedCents });
    if (missing === null || (loanTermsDismissible(missing) && loanTermsDismissed(inputs.marks, loan.id))) return [];
    return [{ kind: "loan_terms", id: `loan_terms:${loan.id}`, cents: 0, loanId: loan.id, accountId: null, name: loan.name, owedCents, balanceDate, missing, subject: loanTermsSubject(loan.id) }];
  });
  // a card with no saved loan paid in full is told as interest 0 (`settledCardLoan`): the debts without the saved loans show which linked card is too
  let bare: ReturnType<typeof debtsOf> | undefined;
  const paidInFull = (accountId: string): boolean => {
    bare ??= debtsOf(ctx, own, { ...inputs, loans: [] });
    const at = bare.sources.findIndex((src) => src.accountId === accountId);
    return at >= 0 && bare.connected[at]!.rateBp === 0;
  };
  const cards = debts.sources.flatMap((src, at): LoanTermsItem[] => {
    const debt = debts.connected[at]!;
    const account = own.find((b) => b.id === src.accountId);
    // a card owing nothing has no rate to ask, a linked pair included; a credit line drawn on another kind of account is no card. A card's rate keeps asking: no mark sets it aside.
    if (!account || account.type !== "credit_card" || !isRevolving(debt.kind) || debt.balanceCents <= 0 || debt.rateBp !== null || (src.linked && paidInFull(account.id))) return [];
    const loan = src.linked ? saved.find((l) => l.id === src.loanId) : undefined;
    // a typed balance newer than the account's is the newer word of the two, as for a saved loan
    const accountDay = balanceDayOf(account.balanceAt, debts.day);
    const balanceDate = loan !== undefined && accountDay < loan.balanceDate ? loan.balanceDate : accountDay;
    return [{ kind: "loan_terms", id: `loan_terms:${debt.id}`, cents: 0, loanId: loan?.id ?? null, accountId: account.id, name: account.name, owedCents: debt.balanceCents, balanceDate, missing: "rate", subject: loanTermsSubject(debt.id) }];
  });
  return [...items, ...cards];
};

/**
 * The payments of the member's own saved loans that their plans did not expect, one item per loan and none for a loan
 * in `asked`, which has its terms asked first. The loan's own rows of its series are read from the view's context; the
 * day the loan was last saved is the one read of the database, made only when a loan with a series could be asked.
 */
export const loanDriftItems = async (s: Services, userId: string, view: OwnView, asked: ReadonlySet<string>): Promise<(LoanDriftItem & { rowIds: string[]; whole: true })[]> => {
  const { ctx, inputs } = view;
  const loans = loansOf({ ...inputs, loans: ownLoans(view) }).filter((loan) => loan.seriesKey !== null && !asked.has(loan.id));
  if (!loans.length || !ctx.txs.length) return [];
  const savedAt = await s.finance(userId).loansSavedAt();
  const others = (inputs.loans ?? []).flatMap((loan) => loan.seriesKey ?? []);
  return loans.flatMap((loan) => {
    const at = savedAt.get(loan.id);
    const saved = at === undefined || Number.isNaN(new Date(at).getTime()) ? "" : todayIn(s.instance.current.timezone, new Date(at));
    const drift = loanDrift(loan, ctx.txs, others, saved);
    if (drift === null) return [];
    const { rowId, ...answer } = drift;
    return [{ kind: "loan_drift", id: `loan_drift:${loan.id}`, cents: 0, loanId: loan.id, name: loan.name, ...answer, rowIds: [rowId], whole: true }];
  });
};
