import { describe, expect, it } from "vitest";
import { hashOf, parseHash, redirectRoute, type Route } from "../src/routes.ts";

const route = (page: string, query = "", anchor?: string): Route => ({ page, params: new URLSearchParams(query), ...(anchor ? { anchor } : {}) });
/** Where an address ends up: the redirect when there is one, else itself. */
const landing = (page: string, query = "") => hashOf(redirectRoute(route(page, query)) ?? route(page, query));

describe("redirectRoute", () => {
  it("a period of Raportit on the month page opens Raportit with that period", () => {
    for (const id of ["3m", "6m", "12m", "year", "last-year"]) expect(landing("overview", `period=${id}`)).toBe(`#/reports?period=${id}`);
  });

  it("a month on Raportit opens the month page with that period", () => {
    expect(landing("reports", "period=month")).toBe("#/overview?period=month");
    expect(landing("reports", "period=last-month")).toBe("#/overview?period=last-month");
  });

  it("keeps the other parameters of the address", () => {
    expect(landing("overview", "period=6m&scope=household")).toBe("#/reports?period=6m&scope=household");
  });

  it("Toistuvat is Laskut: the old address opens the new page and keeps its other parameters", () => {
    expect(landing("recurring")).toBe("#/bills");
    expect(landing("recurring", "scope=household")).toBe("#/bills?scope=household");
    expect(redirectRoute(redirectRoute(route("recurring"))!)).toBeNull();
  });

  it("Toistuvat keeps the anchor of its address, as the period redirect does", () => {
    expect(redirectRoute(route("recurring", "", "tulossa"))?.anchor).toBe("tulossa");
    expect(hashOf(redirectRoute(route("recurring", "scope=household", "tulevat"))!)).toBe("#/bills?scope=household#tulevat");
    expect(redirectRoute(route("recurring"))).not.toHaveProperty("anchor");
  });

  it("leaves a current address alone", () => {
    expect(redirectRoute(route("bills"))).toBeNull();
    expect(redirectRoute(route("overview"))).toBeNull();
    expect(redirectRoute(route("overview", "period=last-month"))).toBeNull();
    expect(redirectRoute(route("reports"))).toBeNull();
    expect(redirectRoute(route("reports", "period=12m"))).toBeNull();
    // other pages have no period switch, so their `period` is not ours to move
    expect(redirectRoute(route("transactions", "period=3m"))).toBeNull();
    // a period no page offers is left for the page to read as its default
    expect(redirectRoute(route("reports", "period=nonsense"))).toBeNull();
    expect(redirectRoute(route("overview", "period="))).toBeNull();
  });

  it("settles in one step: the target is not redirected again", () => {
    for (const [page, query] of [["overview", "period=3m"], ["overview", "period=year"], ["reports", "period=month"], ["reports", "period=last-month"]] as const) {
      const moved = redirectRoute(route(page, query))!;
      expect(redirectRoute(moved)).toBeNull();
    }
  });
});

describe("redirectRoute: Kategoriat is the Kauppiaat tab of Tapahtumat", () => {
  it("the merchants page opens the tab, the rules page and the rules tab open it at the rules", () => {
    expect(landing("categories")).toBe("#/transactions?view=merchants");
    expect(landing("categories", "tab=merchants")).toBe("#/transactions?view=merchants");
    expect(landing("categories", "tab=rules")).toBe("#/transactions?view=merchants#saannot");
    expect(landing("rules")).toBe("#/transactions?view=merchants#saannot");
  });

  it("keeps the other parameters, and the rules page wins over a tab that names the merchants", () => {
    expect(landing("categories", "tab=rules&scope=household")).toBe("#/transactions?scope=household&view=merchants#saannot");
    expect(landing("rules", "tab=merchants")).toBe("#/transactions?view=merchants#saannot");
  });

  it("settles in one step", () => {
    for (const [page, query] of [["categories", ""], ["categories", "tab=rules"], ["rules", ""]] as const) {
      expect(redirectRoute(redirectRoute(route(page, query))!)).toBeNull();
    }
  });

  it("leaves the tab itself alone", () => {
    expect(redirectRoute(route("transactions", "view=merchants", "saannot"))).toBeNull();
    expect(redirectRoute(route("transactions", "view=merchants&from=2026-09-01&to=2026-09-30"))).toBeNull();
  });
});

describe("redirectRoute: the security page of Asetukset", () => {
  it("a member's old address opens Kirjautuminen, an admin's opens Turvallisuusloki in the Talous tab", () => {
    const old = route("settings", "section=security");
    expect(hashOf(redirectRoute(old, "member")!)).toBe("#/settings#kirjautuminen");
    expect(hashOf(redirectRoute(old, "admin")!)).toBe("#/settings?tab=talous#turvallisuusloki");
    // the role is only known from the session, so a call without one reads as a member
    expect(hashOf(redirectRoute(old)!)).toBe("#/settings#kirjautuminen");
  });

  it("keeps the other parameters and settles in one step", () => {
    const old = route("settings", "section=security&scope=household");
    expect(hashOf(redirectRoute(old, "member")!)).toBe("#/settings?scope=household#kirjautuminen");
    for (const role of ["admin", "member"] as const) expect(redirectRoute(redirectRoute(old, role)!, role)).toBeNull();
  });

  it("leaves the addresses that keep working alone: Palvelin, the CSV import, the bank picker, the maintenance page and the tab", () => {
    for (const query of ["section=server", "section=csv", "add=1", "section=maintenance", "tab=talous", "connected=2", "error=cancelled"]) {
      for (const role of ["admin", "member"] as const) expect(redirectRoute(route("settings", query), role), query).toBeNull();
    }
    expect(redirectRoute(route("settings", "", "kirjautuminen"))).toBeNull();
    expect(redirectRoute(route("settings", "", "laatu"))).toBeNull();
  });

  it("is not about another page's `section` parameter", () => {
    expect(redirectRoute(route("transactions", "section=security"), "admin")).toBeNull();
  });
});

describe("parseHash", () => {
  it("reads the page, the parameters and the anchor", () => {
    const r = parseHash("#/transactions?view=merchants&from=2026-09-01#saannot");
    expect(r.page).toBe("transactions");
    expect(Object.fromEntries(r.params)).toEqual({ view: "merchants", from: "2026-09-01" });
    expect(r.anchor).toBe("saannot");
  });

  it("has no anchor when the address names none, and opens the month page for an empty one", () => {
    expect(parseHash("#/reports?period=3m")).toEqual(route("reports", "period=3m"));
    expect(parseHash("")).toEqual(route("overview"));
    expect(parseHash("#/")).toEqual(route("overview"));
    expect(parseHash("#/settings#").anchor).toBeUndefined();
  });

  it("an anchor is never read as part of a parameter", () => {
    expect(parseHash("#/transactions?view=merchants#saannot").params.get("view")).toBe("merchants");
  });

  it("is the inverse of hashOf", () => {
    for (const h of ["#/overview", "#/reports?period=3m", "#/transactions?view=merchants#saannot", "#/transactions?view=merchants&habit=1"]) {
      expect(hashOf(parseHash(h))).toBe(h);
    }
  });
});

describe("hashOf", () => {
  it("writes the address the router reads", () => {
    expect(hashOf(route("overview"))).toBe("#/overview");
    expect(hashOf(route("reports", "period=3m"))).toBe("#/reports?period=3m");
    expect(hashOf(route("transactions", "view=merchants", "saannot"))).toBe("#/transactions?view=merchants#saannot");
  });
});
