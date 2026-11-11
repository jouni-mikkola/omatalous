import { WEB_EXTENSIONS } from "./extensions.ts";
import { pageOfPeriod } from "./period.ts";
import { t } from "./text.ts";

export interface Route {
  /** The page id in the address (`#/<id>`). */
  page: string;
  params: URLSearchParams;
  /** The part after a second `#` (`#/settings/household#saannot`): a spot on the page to scroll to. */
  anchor?: string;
}

/** The Säännöt card of Asetukset > Talous. */
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

export type SettingsTarget = (typeof SETTINGS_TARGETS)[number]["id"];

/** The target a member lands on, and an address of Asetukset with nothing to say where. */
const FIRST_TARGET: SettingsTarget = "banks";

/** The targets a user of this role is offered. */
export function settingsTargets(role: "admin" | "member"): readonly (typeof SETTINGS_TARGETS)[number][] {
  return SETTINGS_TARGETS.filter((t) => role === "admin" || !("admin" in t));
}

/** The target a card is on, by its anchor. The cards of the build's extensions are on Talous. */
const CARD_TARGET: Record<string, SettingsTarget> = {
  pankkiyhteydet: "banks",
  [SETTINGS_ANCHOR.bankApp]: "banks",
  [SETTINGS_ANCHOR.statement]: "banks",
  [SETTINGS_ANCHOR.accounts]: "banks",
  "tilien-kayttajat": "banks",
  [SETTINGS_ANCHOR.loans]: "household",
  [SETTINGS_ANCHOR.goal]: "household",
  [RULES_ANCHOR]: "household",
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
};

/** The addresses of the targets only an admin is offered. */
const ADMIN_ONLY_PAGES: readonly string[] = SETTINGS_TARGETS.filter((t) => "admin" in t).map((t) => `settings/${t.id}`);

/** The anchor of an account's own row (part.ts `partAnchor`) opens Pankit ja tilit. */
const ACCOUNT_ROW_PREFIX = "tili-";

/** What the removed `?section=` values of Asetukset meant: the card to open, and for `technical` the target of the old page. */
const SECTION_CARD: Record<string, string> = { server: SETTINGS_ANCHOR.server, maintenance: SETTINGS_ANCHOR.maintenance };

/** The address of a target, and of a card on it (`#/settings/security#salasana`). */
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
  if (WEB_EXTENSIONS.some((e) => e.settingsAnchor === anchor)) return "household";
  return CARD_TARGET[anchor] ?? (anchor.startsWith(ACCOUNT_ROW_PREFIX) ? "banks" : undefined);
}

/** The route as the role may open it: an admin's target is the first target for a member, and its cards are not there to name. */
function opened(route: Route, role: "admin" | "member"): Route {
  if (role === "admin" || !ADMIN_ONLY_PAGES.includes(route.page)) return route;
  return { page: `settings/${FIRST_TARGET}`, params: route.params };
}

/**
 * Where the address of Asetukset from before its targets lives now. The card named by the anchor, or by the removed
 * `?section=server|maintenance|security`, decides the target; the old technical page opens the server for an admin and
 * the first target for a member. `?add=1`, `connected` and `error` (the return from a bank) are Pankit ja tilit.
 */
function settingsMoved(route: Route, role: "admin" | "member"): Route {
  const params = new URLSearchParams(route.params);
  const section = params.get("section");
  const security = section === "security";
  const anchor = security ? (role === "admin" ? SETTINGS_ANCHOR.securityLog : SETTINGS_ANCHOR.login) : (route.anchor ?? (section ? SECTION_CARD[section] : undefined));
  params.delete("section");
  params.delete("tab");
  const target = targetOfCard(anchor) ?? (section === "technical" && role === "admin" ? "server" : FIRST_TARGET);
  return opened({ page: `settings/${target}`, params, ...(anchor ? { anchor } : {}) }, role);
}

/** The value of `group` in the address of Tapahtumat that puts the rows under their merchant. */
const GROUP_MERCHANT = "merchant";

/**
 * Where an address of the merchant list or the rules lives now. The rules (`#/rules`, `?tab=rules`, the anchor of the
 * old tab) are the Säännöt card of Asetukset; the merchant list is Tapahtumat grouped by merchant, with the filters the
 * rows also take. `habit` was the merchant list's own and is dropped.
 */
function merchantsMoved(route: Route): Route {
  const params = new URLSearchParams(route.params);
  const rules = route.page === "rules" || params.get("tab") === "rules" || route.anchor === RULES_ANCHOR;
  for (const gone of ["tab", "view", "habit"]) params.delete(gone);
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

/** The three tabs Raportit had (`?tab=`) and the question page that now holds most of what each showed. */
const LEGACY_REPORT_TABS: Readonly<Record<string, string>> = { virta: "tulot", menot: "menot", varat: "saldot" };

/**
 * Where an old address lives now, or null when it is current. The router rewrites the address with `replaceState`,
 * so a bookmark keeps working and Back does not return to the old address. A period belongs to one page: a Raportit
 * period on the month page, or a month on Raportit, opens the page that offers it. The tabs of Raportit (`?tab=menot`) became question pages (`?q=menot`). The merchants and the rules were
 * a page of their own (`#/categories`, `?tab=rules`, `#/rules`) and then a tab of Tapahtumat (`?view=merchants`, the
 * rules at `#saannot`): the merchants are now the rows of Tapahtumat grouped by merchant (`?group=merchant`) and the
 * rules a card of Asetukset (`merchantsMoved`). Toistuvat (`#/recurring`) became Laskut (`#/bills`). Lisää (`#/more`) opens Yhteenveto. Asetukset has six targets, each a route of its own
 * (`#/settings/security`): the bare `#/settings`, `?section=` (technical, server, maintenance, security), `?tab=talous`
 * and an anchor from before the targets open the target that has the card (`settingsMoved`), and a member's address of
 * the server target opens the first target.
 */
export function redirectRoute(route: Route, role: "admin" | "member" = "member"): Route | null {
  if (route.page === "settings") return settingsMoved(route, role);
  // an address under settings/ that names no target (typed by hand) opens the first one
  if (route.page.startsWith("settings/") && !SETTINGS_TARGETS.some((t) => route.page === `settings/${t.id}`)) return { page: `settings/${FIRST_TARGET}`, params: route.params };
  if (ADMIN_ONLY_PAGES.includes(route.page) && role !== "admin") return opened(route, role);
  // the Lisää screen (phone) is gone: its two links are a tab and the user menu
  if (route.page === "more") return { page: "overview", params: route.params };
  if (route.page === "recurring") return { page: "bills", params: route.params, ...(route.anchor ? { anchor: route.anchor } : {}) };
  if (route.page === "categories" || route.page === "rules" || (route.page === "transactions" && route.params.get("view") === "merchants")) return merchantsMoved(route);
  if (route.page === "reports" && route.params.has("tab")) {
    const params = new URLSearchParams(route.params);
    const q = LEGACY_REPORT_TABS[params.get("tab") ?? ""];
    params.delete("tab");
    if (q && !params.has("q")) params.set("q", q);
    return { page: "reports", params, ...(route.anchor ? { anchor: route.anchor } : {}) };
  }
  const period = route.params.get("period");
  if (period && (route.page === "overview" || route.page === "reports")) {
    const home = pageOfPeriod(period);
    if (home && home !== route.page) return { page: home, params: route.params, ...(route.anchor ? { anchor: route.anchor } : {}) };
  }
  return null;
}
