import { describe, expect, it } from "vitest";
import { NAV, REVIEW, ROWS, SETTINGS } from "../src/nav.ts";

describe("NAV", () => {
  it("is Nyt | Kuukausi | Tulossa | Tarkistettavat: no entry hides behind a flag", () => {
    expect(NAV.map((e) => e.label)).toEqual(["Nyt", "Kuukausi", "Tulossa", "Tarkistettavat"]);
    expect(NAV.every((e) => !("feature" in e))).toBe(true);
  });

  it("Asetukset is the link in the header, not a nav entry, and a page of its own", () => {
    expect(NAV.map((e) => e.id)).not.toContain("settings");
    expect(SETTINGS).toEqual({ id: "settings", label: "Asetukset" });
  });

  it("names its tabs Nyt, Kuukausi and Tulossa, the pages behind them keep their titles; the ids of the old pages, and so their addresses, stay", () => {
    const label = (id: string) => NAV.find((e) => e.id === id)?.label;
    expect(label("overview")).toBe("Nyt");
    expect(label("bills")).toBe("Tulossa");
    expect(NAV.map((e) => e.title)).toEqual(["Yhteenveto", undefined, "Laskut", undefined]);
    expect(label("optimise")).toBeUndefined();
    expect(label("reports")).toBe("Kuukausi");
    expect(NAV.map((e) => e.label)).not.toContain("Toistuvat");
    expect(NAV.map((e) => e.label)).not.toContain("Yleiskatsaus");
    expect(NAV.map((e) => e.label)).not.toContain("Optimoi");
  });
});

describe("the phone's tab bar", () => {
  it("the tab bar has four tabs, Tarkistettavat the fourth, and no Lisää; the rows list keeps its address with no tab", () => {
    expect(NAV).toHaveLength(4);
    expect(NAV[3]).toBe(REVIEW);
    expect(NAV.map((e) => e.id)).not.toContain(ROWS.id);
    expect(ROWS).toEqual({ id: "transactions", label: "Tapahtumat" });
  });
});
