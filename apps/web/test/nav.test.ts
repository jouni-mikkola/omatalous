import { describe, expect, it } from "vitest";
import { NAV, type NavEntry, visibleNav } from "../src/nav.ts";

const GATED: NavEntry[] = [{ id: "overview", label: "Yleiskatsaus" }, { id: "optimise", label: "Optimoi", feature: "optimise" }];

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

  it("the shipped nav has no gated entry yet, so every page shows before and after the flags load", () => {
    expect(NAV.filter((e) => e.feature)).toEqual([]);
    expect(visibleNav(undefined)).toEqual([...NAV]);
    expect(visibleNav({ optimise: false }).map((e) => e.id)).toEqual(["overview", "reports", "transactions", "recurring", "categories", "settings"]);
  });
});
