import { describe, expect, it } from "vitest";
import { hashOf, parseHash, redirectRoute, type Route, settingsCardHash, settingsHash, settingsTargets, withParams } from "../src/routes.ts";

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
    expect(landing("more")).toBe("#/overview");
    expect(landing("recurring")).toBe("#/bills");
    expect(landing("recurring", "scope=household")).toBe("#/bills?scope=household");
    expect(redirectRoute(redirectRoute(route("recurring"))!)).toBeNull();
  });

  it("Toistuvat keeps the anchor of its address, as the period redirect does", () => {
    expect(redirectRoute(route("recurring", "", "tulossa"))?.anchor).toBe("tulossa");
    expect(hashOf(redirectRoute(route("recurring", "scope=household", "tulevat"))!)).toBe("#/bills?scope=household#tulevat");
    expect(redirectRoute(route("recurring"))).not.toHaveProperty("anchor");
  });

  it("keeps the anchor of the address", () => {
    expect(hashOf(redirectRoute(route("overview", "period=6m", "kuukaudet"))!)).toBe("#/reports?period=6m#kuukaudet");
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

describe("redirectRoute: the merchants are a grouping of Tapahtumat and the rules a card of Asetukset", () => {
  it("the merchants tab opens the rows grouped by merchant", () => {
    expect(landing("transactions", "view=merchants")).toBe("#/transactions?group=merchant");
  });

  it("the rules under the merchants tab open the rules card", () => {
    expect(hashOf(redirectRoute(route("transactions", "view=merchants", "saannot"))!)).toBe("#/settings/household#saannot");
  });

  it("keeps the filters the rows take, and drops the ones only the merchant list had", () => {
    expect(landing("transactions", "view=merchants&from=2026-09-01&to=2026-09-30&category=groceries&q=k")).toBe("#/transactions?from=2026-09-01&to=2026-09-30&category=groceries&q=k&group=merchant");
    expect(landing("transactions", "view=merchants&habit=1")).toBe("#/transactions?group=merchant");
    expect(landing("transactions", "view=merchants&scope=household")).toBe("#/transactions?scope=household&group=merchant");
  });

  it("the rules keep the other parameters but not the filters", () => {
    expect(hashOf(redirectRoute(route("transactions", "view=merchants&scope=household&from=2026-09-01", "saannot"))!)).toBe("#/settings/household?scope=household#saannot");
  });

  it("settles in one step, for a member and an admin", () => {
    for (const [page, query, anchor] of [["transactions", "view=merchants"], ["transactions", "view=merchants", "saannot"]] as const) {
      for (const role of ["member", "admin"] as const) expect(redirectRoute(redirectRoute(route(page, query, anchor), role)!, role)).toBeNull();
    }
  });

  it("leaves the new addresses alone", () => {
    expect(redirectRoute(route("transactions", "group=merchant"))).toBeNull();
    expect(redirectRoute(route("settings/household", "", "saannot"))).toBeNull();
    expect(settingsCardHash("saannot")).toBe("#/settings/household#saannot");
  });
});

describe("Asetukset: the target and the card every address lands on", () => {
  type Role = "admin" | "member";
  const both: Role[] = ["admin", "member"];
  /** The address after the router rewrote it, which must be where the next step leaves it. */
  const lands = (hash: string, role: Role) => {
    const asked = parseHash(hash);
    const final = redirectRoute(asked, role) ?? asked;
    expect(redirectRoute(final, role), `${hash} settles in one step`).toBeNull();
    return hashOf(final);
  };

  it("the bare address opens the first target, with the bank picker and the return from a bank", () => {
    for (const role of both) {
      expect(lands("#/settings", role)).toBe("#/settings/banks");
      expect(lands("#/settings?add=1", role)).toBe("#/settings/banks?add=1");
      expect(lands("#/settings?connected=2", role)).toBe("#/settings/banks?connected=2");
      expect(lands("#/settings?error=cancelled", role)).toBe("#/settings/banks?error=cancelled");
    }
  });

  it("the old technical page and Ylläpito open the server for an admin; a member gets the first target, with no card to scroll to", () => {
    expect(lands("#/settings?section=technical", "admin")).toBe("#/settings/server");
    expect(lands("#/settings?section=maintenance", "admin")).toBe("#/settings/server#yllapito");
    expect(lands("#/settings?section=technical", "member")).toBe("#/settings/banks");
    expect(lands("#/settings?section=maintenance", "member")).toBe("#/settings/banks");
  });

  it("the bare address names no card: an anchor on it opens the first target and is dropped", () => {
    for (const role of both) {
      expect(lands("#/settings#turvallisuusloki", role)).toBe("#/settings/banks");
      expect(lands("#/settings?add=1#tilit", role)).toBe("#/settings/banks?add=1");
    }
  });

  it("a card of a section that is named on its target is left alone", () => {
    for (const role of both) {
      for (const hash of ["#/settings/banks", "#/settings/household#lainat", "#/settings/security#salasana", "#/settings/security", "#/settings/data"]) {
        expect(redirectRoute(parseHash(hash), role), hash).toBeNull();
      }
    }
    expect(redirectRoute(parseHash("#/settings/server#palvelin"), "admin")).toBeNull();
    expect(redirectRoute(parseHash("#/settings/members"), "admin")).toBeNull();
  });

  it("a member's address of an admin's target opens the first target, and drops its card", () => {
    expect(lands("#/settings/server#yllapito", "member")).toBe("#/settings/banks");
    expect(lands("#/settings/server", "member")).toBe("#/settings/banks");
    expect(lands("#/settings/members", "member")).toBe("#/settings/banks");
  });

  it("an address that names a card on another target opens the target that has the card", () => {
    for (const role of both) {
      expect(lands("#/settings/household#salasana", role)).toBe("#/settings/security#salasana");
      expect(lands("#/settings/household?a=1#kirjautuminen", role)).toBe("#/settings/security?a=1#kirjautuminen");
      expect(lands("#/settings/banks#esimerkkitiedot", role)).toBe("#/settings/data#esimerkkitiedot");
    }
    expect(lands("#/settings/server#turvallisuusloki", "admin")).toBe("#/settings/security#turvallisuusloki");
    // a member has Turvallisuus too, without the log: the address stays and there is no card to scroll to
    expect(redirectRoute(parseHash("#/settings/security#turvallisuusloki"), "member")).toBeNull();
    expect(lands("#/settings/server#salasana", "member")).toBe("#/settings/security#salasana");
    // the address of the security log in 1.0.0
    expect(lands("#/settings?section=security", "admin")).toBe("#/settings/security#turvallisuusloki");
    expect(lands("#/settings?section=security&a=1", "member")).toBe("#/settings/security?a=1");
    // a card of an admin's target: a member gets the first target with no card to scroll to
    expect(lands("#/settings/household#jasenet-ilman-tunnusta", "admin")).toBe("#/settings/members#jasenet-ilman-tunnusta");
    expect(lands("#/settings/household#jasenet-ilman-tunnusta", "member")).toBe("#/settings/banks");
  });

  it("an address under settings that names no target opens the first one", () => {
    expect(lands("#/settings/nonsense", "admin")).toBe("#/settings/banks");
  });

  it("is not about another page's `section` parameter", () => {
    expect(redirectRoute(route("transactions", "section=security"), "admin")).toBeNull();
  });
});

describe("the targets of Asetukset", () => {
  it("are the six of 1.0.0 for an admin and four for a member, without the admin's", () => {
    expect(settingsTargets("admin").map((t) => t.label)).toEqual(["Pankit ja tilit", "Talous", "Jäsenet", "Turvallisuus", "Tiedot", "Palvelin ja ylläpito"]);
    expect(settingsTargets("member").map((t) => t.id)).toEqual(["banks", "household", "security", "data"]);
  });

  it("have an address, and a card's address names its target", () => {
    expect(settingsHash("security", "salasana")).toBe("#/settings/security#salasana");
    expect(settingsCardHash("kirjautuminen")).toBe("#/settings/security#kirjautuminen");
    expect(settingsCardHash("turvallisuusloki")).toBe("#/settings/security#turvallisuusloki");
    expect(settingsCardHash("esimerkkitiedot")).toBe("#/settings/data#esimerkkitiedot");
    expect(settingsCardHash("lainat")).toBe("#/settings/household#lainat");
    expect(settingsCardHash("etakaytto", new URLSearchParams("a=1"))).toBe("#/settings/server?a=1#etakaytto");
  });
});

describe("parseHash", () => {
  it("reads the page, the parameters and the anchor", () => {
    const r = parseHash("#/transactions?group=merchant&from=2026-09-01#saannot");
    expect(r.page).toBe("transactions");
    expect(Object.fromEntries(r.params)).toEqual({ group: "merchant", from: "2026-09-01" });
    expect(r.anchor).toBe("saannot");
  });

  it("has no anchor when the address names none, and opens the month page for an empty one", () => {
    expect(parseHash("#/reports?period=3m")).toEqual(route("reports", "period=3m"));
    expect(parseHash("")).toEqual(route("overview"));
    expect(parseHash("#/")).toEqual(route("overview"));
    expect(parseHash("#/settings#").anchor).toBeUndefined();
  });

  it("an anchor is never read as part of a parameter", () => {
    expect(parseHash("#/transactions?group=merchant#saannot").params.get("group")).toBe("merchant");
  });

  it("is the inverse of hashOf", () => {
    for (const h of ["#/overview", "#/reports?period=3m", "#/transactions?group=merchant#saannot", "#/transactions?group=merchant&scope=household"]) {
      expect(hashOf(parseHash(h))).toBe(h);
    }
  });
});

describe("hashOf", () => {
  it("writes the address the router reads", () => {
    expect(hashOf(route("overview"))).toBe("#/overview");
    expect(hashOf(route("reports", "period=3m"))).toBe("#/reports?period=3m");
    expect(hashOf(route("transactions", "group=merchant", "saannot"))).toBe("#/transactions?group=merchant#saannot");
  });
});

describe("withParams", () => {
  it("lays a patch over the parameters and drops an empty value", () => {
    const base = new URLSearchParams("scope=household&period=12m&q=x");
    expect(withParams(base, { period: "6m", q: "" }).toString()).toBe("scope=household&period=6m");
    expect(base.toString()).toBe("scope=household&period=12m&q=x");
  });
});
