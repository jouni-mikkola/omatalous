import { getCategory } from "./categories.ts";

/**
 * What a bill is for, in four kinds that every bill and loan payment falls in exactly one of (ADR 0004: one definition,
 * written in docs/MONEY_FLOWS.md as well). Laskut adds a month's bills up by kind, and the four sums are the month's
 * `billsCents` to the cent.
 *
 *  - essential ("Asuminen ja välttämättömät"): housing, utilities, insurance, telecom, taxes and fees, and day care
 *    (a recurring bill of the category Lapset)
 *  - debt ("Velanhoito"): loan payments and every category of debt service, a card's bill included; never optional
 *  - contract ("Sopimukset"): leasing and the other fixed contracts, memberships
 *  - optional ("Valinnaiset"): everything else, a subscription among it, and a bill with no category
 */
export type CostKind = "essential" | "debt" | "contract" | "optional";

export const COST_KINDS: readonly CostKind[] = ["essential", "debt", "contract", "optional"];

const ESSENTIAL: ReadonlySet<string> = new Set(["housing", "utilities", "insurance", "telecom", "taxes", "fees", "kids"]);
const CONTRACT: ReadonlySet<string> = new Set(["leasing", "memberships"]);
/** The kind of a bill: a loan payment is debt whatever its category, any other row by its category; none is the rest. */
export function costKindOf(category: string | null, loanPayment = false): CostKind {
  // the categories of debt service (kind "debt" in categories.ts): the card bill, the loans, interest and collection
  if (loanPayment || (category !== null && getCategory(category).kind === "debt")) return "debt";
  if (category !== null && ESSENTIAL.has(category)) return "essential";
  if (category !== null && CONTRACT.has(category)) return "contract";
  return "optional";
}
