import { FEATURES, type FeatureState } from "@banking/core";
import { describe, expect, it } from "vitest";
import { NAV, type NavEntry, SETTINGS, visibleNav } from "../src/nav.ts";

const GATED: NavEntry[] = [{ id: "overview", label: "Yhteenveto" }, { id: "optimise", label: "Säästövinkit", feature: "optimise" }];

describe("visibleNav", () => {
  it("hides the entry of a module while its flag is off", () => {
    expect(visibleNav({ optimise: false }, GATED).map((e) => e.id)).toEqual(["overview"]);
  });

  it("shows it when the flag is on, in the list's own order", () => {
    expect(visibleNav({ optimise: true }, GATED).map((e) => e.id)).toEqual(["overview", "optimise"]);
  });

  it("hides it until the flags have loaded, so a module never flashes into the nav", () => {
    expect(visibleNav(undefined, GATED).map((e) => e.id)).toEqual(["overview"]);
  });

  it("the shipped nav is Yhteenveto | Laskut | Tapahtumat | Raportit | Säästövinkit, with Säästövinkit last and left out while its flag is off or not loaded", () => {
    expect(NAV.filter((e) => e.feature).map((e) => [e.id, e.feature])).toEqual([["optimise", "optimise"]]);
    const off = ["overview", "bills", "transactions", "reports"];
    expect(visibleNav(undefined).map((e) => e.id)).toEqual(off);
    expect(visibleNav({ optimise: false }).map((e) => e.id)).toEqual(off);
    expect(visibleNav({ optimise: true }).map((e) => e.label)).toEqual(["Yhteenveto", "Laskut", "Tapahtumat", "Raportit", "Säästövinkit"]);
  });

  it("Asetukset is the link in the header, not a nav entry, and a page of its own that no flag hides", () => {
    expect(NAV.map((e) => e.id)).not.toContain("settings");
    expect(SETTINGS).toEqual({ id: "settings", label: "Asetukset" });
    expect(SETTINGS.feature).toBeUndefined();
  });

  it("shows Säästövinkit at the flags' defaults: it ships on, and an admin can switch it off", () => {
    const defaults = Object.fromEntries(Object.entries(FEATURES).map(([id, f]) => [id, f.default])) as FeatureState;
    expect(visibleNav(defaults).map((e) => e.id)).toContain("optimise");
  });

  it("names its pages Yhteenveto, Laskut and Säästövinkit; the ids of the old pages, and so their addresses, stay", () => {
    const label = (id: string) => NAV.find((e) => e.id === id)?.label;
    expect(label("overview")).toBe("Yhteenveto");
    expect(label("bills")).toBe("Laskut");
    expect(label("optimise")).toBe("Säästövinkit");
    expect(label("reports")).toBe("Raportit");
    expect(NAV.map((e) => e.label)).not.toContain("Toistuvat");
    expect(NAV.map((e) => e.label)).not.toContain("Yleiskatsaus");
    expect(NAV.map((e) => e.label)).not.toContain("Optimoi");
  });
});
