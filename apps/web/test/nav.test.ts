import { describe, expect, it } from "vitest";
import { NAV, REVIEW, SETTINGS } from "../src/nav.ts";

describe("NAV", () => {
  it("is Yhteenveto | Laskut | Tapahtumat | Raportit: no entry hides behind a flag", () => {
    expect(NAV.map((e) => e.label)).toEqual(["Yhteenveto", "Laskut", "Tapahtumat", "Raportit"]);
    expect(NAV.every((e) => !("feature" in e))).toBe(true);
  });

  it("keeps the addresses of the pages", () => {
    expect(NAV.map((e) => e.id)).toEqual(["overview", "bills", "transactions", "reports"]);
  });

  it("Asetukset is in the user menu, not a nav entry, and a page of its own", () => {
    expect(NAV.map((e) => e.id)).not.toContain("settings");
    expect(SETTINGS).toEqual({ id: "settings", label: "Asetukset" });
  });

  it("Tarkistettavat is the header's link with the count, not one of the tabs", () => {
    expect(NAV.map((e) => e.id)).not.toContain(REVIEW.id);
    expect(REVIEW).toEqual({ id: "review", label: "Tarkistettavat" });
  });
});
