/**
 * The name of the net figure at the head of the holdings block of Raportit, and the count of debts that keep it from showing.
 */
import { figureName } from "../text.ts";
import type { DashboardData } from "../types.ts";

type Answer = DashboardData["holdings"];

/** How many debts the debt total cannot hold: loans and cards nobody saved or connected, and a lender's few payments. */
export const lackingDebts = (holdings: Pick<Answer, "unsavedLoans" | "unsavedFewPayments">): number => (holdings.unsavedLoans?.count ?? 0) + (holdings.unsavedFewPayments ?? 0);

/**
 * The name of `netCents`. Null when there is no debt at all, as the figure is then the accounts' total and needs no name.
 * The figure is a dash while the debt total is unknown (`debtCents` null), and then it has the plain name. The block
 * shows no net figure while a debt lacks its balance (`lackingDebts`), so the name never has to say what it lacks.
 */
export function netLabelOf(holdings: Pick<Answer, "debtCents">): string | null {
  return holdings.debtCents === null || holdings.debtCents > 0 ? figureName("netWorth") : null;
}
