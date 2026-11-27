/**
 * The name of the net figure at the head of the holdings block of Raportit, and the count of debts that keep it from showing.
 */
import { figureName } from "../text.ts";
import type { DashboardData } from "../types.ts";

type Answer = DashboardData["holdings"];

/** How many debts the debt total cannot hold: loans and cards nobody saved or connected, and a lender's few payments. */
export const lackingDebts = (holdings: Pick<Answer, "unsavedLoans" | "unsavedFewPayments">): number => (holdings.unsavedLoans?.count ?? 0) + (holdings.unsavedFewPayments ?? 0);

type Balances = { accounts: readonly unknown[]; holdings: Pick<Answer, "accountsCents" | "unsavedLoans" | "unsavedFewPayments"> };

/** The row of figures at the head of Varat ja velat is shown: the viewer has an account and the accounts have a total. */
export const showsHead = (balances: Balances): boolean => balances.accounts.length > 0 && balances.holdings.accountsCents !== null;

/**
 * The line under that row links to Tarkistettavat: a debt lacks its balance and is still asked there (one answered
 * "En tiedä" is not). Lainat then leaves its own link to the same list out, so the page has one.
 */
export const headAsks = (balances: Balances): boolean =>
  showsHead(balances) && lackingDebts(balances.holdings) > 0 && (balances.holdings.unsavedLoans?.rows.some((u) => !u.asked) ?? false);

/**
 * The name of `netCents`. Null when there is no debt at all, as the figure is then the accounts' total and needs no name.
 * The figure is a dash while the debt total is unknown (`debtCents` null), and then it has the plain name. The block
 * shows no net figure while a debt lacks its balance (`lackingDebts`), so the name never has to say what it lacks.
 */
export function netLabelOf(holdings: Pick<Answer, "debtCents">): string | null {
  return holdings.debtCents === null || holdings.debtCents > 0 ? figureName("netWorth") : null;
}
