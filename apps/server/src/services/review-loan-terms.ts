/**
 * Tarkistettavat's question of a debt whose payments cannot be placed, in two cases:
 * - a saved loan of the member's own that still owes and whose plan lacks one fact (core `loanTermsMissing`, from
 *   `planOf`): the loan's form answers it (PUT /api/loans/:id) and the item goes when the plan resolves;
 * - a connected card of the member's own that owes while its rate is unknown: the bank tells the balance and nothing of
 *   its terms. The form of a new loan linked to the card answers it, or the form of the linked loan that saved no rate
 *   (`missing` is the rate). A card the rows show paid in full each month costs no interest (`debtsOf`), and a saved
 *   rate of 0 is a rate, so neither is asked.
 * What a linked loan owes is what its account says, as the debt pages count it (`householdDebts`). "Älä muistuta tästä
 * enää" is the mark `dismissed` on `subject`. The debt stakes no money of the queue's order, so `cents` is 0 as the home
 * loan question's is.
 */
import { balanceDayOf, debtsOf, isRevolving, loanTermsDismissed, loanTermsMissing, type LoanTermsMissing, loanTermsSubject } from "@banking/core";
import type { Services } from "./context.ts";
import { requestInputs } from "./analysis.ts";

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

/**
 * Only the member's own loans and accounts are read: `listLoans` is the member's own rows, and an account another member
 * shared is left out of the debts before they are worked out, so another member's loan or card is never asked.
 */
export const loanTermsItems = async (s: Services, userId: string): Promise<LoanTermsItem[]> => {
  const repo = s.finance(userId);
  const [saved, marks, { ctx, accounts }] = await Promise.all([repo.listLoans(), repo.listMarks(), s.analysis.get(s, userId, "own")]);
  const { balances, inputs } = await requestInputs(s, userId, accounts);
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
    if (missing === null || loanTermsDismissed(marks, loan.id)) return [];
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
    // a card owing nothing has no rate to ask, a linked pair included; a credit line drawn on another kind of account is no card
    if (!account || account.type !== "credit_card" || !isRevolving(debt.kind) || debt.balanceCents <= 0 || debt.rateBp !== null || loanTermsDismissed(marks, debt.id) || (src.linked && paidInFull(account.id))) return [];
    const loan = src.linked ? saved.find((l) => l.id === src.loanId) : undefined;
    // a typed balance newer than the account's is the newer word of the two, as for a saved loan
    const accountDay = balanceDayOf(account.balanceAt, debts.day);
    const balanceDate = loan !== undefined && accountDay < loan.balanceDate ? loan.balanceDate : accountDay;
    return [{ kind: "loan_terms", id: `loan_terms:${debt.id}`, cents: 0, loanId: loan?.id ?? null, accountId: account.id, name: account.name, owedCents: debt.balanceCents, balanceDate, missing: "rate", subject: loanTermsSubject(debt.id) }];
  });
  return [...items, ...cards];
};
