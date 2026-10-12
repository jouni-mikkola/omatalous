import type { FeatureId, FeatureState } from "@banking/core";

export interface NavEntry {
  /** The page id in the address (`#/<id>`). */
  id: string;
  label: string;
  /** The module's feature flag: the entry is hidden, and its page unreachable, while the flag is off. */
  feature?: FeatureId;
}

/** The five questions the household asks of its money, in the order they are asked. Asetukset is not one of them. */
export const NAV: readonly NavEntry[] = [
  { id: "overview", label: "Yhteenveto" },
  { id: "bills", label: "Laskut" },
  { id: "transactions", label: "Tapahtumat" },
  { id: "reports", label: "Raportit" },
  { id: "optimise", label: "Säästövinkit", feature: "optimise" },
];

/** Asetukset is a link in the header, beside the user menu: a page every member has, but not a question about money. */
export const SETTINGS: NavEntry = { id: "settings", label: "Asetukset" };

/** The entries to show. Those of a module that is off are left out, and so are they until the flags have loaded. */
export function visibleNav(features: FeatureState | undefined, entries: readonly NavEntry[] = NAV): NavEntry[] {
  return entries.filter((e) => !e.feature || features?.[e.feature] === true);
}
