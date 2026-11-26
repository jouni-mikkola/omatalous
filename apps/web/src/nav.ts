import { t } from "./text.ts";

export interface NavEntry {
  /** The page id in the address (`#/<id>`). */
  id: string;
  /** A getter on the built-in entries: the text is read when it is drawn, in the language the member has by then. */
  readonly label: string;
  /** What the phone's tab bar writes where the full label does not fit; the link keeps the full label as its name. */
  readonly short?: string;
}

/**
 * The pages of the header, in the order the household reads them: Yhteenveto, Tapahtumat, Laskut, Varat ja velat, Raportit.
 * Every entry is a tab. What an add-on module adds is a tab after them. Asetukset is not one of them.
 */
export const NAV: readonly NavEntry[] = [
  { id: "overview", get label() { return t("nav.overview"); } },
  { id: "transactions", get label() { return t("nav.transactions"); } },
  { id: "bills", get label() { return t("nav.bills"); } },
  { id: "balances", get label() { return t("nav.balances"); }, get short() { return t("nav.balances_short"); } },
  { id: "reports", get label() { return t("nav.reports"); } },
];

/** The Raportit entry of NAV: the pages of the reports keep its tab current. */
export const REPORTS_ID = "reports";

/**
 * Whether the open page shows figures that Oma and Koko talous change: the pages of the header. Tarkistettavat,
 * Asetukset and the page of an add-on module do not read the scope, so the switch is not offered there.
 */
export const readsScope = (page: string): boolean => NAV.some((e) => e.id === page);

/**
 * Whether the page's cards are named, so its name needs no visible title above them: the pages of the header and
 * Tarkistettavat. The shell still gives them the name as a heading that only a screen reader meets, and draws a visible
 * title for Asetukset and the page of an add-on module, whose content has no heading that names the page.
 */
export const namesItself = (page: string): boolean => readsScope(page) || page === REVIEW.id;

/**
 * Tarkistettavat is a link at the right of the header, with the count of open items when there are any: the one place
 * that asks what the app cannot settle itself, not a page about money.
 */
export const REVIEW: NavEntry = { id: "review", get label() { return t("nav.review"); } };

/** Asetukset is in the user menu: a page every member has, but not a question about money. */
export const SETTINGS: NavEntry = { id: "settings", get label() { return t("nav.settings"); } };
