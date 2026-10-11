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
export const SETTINGS_ANCHOR = { login: "kirjautuminen", password: "salasana", securityLog: "turvallisuusloki", quality: "laatu", accounts: "tilit" } as const;

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
 * under its table. Toistuvat (`#/recurring`) became Laskut (`#/bills`). The old security page of Asetukset
 * (`?section=security`) split in two: a member's sessions are in Kirjautuminen, an admin's log is the Turvallisuusloki
 * of the Talous tab, so the role decides. `?section=server`, `?section=csv`, `?section=maintenance` and `?add=1` are
 * still read by the page itself and need no redirect.
 */
export function redirectRoute(route: Route, role: "admin" | "member" = "member"): Route | null {
  if (route.page === "settings" && route.params.get("section") === "security") {
    const params = new URLSearchParams(route.params);
    params.delete("section");
    if (role === "admin") params.set("tab", "talous");
    return { page: "settings", params, anchor: role === "admin" ? SETTINGS_ANCHOR.securityLog : SETTINGS_ANCHOR.login };
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
