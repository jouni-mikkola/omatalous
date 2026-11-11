import { t } from "./text.ts";

export interface NavEntry {
  /** The page id in the address (`#/<id>`). */
  id: string;
  /** A getter on the built-in entries: the text is read when it is drawn, in the language the member has by then. */
  readonly label: string;
  /** The entry has a tab of its own on a phone. */
  tab?: true;
}

/**
 * Tarkistettavat, the fourth tab: is anything wrong? Its link carries the count of open items when there are any, the
 * one place that asks what the app cannot settle itself.
 */
export const REVIEW: NavEntry = { id: "review", get label() { return t("nav.review"); }, tab: true };

/** The questions the household asks of its money, in the order they are asked. Asetukset is not one of them. */
export const NAV: readonly NavEntry[] = [
  { id: "overview", get label() { return t("nav.overview"); }, tab: true },
  // Kuukausi: the month against its usual is what the tab opens; the question pages of the reports stay behind their addresses
  { id: "reports", get label() { return t("rpt.page_thismonth"); }, tab: true },
  { id: "bills", get label() { return t("nav.bills"); }, tab: true },
  REVIEW,
  { id: "transactions", get label() { return t("nav.transactions"); }, tab: true },
  // five tabs are what a phone's bar holds: Säästövinkit is a link in the header on a wide screen and in the user menu on a phone
  { id: "optimise", get label() { return t("nav.optimise"); } },
];

/**
 * Lisää is in the user menu, not a tab: the reports that earn a place (Vuosi, Tilit ja saldot, Lainat, Verovuosi and, with
 * a shared account, Yhteiset). It opens on Tilit ja saldot; the list of the others is on the page.
 */
export const MORE = { hash: "#/reports?q=saldot", get label() { return t("rpt.more"); } };

/** Asetukset is in the user menu: a page every member has, but not a question about money. */
export const SETTINGS: NavEntry = { id: "settings", get label() { return t("nav.settings"); } };
