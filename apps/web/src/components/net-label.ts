/**
 * The name of the accounts less the debts, as the holdings block of Raportit shows it.
 */
import { figureName, t, tn } from "../text.ts";
import type { DashboardData } from "../types.ts";

type Answer = DashboardData["holdings"];

/**
 * The name of `netCents`, which says what it lacks: a loan nobody saved is a debt the figure cannot hold, also a
 * lender's few payments with no monthly figure (`unsavedFewPayments`), which are counted here and in no sum. Null when
 * there is no debt at all, as the figure is then the accounts' total and needs no name. The figure is a dash while the
 * debt total is unknown (`debtCents` null), and then it has the plain name.
 */
export function netLabelOf(holdings: Pick<Answer, "loans" | "debtCents" | "unsavedLoans" | "unsavedFewPayments">): string | null {
  if (holdings.debtCents === null) return figureName("netWorth");
  const lacking = (holdings.unsavedLoans?.count ?? 0) + (holdings.unsavedFewPayments ?? 0);
  if (lacking === 0) return holdings.debtCents > 0 ? figureName("netWorth") : null;
  return holdings.loans.length === 0 ? t("holdings.net_without_loans") : tn(lacking, "holdings.net_without_one", "holdings.net_without_many", { net: figureName("netWorth") });
}
