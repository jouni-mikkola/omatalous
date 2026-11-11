import { pageOfPeriod } from "./period.ts";
import { t } from "./text.ts";

export interface Route {
  /** The page id in the address (`#/<id>`). */
  page: string;
  params: URLSearchParams;
  /** The part after a second `#` (`#/settings/household#saannot`): a spot on the page to scroll to. */
  anchor?: string;
}

/** The Säännöt card of Asetukset > Kotitalous. */
export const RULES_ANCHOR = "saannot";

/** The cards of Asetukset that an address can name, as anchors on the page. */
export const SETTINGS_ANCHOR = {
  login: "kirjautuminen",
  password: "salasana",
  securityLog: "turvallisuusloki",
  quality: "laatu",
  accounts: "tilit",
  loans: "lainat",
  goal: "menotavoite",
  bankApp: "pankkisovellus",
  statement: "tiliote",
  server: "palvelin",
  maintenance: "yllapito",
} as const;

/**
 * The three targets of Asetukset, in the order the reader sees them. Each is a route of its own (`#/settings/<id>`); an
 * `admin` target is not offered to a member and its address opens the first target instead.
 */
export const SETTINGS_TARGETS = [
  { id: "banks", get label() { return t("set.tab.banks"); } },
  { id: "household", get label() { return t("set.tab.household"); } },
  { id: "server", get label() { return t("set.tab.server"); }, admin: true },
] as const satisfies readonly { id: string; label: string; admin?: true }[];

export type SettingsTarget = (typeof SETTINGS_TARGETS)[number]["id"];

/** The target a member lands on, and an address of Asetukset with nothing to say where. */
const FIRST_TARGET: SettingsTarget = "banks";

/** The targets a user of this role is offered. */
export function settingsTargets(role: "admin" | "member"): readonly (typeof SETTINGS_TARGETS)[number][] {
  return SETTINGS_TARGETS.filter((t) => role === "admin" || !("admin" in t));
}

/** The target a card is on, by its anchor. */
const CARD_TARGET: Record<string, SettingsTarget> = {
  pankkiyhteydet: "banks",
  [SETTINGS_ANCHOR.bankApp]: "banks",
  [SETTINGS_ANCHOR.statement]: "banks",
  [SETTINGS_ANCHOR.accounts]: "banks",
  "tilien-kayttajat": "banks",
  [SETTINGS_ANCHOR.loans]: "household",
  [SETTINGS_ANCHOR.goal]: "household",
  [RULES_ANCHOR]: "household",
  "jasenet-ilman-tunnusta": "household",
  "tilien-jakaminen": "banks",
  [SETTINGS_ANCHOR.password]: "household",
  [SETTINGS_ANCHOR.login]: "household",
  [SETTINGS_ANCHOR.securityLog]: "server",
  palvelutunnukset: "household",
  [SETTINGS_ANCHOR.quality]: "banks",
  [SETTINGS_ANCHOR.server]: "server",
  etakaytto: "server",
  [SETTINGS_ANCHOR.maintenance]: "server",
};

/** Where the three targets that were folded into the others live now: an address that names one opens the target that has its cards. */
const MOVED_TARGET: Record<string, SettingsTarget> = { members: "household", security: "household", data: "banks" };

/** The addresses of the targets only an admin is offered. */
const ADMIN_ONLY_PAGES: readonly string[] = SETTINGS_TARGETS.filter((t) => "admin" in t).map((t) => `settings/${t.id}`);

/** The anchor of an account's own row (part.ts `partAnchor`) opens Pankit ja tilit. */
const ACCOUNT_ROW_PREFIX = "tili-";

/** The address of a target, and of a card on it (`#/settings/household#salasana`). */
export function settingsHash(target: SettingsTarget, anchor?: string, params: URLSearchParams = new URLSearchParams()): string {
  return hashOf({ page: `settings/${target}`, params, ...(anchor ? { anchor } : {}) });
}

/** Where a price rise is worked out: Kiinteät menot, Hinnanmuutokset. Every other page names the rise in one line and links here. */
export const PRICE_RISES_HASH = hashOf({ page: "reports", params: new URLSearchParams({ q: "kiinteat" }), anchor: "kiinteat-hinnat" });

/** Where a bank is connected: Pankkiyhteydet opens its bank list. */
export const CONNECT_BANK_HASH = hashOf({ page: `settings/${FIRST_TARGET}`, params: new URLSearchParams({ add: "1" }) });

/** The address of a card of Asetukset by its anchor: the card's target is looked up, so a link names only the card. */
export function settingsCardHash(anchor: string, params?: URLSearchParams): string {
  return settingsHash(targetOfCard(anchor) ?? FIRST_TARGET, anchor, params);
}

function targetOfCard(anchor: string | undefined): SettingsTarget | undefined {
  if (!anchor) return undefined;
  return CARD_TARGET[anchor] ?? (anchor.startsWith(ACCOUNT_ROW_PREFIX) ? "banks" : undefined);
}

/** The route as the role may open it: an admin's target is the first target for a member, and its cards are not there to name. */
function opened(route: Route, role: "admin" | "member"): Route {
  if (role === "admin" || !ADMIN_ONLY_PAGES.includes(route.page)) return route;
  return { page: `settings/${FIRST_TARGET}`, params: route.params };
}

/** The value of `group` in the address of Tapahtumat that puts the rows under their merchant. */
const GROUP_MERCHANT = "merchant";

/**
 * Where an address of the merchants tab of Tapahtumat (`?view=merchants`) lives now. The rules under the tab (its
 * `#saannot` anchor) are the Säännöt card of Asetukset; the merchant list is Tapahtumat grouped by merchant, with the
 * filters the rows also take. `habit` was the merchant list's own and is dropped.
 */
function merchantsMoved(route: Route): Route {
  const params = new URLSearchParams(route.params);
  const rules = route.anchor === RULES_ANCHOR;
  for (const gone of ["view", "habit"]) params.delete(gone);
  if (rules) {
    // the filters of the merchant list say nothing on Asetukset
    for (const filter of ["q", "category", "from", "to"]) params.delete(filter);
    return { page: `settings/${targetOfCard(RULES_ANCHOR) ?? FIRST_TARGET}`, params, anchor: RULES_ANCHOR };
  }
  params.set("group", GROUP_MERCHANT);
  return { page: "transactions", params, ...(route.anchor ? { anchor: route.anchor } : {}) };
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
 * a month on Raportit, opens the page that offers it. Asetukset has three targets, each a route of its own
 * (`#/settings/household`): the bare `#/settings` (the return from a bank comes there with `connected` or `error`, and
 * `?add=1` opens the bank list) and an address that names no target open the first target with their parameters, and
 * a member's address of the server target opens the first target. An address of one of the three targets that were
 * folded into the others (`#/settings/security`, released in 1.0.0) opens the target that has its cards now, on the
 * card it names.
 *
 * Four old addresses are still rewritten, because no released notice has named them: the merchants tab of Tapahtumat
 * (`?view=merchants`, the rules at `#saannot`), which is now the rows grouped by merchant (`?group=merchant`) and the
 * rules card of Asetukset (`merchantsMoved`); Lisää (`#/more`), which opens Yhteenveto; Toistuvat (`#/recurring`),
 * which became Laskut (`#/bills`); and the technical page and Ylläpito of Asetukset (`?section=technical`,
 * `?section=maintenance`), which open the server target for an admin and the first target for a member.
 */
export function redirectRoute(route: Route, role: "admin" | "member" = "member"): Route | null {
  const section = route.page === "settings" ? route.params.get("section") : null;
  if (section === "technical" || section === "maintenance") {
    const params = new URLSearchParams(route.params);
    params.delete("section");
    return opened({ page: "settings/server", params, ...(section === "maintenance" ? { anchor: SETTINGS_ANCHOR.maintenance } : {}) }, role);
  }
  const moved = route.page.startsWith("settings/") ? MOVED_TARGET[route.page.slice("settings/".length)] : undefined;
  if (moved) return opened({ page: `settings/${targetOfCard(route.anchor) ?? moved}`, params: route.params, ...(route.anchor ? { anchor: route.anchor } : {}) }, role);
  // the bare address, and one under settings/ that names no target (typed by hand), open the first target
  if (route.page === "settings" || (route.page.startsWith("settings/") && !SETTINGS_TARGETS.some((t) => route.page === `settings/${t.id}`))) return { page: `settings/${FIRST_TARGET}`, params: route.params };
  if (ADMIN_ONLY_PAGES.includes(route.page) && role !== "admin") return opened(route, role);
  // the Lisää screen (phone) is gone: its two links are a tab and the user menu
  if (route.page === "more") return { page: "overview", params: route.params };
  if (route.page === "recurring") return { page: "bills", params: route.params, ...(route.anchor ? { anchor: route.anchor } : {}) };
  if (route.page === "transactions" && route.params.get("view") === "merchants") return merchantsMoved(route);
  const period = route.params.get("period");
  if (period && (route.page === "overview" || route.page === "reports")) {
    const home = pageOfPeriod(period);
    if (home && home !== route.page) return { page: home, params: route.params, ...(route.anchor ? { anchor: route.anchor } : {}) };
  }
  return null;
}
