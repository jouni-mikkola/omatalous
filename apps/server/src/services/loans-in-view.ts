/**
 * The typed loans of a view. A loan is its typist's: the list of loans and every write read the typist's own rows. A
 * view holds the viewer's own loans and, of the loans the other members typed in, the ones paid from its accounts:
 * the account the payments leave has a copy among the view's accounts.
 * - A member's own view holds such a loan when that account is a joint one the viewer and the typist both use. Core
 *   cuts the loan by the viewer's part of the account (`householdDebts`), so the users' parts add up to the loan.
 * - A view that counts its accounts whole (the household's, and the one Säästövinkit reads) holds it whole, when the
 *   typist linked a copy of the account or is named as a user of it. So where the members see the same accounts,
 *   their own views add up to the household's, whoever typed the loan in.
 * - A loan two members typed in, each from their own papers, is one debt: of two loans paid by one series of payments
 *   a view holds the viewer's own, or else the first typist's.
 * Another member's loan carries the typist's display name (`Loan.typedBy`), so a page can say whose it is.
 *
 * Which account pays a typed loan is told by its series key alone (`Loan.seriesKey`, read by core's `paidFrom`). A
 * loan with no payments linked is its typist's alone in every view, and in the own views so is one paid from an
 * account one person uses.
 */
import { type AccountUse, belowWhole, type Loan, type Part, paidFrom, parseSeriesId, seriesId } from "@banking/core";
import { accountKey } from "../db/household-repo.ts";
import type { StoredAccount } from "../db/rows.ts";
import type { Services } from "./context.ts";

/** An account of a view as the loans read it. A member's own view tells the viewer's `part` of each account, a view that counts its accounts whole tells none. */
type AccountInView = Pick<StoredAccount, "id" | "identity"> & { use?: AccountUse; part?: Part };

/**
 * The loans a request counts for `accounts`, the accounts of its view: the viewer's own in the order they were saved,
 * then the other members' loans paid from an account of the view, typist by typist. In an own view the typist is a
 * user of the account too, so the loan is cut in their view as it is here.
 *
 * Such a loan names the viewer's accounts where the typist's names theirs: its series key holds the view's copy of
 * the account the payments leave, and its linked account (`Loan.accountId`) is the view's copy of that one, or none
 * when the view has no copy. So core finds both in the view, and a response names no account the viewer cannot see.
 */
export async function loansInView(s: Services, userId: string, accounts: readonly AccountInView[]): Promise<Loan[]> {
  const own = await s.finance(userId).listLoans();
  /** The other members the use of an account names, with a weight of at least `least`. */
  const usersOf = (a: AccountInView, least: 0 | 1) => (a.use?.users ?? []).flatMap((u) => (u.userId !== null && u.userId !== userId && u.weight >= least ? [u.userId] : []));
  // a joint account the viewer uses: their part of it is more than nothing and less than the whole
  const usedWith = (a: AccountInView) => (belowWhole(a.part) && a.part.to > a.part.from ? usersOf(a, 1) : []);
  if (accounts.every((a) => a.part !== undefined && !usedWith(a).length)) return own;

  const [held, users] = await Promise.all([s.household.heldAccounts(), s.users.list()]);
  /**
   * The members whose loans paid from an account the view holds. At a part: the other users of the account. Whole:
   * whoever linked a copy of the real account or is named in its use, at any weight. A member with neither tie cannot
   * put a loan into the figures of the people who see the account by naming it in a key.
   */
  const typistsOf = (a: AccountInView) =>
    a.part !== undefined ? usedWith(a) : [...held.flatMap((h) => (h.key === accountKey(a) && h.userId !== userId ? [h.userId] : [])), ...usersOf(a, 0)];
  const named = new Set(accounts.flatMap(typistsOf));
  const typists = users.filter((u) => named.has(u.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!typists.length) return own;

  const typed = await Promise.all(typists.map((u) => s.finance(u.id).listLoans()));
  /** The account of the view that is the same real account as the one with this id, whoever linked that one. */
  const copyOf = (accountId: string) => {
    const key = held.find((a) => a.id === accountId)?.key;
    return key === undefined ? undefined : accounts.find((a) => accountKey(a) === key);
  };
  /** The view's copy of the account a loan's payments leave, and the loan's series key with that copy in it. Undefined when no payments leave an account of the view. */
  const paidInView = (loan: Loan) => {
    const from = paidFrom(loan, held);
    const series = from && parseSeriesId(loan.seriesKey ?? "");
    const account = series && copyOf(from.id);
    return account ? { account, seriesKey: seriesId({ ...series, accountId: account.id }) } : undefined;
  };
  // the series whose loan the view holds already: two loans of the viewer's own both stay, another member's second one does not
  const counted = new Set(own.flatMap((loan) => paidInView(loan)?.seriesKey ?? []));
  const theirs = typists.flatMap((typist, i) => {
    const brought = typed[i]!.flatMap((loan): Loan[] => {
      const paid = paidInView(loan);
      if (!paid || !typistsOf(paid.account).includes(typist.id) || counted.has(paid.seriesKey)) return [];
      const { accountId, ...terms } = loan;
      const linked = accountId == null ? undefined : copyOf(accountId);
      return [{ ...terms, typedBy: typist.displayName, seriesKey: paid.seriesKey, ...(linked ? { accountId: linked.id } : {}) }];
    });
    for (const loan of brought) counted.add(loan.seriesKey!);
    return brought;
  });
  return [...own, ...theirs];
}
