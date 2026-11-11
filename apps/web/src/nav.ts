import { t } from "./text.ts";

export interface NavEntry {
  /** The page id in the address (`#/<id>`). */
  id: string;
  /** A getter on the built-in entries: the text is read when it is drawn, in the language the member has by then. */
  readonly label: string;
}

/**
 * Tarkistettavat, the fourth tab: is anything wrong? Its link carries the count of open items when there are any, the
 * one place that asks what the app cannot settle itself.
 */
export const REVIEW: NavEntry = { id: "review", get label() { return t("nav.review"); } };

/**
 * The four tabs, one for each question the household asks of its money, in the order they are asked
 * (docs/design/README.md section 1): Nyt, Kuukausi, Tulossa, Tarkistettavat. Every entry is a tab, at every width.
 * Asetukset is not one of them.
 */
export const NAV: readonly NavEntry[] = [
  { id: "overview", get label() { return t("nav.now"); } },
  // Kuukausi: the month against its usual is what the tab opens; the question pages of the reports stay behind their addresses
  { id: "reports", get label() { return t("rpt.page_thismonth"); } },
  { id: "bills", get label() { return t("nav.coming"); } },
  REVIEW,
];

/** The rows list keeps its address and has no tab: a figure opens it with its filter in the address. */
export const ROWS: NavEntry = { id: "transactions", get label() { return t("nav.transactions"); } };

/**
 * Lisää is in the user menu, not a tab: the reports that earn a place (Vuosi, Tilit ja saldot, Lainat, Verovuosi and, with
 * a shared account, Yhteiset). It opens on Tilit ja saldot; the list of the others is on the page.
 */
export const MORE = { hash: "#/reports?q=saldot", get label() { return t("rpt.more"); } };

/** Asetukset is in the user menu: a page every member has, but not a question about money. */
export const SETTINGS: NavEntry = { id: "settings", get label() { return t("nav.settings"); } };
