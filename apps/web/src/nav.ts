import type { FeatureId, FeatureState } from "@banking/core";
import { WEB_EXTENSIONS, type WebExtension } from "./extensions.ts";

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

/**
 * Tarkistettavat is a link in the header beside Asetukset, with the count of open questions when there are any: the one
 * place that asks what the app cannot settle itself, not a question of its own about money.
 */
export const REVIEW: NavEntry = { id: "review", label: "Tarkistettavat" };

/** Asetukset is a link in the header, beside the user menu: a page every member has, but not a question about money. */
export const SETTINGS: NavEntry = { id: "settings", label: "Asetukset" };

/** The entries to show. Those of a module that is off are left out, and so are they until the flags have loaded. */
export function visibleNav(features: FeatureState | undefined, entries: readonly NavEntry[] = NAV): NavEntry[] {
  return entries.filter((e) => !e.feature || features?.[e.feature] === true);
}

/** The extensions with a page whose flag is on, in the order they were added; none until the flags have loaded. */
export function extensionPages(features: FeatureState | undefined, extensions: readonly WebExtension[] = WEB_EXTENSIONS): WebExtension[] {
  return extensions.filter((e) => e.page && (features as Record<string, boolean> | undefined)?.[e.id] === true);
}
