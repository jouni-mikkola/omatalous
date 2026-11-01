import type { FeatureState } from "@banking/core";
import { describe, expect, it } from "vitest";
import { extensionPages, NAV, SETTINGS } from "../src/nav.ts";

describe("extensionPages", () => {
  const page = { label: "Esimerkki", component: () => null };
  const added = [{ id: "example", page }, { id: "card-only" }];

  it("lists an added module's page only while its flag is on, and none before the flags load", () => {
    const on = { example: true, "card-only": true } as unknown as FeatureState;
    expect(extensionPages(on, added).map((e) => e.id)).toEqual(["example"]);
    expect(extensionPages({} as FeatureState, added)).toEqual([]);
    expect(extensionPages(undefined, added)).toEqual([]);
  });

  it("the shared build adds none", () => {
    expect(extensionPages({} as FeatureState)).toEqual([]);
  });
});

describe("NAV", () => {
  it("is Yhteenveto | Laskut | Tapahtumat | Raportit | Säästövinkit: no entry hides behind a flag", () => {
    expect(NAV.map((e) => e.label)).toEqual(["Yhteenveto", "Laskut", "Tapahtumat", "Raportit", "Säästövinkit"]);
    expect(NAV.every((e) => !("feature" in e))).toBe(true);
  });

  it("Asetukset is the link in the header, not a nav entry, and a page of its own", () => {
    expect(NAV.map((e) => e.id)).not.toContain("settings");
    expect(SETTINGS).toEqual({ id: "settings", label: "Asetukset" });
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

describe("the phone's tab bar", () => {
  it("the tab bar has the four questions and Säästövinkit: five tabs, and no Lisää", () => {
    expect(NAV.filter((e) => e.tab).map((e) => e.label)).toEqual(["Yhteenveto", "Laskut", "Tapahtumat", "Raportit", "Säästövinkit"]);
  });
});
