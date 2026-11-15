/**
 * The name of the accounts less the debts, shared by Yhteenveto's tile and the holdings block of Raportit, so the two
 * name one figure in one way.
 */
import { figureName, t, tn } from "../text.ts";
import type { DashboardData } from "../types.ts";

type Answer = DashboardData["holdings"];

/**
 * The name of `netCents`, which says what it lacks: a loan with no balance (saved with none, or never saved) is a debt
 * the figure cannot hold. Null when there is no debt at all, as the figure is then the accounts' total and needs no name.
 */
export function netLabelOf(holdings: Pick<Answer, "loans" | "debtCents" | "unsavedLoans">): { label: string | null; lacking: number } {
  const noBalance = holdings.loans.filter((l) => l.leftCents === null).length;
  const lacking = noBalance + (holdings.unsavedLoans?.count ?? 0);
  const known = holdings.loans.length - noBalance;
  if (lacking === 0) return { label: holdings.debtCents > 0 ? figureName("netWorth") : null, lacking };
  return { label: known === 0 ? t("holdings.net_without_loans") : tn(lacking, "holdings.net_without_one", "holdings.net_without_many", { net: figureName("netWorth") }), lacking };
}
