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

  it("a tab of Raportit opens the question page that holds its reports, and keeps the other parameters and the anchor", () => {
    expect(landing("reports", "tab=menot")).toBe("#/reports?q=menot");
    expect(landing("reports", "tab=virta&period=6m")).toBe("#/reports?period=6m&q=tulot");
    expect(landing("reports", "tab=varat")).toBe("#/reports?q=saldot");
    expect(hashOf(redirectRoute(route("reports", "tab=menot", "kuukaudet"))!)).toBe("#/reports?q=menot#kuukaudet");
    // a question the address already names wins, and a tab nobody knows is dropped
    expect(landing("reports", "tab=menot&q=velat")).toBe("#/reports?q=velat");
    expect(landing("reports", "tab=nonsense")).toBe("#/reports");
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
  it("the merchants page and the merchants tab open the rows grouped by merchant", () => {
    expect(landing("categories")).toBe("#/transactions?group=merchant");
    expect(landing("categories", "tab=merchants")).toBe("#/transactions?group=merchant");
    expect(landing("transactions", "view=merchants")).toBe("#/transactions?group=merchant");
  });

  it("the rules page, the rules tab and the rules under the old tab open the rules card", () => {
    expect(landing("rules")).toBe("#/settings/household#saannot");
    expect(landing("categories", "tab=rules")).toBe("#/settings/household#saannot");
    expect(hashOf(redirectRoute(route("transactions", "view=merchants", "saannot"))!)).toBe("#/settings/household#saannot");
  });

  it("keeps the filters the rows take, and drops the ones only the merchant list had", () => {
    expect(landing("transactions", "view=merchants&from=2026-09-01&to=2026-09-30&category=groceries&q=k")).toBe("#/transactions?from=2026-09-01&to=2026-09-30&category=groceries&q=k&group=merchant");
    expect(landing("transactions", "view=merchants&habit=1")).toBe("#/transactions?group=merchant");
    expect(landing("categories", "scope=household")).toBe("#/transactions?scope=household&group=merchant");
  });

  it("the rules keep the other parameters but not the filters, and the rules page wins over a tab that names the merchants", () => {
    expect(landing("categories", "tab=rules&scope=household")).toBe("#/settings/household?scope=household#saannot");
    expect(landing("rules", "tab=merchants")).toBe("#/settings/household#saannot");
    expect(hashOf(redirectRoute(route("transactions", "view=merchants&from=2026-09-01", "saannot"))!)).toBe("#/settings/household#saannot");
  });

  it("settles in one step, for a member and an admin", () => {
    for (const [page, query, anchor] of [["categories", ""], ["categories", "tab=rules"], ["rules", ""], ["transactions", "view=merchants"], ["transactions", "view=merchants", "saannot"]] as const) {
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
      expect(lands("#/settings?section=csv", role)).toBe("#/settings/banks");
      expect(lands("#/settings?tab=talous", role)).toBe("#/settings/banks");
    }
  });

  it("a card is on the target that has it, and keeps its anchor and its other parameters", () => {
    for (const role of both) {
      expect(lands("#/settings#pankkiyhteydet", role)).toBe("#/settings/banks#pankkiyhteydet");
      expect(lands("#/settings#tilit", role)).toBe("#/settings/banks#tilit");
      expect(lands("#/settings#tili-12", role)).toBe("#/settings/banks#tili-12");
      expect(lands("#/settings#lainat", role)).toBe("#/settings/household#lainat");
      expect(lands("#/settings?linkLoan=home&linkAccount=card#lainat", role)).toBe("#/settings/household?linkLoan=home&linkAccount=card#lainat");
      expect(lands("#/settings#tilien-jakaminen", role)).toBe("#/settings/banks#tilien-jakaminen");
      expect(lands("#/settings#palvelutunnukset", role)).toBe("#/settings/security#palvelutunnukset");
      expect(lands("#/settings#jasenet-ilman-tunnusta", role)).toBe(role === "admin" ? "#/settings/members#jasenet-ilman-tunnusta" : "#/settings/banks");
      expect(lands("#/settings#salasana", role)).toBe("#/settings/security#salasana");
      expect(lands("#/settings#kirjautuminen", role)).toBe("#/settings/security#kirjautuminen");
      expect(lands("#/settings#turvallisuusloki", role)).toBe("#/settings/security#turvallisuusloki");
      expect(lands("#/settings#laatu", role)).toBe("#/settings/data#laatu");
      expect(lands("#/settings?scope=household#laatu", role)).toBe("#/settings/data?scope=household#laatu");
    }
  });

  it("the old technical page, Palvelin and Ylläpito open the server for an admin; a member gets the first target, with no card to scroll to", () => {
    expect(lands("#/settings?section=technical", "admin")).toBe("#/settings/server");
    expect(lands("#/settings?section=server", "admin")).toBe("#/settings/server#palvelin");
    expect(lands("#/settings?section=maintenance", "admin")).toBe("#/settings/server#yllapito");
    expect(lands("#/settings?section=technical", "member")).toBe("#/settings/banks");
    expect(lands("#/settings?section=server", "member")).toBe("#/settings/banks");
    expect(lands("#/settings?section=maintenance", "member")).toBe("#/settings/banks");
  });

  it("the old security page opens the log for an admin and Omat istunnot for a member", () => {
    expect(lands("#/settings?section=security", "admin")).toBe("#/settings/security#turvallisuusloki");
    expect(lands("#/settings?section=security", "member")).toBe("#/settings/security#kirjautuminen");
    // the role is only known from the session, so a call without one reads as a member
    expect(hashOf(redirectRoute(route("settings", "section=security"))!)).toBe("#/settings/security#kirjautuminen");
    expect(lands("#/settings?tab=talous#turvallisuusloki", "admin")).toBe("#/settings/security#turvallisuusloki");
  });

  it("a card of a section that is named on its target is left alone", () => {
    for (const role of both) {
      for (const hash of ["#/settings/banks", "#/settings/household#lainat", "#/settings/security#salasana", "#/settings/data#laatu"]) {
        expect(redirectRoute(parseHash(hash), role), hash).toBeNull();
      }
    }
    expect(redirectRoute(parseHash("#/settings/server#palvelin"), "admin")).toBeNull();
  });

  it("a member's address of the server target opens the first target, and drops its card", () => {
    expect(lands("#/settings/server#yllapito", "member")).toBe("#/settings/banks");
    expect(lands("#/settings/server", "member")).toBe("#/settings/banks");
  });

  it("an address under settings that names no target opens the first one", () => {
    expect(lands("#/settings/nonsense", "admin")).toBe("#/settings/banks");
  });

  it("is not about another page's `section` parameter", () => {
    expect(redirectRoute(route("transactions", "section=security"), "admin")).toBeNull();
  });
});

describe("the targets of Asetukset", () => {
  it("are six for an admin and four for a member, without the admin's", () => {
    expect(settingsTargets("admin").map((t) => t.label)).toEqual(["Pankit ja tilit", "Talous", "Jäsenet", "Turvallisuus", "Tiedot", "Palvelin ja ylläpito"]);
    expect(settingsTargets("member").map((t) => t.id)).toEqual(["banks", "household", "security", "data"]);
  });

  it("have an address, and a card's address names its target", () => {
    expect(settingsHash("security", "salasana")).toBe("#/settings/security#salasana");
    expect(settingsCardHash("lainat")).toBe("#/settings/household#lainat");
    expect(settingsCardHash("etakaytto", new URLSearchParams("a=1"))).toBe("#/settings/server?a=1#etakaytto");
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

describe("withParams", () => {
  it("lays a patch over the parameters and drops an empty value", () => {
    const base = new URLSearchParams("tab=menot&period=12m&q=x");
    expect(withParams(base, { period: "6m", q: "" }).toString()).toBe("tab=menot&period=6m");
    expect(base.toString()).toBe("tab=menot&period=12m&q=x");
  });
});
