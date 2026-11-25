import { describe, expect, it } from "vitest";
import { NAV, namesItself, readsScope, REVIEW, SETTINGS } from "../src/nav.ts";

describe("NAV", () => {
  it("is Yhteenveto | Tapahtumat | Laskut | Varat ja velat | Raportit: no entry hides behind a flag", () => {
    expect(NAV.map((e) => e.label)).toEqual(["Yhteenveto", "Tapahtumat", "Laskut", "Varat ja velat", "Raportit"]);
    expect(NAV.every((e) => !("feature" in e))).toBe(true);
  });

  it("keeps the addresses of the pages", () => {
    expect(NAV.map((e) => e.id)).toEqual(["overview", "transactions", "bills", "balances", "reports"]);
  });

  it("Asetukset is in the user menu, not a nav entry, and a page of its own", () => {
    expect(NAV.map((e) => e.id)).not.toContain("settings");
    expect(SETTINGS).toEqual({ id: "settings", label: "Asetukset" });
  });

  it("offers the scope on the five pages and on no page that does not read it", () => {
    expect(NAV.map((e) => readsScope(e.id))).toEqual([true, true, true, true, true]);
    expect([REVIEW.id, SETTINGS.id, "esimerkki", ""].map(readsScope)).toEqual([false, false, false, false]);
  });

  it("leaves the title to the shell on Asetukset and on the page of an add-on module", () => {
    expect([...NAV.map((e) => e.id), REVIEW.id].map(namesItself)).toEqual([true, true, true, true, true, true]);
    expect([SETTINGS.id, "esimerkki"].map(namesItself)).toEqual([false, false]);
  });

  it("Tarkistettavat is the header's link with the count, not one of the tabs", () => {
    expect(NAV.map((e) => e.id)).not.toContain(REVIEW.id);
    expect(REVIEW).toEqual({ id: "review", label: "Tarkistettavat" });
  });
});
