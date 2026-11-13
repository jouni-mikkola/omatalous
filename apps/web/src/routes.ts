import { WEB_EXTENSIONS } from "./extensions.ts";
import { pageOfPeriod } from "./period.ts";
import { t } from "./text.ts";

export interface Route {
  /** The page id in the address (`#/<id>`). */
  page: string;
  params: URLSearchParams;
  /** The part after a second `#` (`#/transactions?view=merchants#saannot`): a spot on the page to scroll to. */
  anchor?: string;
}

/** The Säännöt card under the merchant table (Tapahtumat > Kauppiaat). */
export const RULES_ANCHOR = "saannot";

/** The cards of Asetukset that an address can name, as anchors on the page. */
export const SETTINGS_ANCHOR = {
  login: "kirjautuminen",
  password: "salasana",
  securityLog: "turvallisuusloki",
  quality: "laatu",
  accounts: "tilit",
  exampleData: "esimerkkitiedot",
  loans: "lainat",
  goal: "menotavoite",
  bankApp: "pankkisovellus",
  statement: "tiliote",
  server: "palvelin",
  maintenance: "yllapito",
  addOn: "lisaosa",
} as const;

/**
 * The six targets of Asetukset, in the order the reader sees them. Each is a route of its own (`#/settings/<id>`); an
 * `admin` target is not offered to a member and its address opens the first target instead.
 */
export const SETTINGS_TARGETS = [
  { id: "banks", get label() { return t("set.tab.banks"); } },
  { id: "household", get label() { return t("set.tab.household"); } },
  { id: "members", get label() { return t("set.tab.members"); }, admin: true },
  { id: "security", get label() { return t("set.tab.security"); } },
  { id: "data", get label() { return t("set.tab.data"); } },
  { id: "server", get label() { return t("set.tab.server"); }, admin: true },
] as const satisfies readonly { id: string; label: string; admin?: true }[];

/**
 * The target of an add-on module (docs/MODULES.md), after the six: the module's own cards (extensions.ts `settingsCard`)
 * and, for an admin, the card of the add-on's code, version and state. It is offered only while a module is loaded in
 * the page (`addOnTargetOffered`); without one the code card is on Palvelin ja ylläpito.
 */
export const ADD_ON_TARGET = { id: "addon", get label() { return t("set.tab.addon"); } } as const;

export type SettingsTarget = (typeof SETTINGS_TARGETS)[number]["id"] | typeof ADD_ON_TARGET.id;

/** The target a member lands on, and an address of Asetukset with nothing to say where. */
const FIRST_TARGET: SettingsTarget = "banks";

const ADD_ON_PAGE = `settings/${ADD_ON_TARGET.id}`;

/** Whether a user of this role is offered the add-on target: a module is loaded, and it has a card there for them (an admin always has the code card). */
export function addOnTargetOffered(role: "admin" | "member"): boolean {
  return WEB_EXTENSIONS.length > 0 && (role === "admin" || WEB_EXTENSIONS.some((e) => e.settingsCard));
}

/** The targets a user of this role is offered. */
export function settingsTargets(role: "admin" | "member"): readonly { readonly id: SettingsTarget; readonly label: string }[] {
  const shared = SETTINGS_TARGETS.filter((t) => role === "admin" || !("admin" in t));
  return addOnTargetOffered(role) ? [...shared, ADD_ON_TARGET] : shared;
}

/** The target a card is on, by its anchor. A loaded add-on module's cards and the add-on's own card are on its target (`targetOfCard`). */
const CARD_TARGET: Record<string, SettingsTarget> = {
  pankkiyhteydet: "banks",
  [SETTINGS_ANCHOR.bankApp]: "banks",
  [SETTINGS_ANCHOR.statement]: "banks",
  [SETTINGS_ANCHOR.accounts]: "banks",
  [SETTINGS_ANCHOR.exampleData]: "data",
  "tilien-kayttajat": "banks",
  [SETTINGS_ANCHOR.loans]: "household",
  [SETTINGS_ANCHOR.goal]: "household",
  "jasenet-ilman-tunnusta": "members",
  "tilien-jakaminen": "banks",
  [SETTINGS_ANCHOR.password]: "security",
  [SETTINGS_ANCHOR.login]: "security",
  [SETTINGS_ANCHOR.securityLog]: "security",
  palvelutunnukset: "security",
  [SETTINGS_ANCHOR.quality]: "data",
  [SETTINGS_ANCHOR.server]: "server",
  etakaytto: "server",
  [SETTINGS_ANCHOR.maintenance]: "server",
  [SETTINGS_ANCHOR.addOn]: "server",
};

/** The addresses of the targets only an admin is offered. */
const ADMIN_ONLY_PAGES: readonly string[] = SETTINGS_TARGETS.filter((t) => "admin" in t).map((t) => `settings/${t.id}`);

/** The anchor of an account's own row (part.ts `partAnchor`) opens Pankit ja tilit. */
const ACCOUNT_ROW_PREFIX = "tili-";

/** The address of a target, and of a card on it (`#/settings/security#salasana`). */
export function settingsHash(target: SettingsTarget, anchor?: string, params: URLSearchParams = new URLSearchParams()): string {
  return hashOf({ page: `settings/${target}`, params, ...(anchor ? { anchor } : {}) });
}

/** Where a bank is connected: Pankkiyhteydet opens its bank list. */
export const CONNECT_BANK_HASH = hashOf({ page: `settings/${FIRST_TARGET}`, params: new URLSearchParams({ add: "1" }) });

/** The address of a card of Asetukset by its anchor: the card's target is looked up, so a link names only the card. */
export function settingsCardHash(anchor: string, params?: URLSearchParams): string {
  return settingsHash(targetOfCard(anchor) ?? FIRST_TARGET, anchor, params);
}

function targetOfCard(anchor: string | undefined): SettingsTarget | undefined {
  if (!anchor) return undefined;
  if (WEB_EXTENSIONS.some((e) => e.settingsAnchor === anchor)) return ADD_ON_TARGET.id;
  if (anchor === SETTINGS_ANCHOR.addOn && WEB_EXTENSIONS.length > 0) return ADD_ON_TARGET.id;
  return CARD_TARGET[anchor] ?? (anchor.startsWith(ACCOUNT_ROW_PREFIX) ? "banks" : undefined);
}

/**
 * The route as the role may open it: an admin's target is the first target for a member, and its cards are not there to
 * name. The add-on target that is not offered opens the add-on's card on Palvelin ja ylläpito for an admin. The
 * add-on's card is an admin's on any target, so a member's address keeps its target and drops that anchor.
 */
function opened(route: Route, role: "admin" | "member"): Route {
  if (route.page === ADD_ON_PAGE && !addOnTargetOffered(role)) {
    return role === "admin" ? { page: "settings/server", params: route.params, anchor: SETTINGS_ANCHOR.addOn } : { page: `settings/${FIRST_TARGET}`, params: route.params };
  }
  if (role === "member" && route.anchor === SETTINGS_ANCHOR.addOn) return opened({ page: route.page, params: route.params }, role);
  if (role === "admin" || !ADMIN_ONLY_PAGES.includes(route.page)) return route;
  return { page: `settings/${FIRST_TARGET}`, params: route.params };
}

/** The value of `view` in the address of Tapahtumat that opens the merchants, with the rules under them. */
const VIEW_MERCHANTS = "merchants";

/**
 * Where an address of the merchants or the rules from another time opens: the Kauppiaat view of Tapahtumat
 * (`?view=merchants`), the rules at its `#saannot`. The merchants were a page of their own (`#/categories`,
 * `?tab=rules`, `#/rules`), and the rules were for a while a card of Asetukset > Talous (`#/settings/household#saannot`).
 */
function merchantsView(route: Route): Route {
  const params = new URLSearchParams(route.params);
  params.delete("tab");
  params.set("view", VIEW_MERCHANTS);
  const rules = route.page !== "categories" || route.params.get("tab") === "rules";
  const anchor = rules ? RULES_ANCHOR : route.anchor;
  return { page: "transactions", params, ...(anchor ? { anchor } : {}) };
}

/** The card of Raportit that tells the loans, as the anchor of its section. */
export const LOANS_REPORT_ANCHOR = "lainat";

/** The parameters with `patch` laid over them: a value that is empty or undefined removes its parameter. The one way an address is built from another. */
export function withParams(base: URLSearchParams, patch: Record<string, string | undefined>): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

/** `#/page?a=b#anchor` for a route. */
export function hashOf(route: Route): string {
  const q = route.params.toString();
  return `#/${route.page}${q ? `?${q}` : ""}${route.anchor ? `#${route.anchor}` : ""}`;
}

/** The route a `location.hash` names. Everything after a second `#` is the anchor, never part of a parameter. */
export function parseHash(hash: string): Route {
  const rest = hash.replace(/^#\/?/, "");
  const cut = rest.indexOf("#");
  const [path = "", search = ""] = (cut < 0 ? rest : rest.slice(0, cut)).split("?");
  const anchor = cut < 0 ? "" : rest.slice(cut + 1);
  return { page: path || "overview", params: new URLSearchParams(search), ...(anchor ? { anchor } : {}) };
}

/**
 * Where an address that is not a page's own opens, or null when it is. The router rewrites the address with
 * `replaceState`, so Back does not return to it. A period belongs to one page: a Raportit period on the month page, or
 * a month on Raportit, opens the page that offers it. Asetukset has six targets and the add-on target, each a route of
 * its own (`#/settings/household`): the bare `#/settings` (the return from a bank comes there with `connected` or
 * `error`, and `?add=1` opens the bank list) and an address that names no target open the first target with their
 * parameters, and a member's address of an admin's target opens the first target. An address that names a card on
 * another target (`#/settings/household#salasana`, from the time the cards were on three targets, or
 * `#/settings/household#<card of a module>` from before the add-on target) opens the target that has the card.
 *
 * Old addresses that are still rewritten: the merchants and the rules (`#/categories`, `#/rules`, the rules card that
 * was on Asetukset), which are the Kauppiaat view of Tapahtumat (`merchantsView`); the bare `#/settings#<card>` of
 * 1.0.0, which opens the target that has the card; Lisää (`#/more`), which opens Yhteenveto; Toistuvat
 * (`#/recurring`), which became Laskut (`#/bills`); and the technical page and Ylläpito of Asetukset (`?section=technical`,
 * `?section=maintenance`), which open the server target for an admin and the first target for a member.
 */
export function redirectRoute(route: Route, role: "admin" | "member" = "member"): Route | null {
  const section = route.page === "settings" ? route.params.get("section") : null;
  if (section === "security") {
    // the address a notice of 1.0.0 gave the security log: the log for an admin, the member's own sign-in otherwise
    const params = new URLSearchParams(route.params);
    params.delete("section");
    return { page: "settings/security", params, ...(role === "admin" ? { anchor: SETTINGS_ANCHOR.securityLog } : {}) };
  }
  if (section === "technical" || section === "maintenance") {
    const params = new URLSearchParams(route.params);
    params.delete("section");
    return opened({ page: "settings/server", params, ...(section === "maintenance" ? { anchor: SETTINGS_ANCHOR.maintenance } : {}) }, role);
  }
  if (route.page === "categories" || route.page === "rules" || ((route.page === "settings" || route.page.startsWith("settings/")) && route.anchor === RULES_ANCHOR)) return merchantsView(route);
  // an address that names a card on another target (a link from before the card moved) opens the card's own target
  const home = route.page === "settings" || route.page.startsWith("settings/") ? targetOfCard(route.anchor) : undefined;
  if (home && route.page !== `settings/${home}`) return opened({ page: `settings/${home}`, params: route.params, anchor: route.anchor! }, role);
  // the add-on target while no module is loaded, or with nothing there for a member
  if (route.page === ADD_ON_PAGE && !addOnTargetOffered(role)) return opened(route, role);
  // the bare address, and one under settings/ that names no target (typed by hand), open the first target
  if (route.page === "settings" || (route.page.startsWith("settings/") && route.page !== ADD_ON_PAGE && !SETTINGS_TARGETS.some((t) => route.page === `settings/${t.id}`))) return { page: `settings/${FIRST_TARGET}`, params: route.params };
  if (ADMIN_ONLY_PAGES.includes(route.page) && role !== "admin") return opened(route, role);
  // the Lisää screen (phone) is gone: its two links are a tab and the user menu
  if (route.page === "more") return { page: "overview", params: route.params };
  if (route.page === "recurring") return { page: "bills", params: route.params, ...(route.anchor ? { anchor: route.anchor } : {}) };
  const period = route.params.get("period");
  if (period && (route.page === "overview" || route.page === "reports")) {
    const home = pageOfPeriod(period);
    if (home && home !== route.page) return { page: home, params: route.params, ...(route.anchor ? { anchor: route.anchor } : {}) };
  }
  return null;
}
