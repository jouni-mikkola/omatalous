import { pageOfPeriod } from "./period.ts";

export interface Route {
  /** The page id in the address (`#/<id>`). */
  page: string;
  params: URLSearchParams;
  /** The part after a second `#` (`#/transactions?view=merchants#saannot`): a spot on the page to scroll to. */
  anchor?: string;
}

/** The Säännöt card under the merchant table. */
export const RULES_ANCHOR = "saannot";

/** The cards of Asetukset that an address can name, as anchors on the page. */
export const SETTINGS_ANCHOR = {
  login: "kirjautuminen",
  password: "salasana",
  securityLog: "turvallisuusloki",
  quality: "laatu",
  accounts: "tilit",
  loans: "lainat",
  server: "palvelin",
  maintenance: "yllapito",
} as const;

/** The `?section=` values that open the technical page of Asetukset. `server` and `maintenance` also name the card to scroll to. */
const TECHNICAL_SECTIONS: ReadonlySet<string> = new Set(["technical", "server", "maintenance"]);

/** The cards of the technical page that an address named before the page existed, when they sat on the page of everyone. */
const MOVED_CARDS: ReadonlySet<string> = new Set([SETTINGS_ANCHOR.login, SETTINGS_ANCHOR.securityLog, SETTINGS_ANCHOR.quality]);

/** Whether an address of Asetukset opens the technical page and not the plain one. */
export function onTechnicalPage(params: URLSearchParams): boolean {
  return TECHNICAL_SECTIONS.has(params.get("section") ?? "");
}

/** The card an address of Asetukset scrolls to: the one its anchor names, else the one its `section` is about. */
export function settingsCard(route: Route): string | undefined {
  const section = route.params.get("section");
  return route.anchor ?? (section === "server" ? SETTINGS_ANCHOR.server : section === "maintenance" ? SETTINGS_ANCHOR.maintenance : undefined);
}

/** The card of Raportit that tells the loans, as the anchor of its section. */
export const LOANS_REPORT_ANCHOR = "lainat";

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
 * Where an old address lives now, or null when it is current. The router rewrites the address with `replaceState`,
 * so a bookmark keeps working and Back does not return to the old address. A period belongs to one page: a Raportit
 * period on the month page, or a month on Raportit, opens the page that offers it. The merchants and the rules were
 * a page of their own (`#/categories`, `?tab=rules`, `#/rules`) and are now the Kauppiaat tab of Tapahtumat, the rules
 * under its table. Toistuvat (`#/recurring`) became Laskut (`#/bills`). Asetukset is a plain page and a technical one
 * (`?section=technical`). Its old Talous tab (`?tab=talous`) is gone: the page of everyone has the household's members,
 * and the log of the Talous tab is on the technical page. The old security page (`?section=security`) split by role: a
 * member's sessions and an admin's log are both cards of the technical page. A card that moved there keeps its anchor
 * (`#laatu`, `#kirjautuminen`, `#turvallisuusloki`). `?section=server`, `?section=maintenance` and `?add=1` are read by
 * the page itself and need no redirect.
 */
export function redirectRoute(route: Route, role: "admin" | "member" = "member"): Route | null {
  if (route.page === "settings") {
    const params = new URLSearchParams(route.params);
    const security = params.get("section") === "security";
    const anchor = security ? (role === "admin" ? SETTINGS_ANCHOR.securityLog : SETTINGS_ANCHOR.login) : route.anchor;
    const moved = security || (anchor !== undefined && MOVED_CARDS.has(anchor) && !onTechnicalPage(params));
    const talous = params.get("tab") === "talous";
    if (moved) params.set("section", "technical");
    if (talous) params.delete("tab");
    if (moved || talous) return { page: "settings", params, ...(anchor ? { anchor } : {}) };
  }
  if (route.page === "recurring") return { page: "bills", params: route.params, ...(route.anchor ? { anchor: route.anchor } : {}) };
  if (route.page === "categories" || route.page === "rules") {
    const params = new URLSearchParams(route.params);
    params.delete("tab");
    params.set("view", "merchants");
    const rules = route.page === "rules" || route.params.get("tab") === "rules";
    const anchor = rules ? RULES_ANCHOR : route.anchor;
    return { page: "transactions", params, ...(anchor ? { anchor } : {}) };
  }
  const period = route.params.get("period");
  if (period && (route.page === "overview" || route.page === "reports")) {
    const home = pageOfPeriod(period);
    if (home && home !== route.page) return { page: home, params: route.params, ...(route.anchor ? { anchor: route.anchor } : {}) };
  }
  return null;
}
