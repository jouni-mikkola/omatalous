import type { FeatureState } from "@banking/core";
import { t } from "./text.ts";
import { WEB_EXTENSIONS, type WebExtension } from "./extensions.ts";

export interface NavEntry {
  /** The page id in the address (`#/<id>`). */
  id: string;
  /** A getter on the built-in entries: the text is read when it is drawn, in the language the member has by then. */
  readonly label: string;
  /** The entry has a tab of its own on a phone. Without it the entry is in the user menu: what a module adds never takes a tab. */
  tab?: true;
}

/** The questions the household asks of its money, in the order they are asked. Asetukset is not one of them. */
export const NAV: readonly NavEntry[] = [
  { id: "overview", get label() { return t("nav.overview"); }, tab: true },
  { id: "bills", get label() { return t("nav.bills"); }, tab: true },
  { id: "transactions", get label() { return t("nav.transactions"); }, tab: true },
  { id: "reports", get label() { return t("nav.reports"); }, tab: true },
  { id: "optimise", get label() { return t("nav.optimise"); }, tab: true },
];

/**
 * Tarkistettavat is a link in the header, with the count of open questions when there are any: the one place that
 * asks what the app cannot settle itself, not a question of its own about money.
 */
export const REVIEW: NavEntry = { id: "review", get label() { return t("nav.review"); } };

/** Asetukset is in the user menu: a page every member has, but not a question about money. */
export const SETTINGS: NavEntry = { id: "settings", get label() { return t("nav.settings"); } };

/** The extensions with a page whose flag is on, in the order they were added; none until the flags have loaded. */
export function extensionPages(features: FeatureState | undefined, extensions: readonly WebExtension[] = WEB_EXTENSIONS): WebExtension[] {
  return extensions.filter((e) => e.page && (features as Record<string, boolean> | undefined)?.[e.id] === true);
}
