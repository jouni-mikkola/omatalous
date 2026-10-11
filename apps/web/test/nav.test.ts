import { FEATURES, type FeatureState } from "@banking/core";
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

  it("the shipped nav gates Optimoi on its flag: after Raportit when on, and left out while off or not loaded", () => {
    expect(NAV.filter((e) => e.feature).map((e) => [e.id, e.feature])).toEqual([["optimise", "optimise"]]);
    const off = ["overview", "reports", "transactions", "recurring", "categories", "settings"];
    expect(visibleNav(undefined).map((e) => e.id)).toEqual(off);
    expect(visibleNav({ optimise: false }).map((e) => e.id)).toEqual(off);
    expect(visibleNav({ optimise: true }).map((e) => e.id)).toEqual(["overview", "reports", "optimise", "transactions", "recurring", "categories", "settings"]);
  });

  it("shows Optimoi at the flags' defaults: it ships on, and an admin can switch it off", () => {
    const defaults = Object.fromEntries(Object.entries(FEATURES).map(([id, f]) => [id, f.default])) as FeatureState;
    expect(visibleNav(defaults).map((e) => e.id)).toContain("optimise");
  });
});
