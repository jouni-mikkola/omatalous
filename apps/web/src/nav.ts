import type { FeatureId, FeatureState } from "@banking/core";

export interface NavEntry {
  /** The page id in the address (`#/<id>`). */
  id: string;
  label: string;
  /** The module's feature flag: the entry is hidden, and its page unreachable, while the flag is off. */
  feature?: FeatureId;
}

export const NAV: readonly NavEntry[] = [
  { id: "overview", label: "Yleiskatsaus" },
  { id: "reports", label: "Raportit" },
  { id: "transactions", label: "Tapahtumat" },
  { id: "recurring", label: "Toistuvat" },
  { id: "categories", label: "Kategoriat" },
  { id: "settings", label: "Asetukset" },
];

/** The entries to show. Those of a module that is off are left out, and so are they until the flags have loaded. */
export function visibleNav(features: FeatureState | undefined, entries: readonly NavEntry[] = NAV): NavEntry[] {
  return entries.filter((e) => !e.feature || features?.[e.feature] === true);
}
