/**
 * The shared files an add-on module may import (module-host.ts `MODULES`) are a public contract: an installed add-on
 * names them. Each contracts/<version>/module-host.json freezes the keys and export names of one `apiVersion`. A later
 * host may add keys and exports, and keeps every frozen one until it announces a higher `apiVersion`.
 */
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOST_API_VERSION, MODULES } from "../src/module-host.ts";

const CONTRACTS = fileURLToPath(new URL("../../../contracts/", import.meta.url));

interface Frozen {
  apiVersion: number;
  modules: Record<string, string[]>;
}

const frozen = readdirSync(CONTRACTS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .flatMap((e) => {
    try {
      return [{ version: e.name, ...(JSON.parse(readFileSync(`${CONTRACTS}${e.name}/module-host.json`, "utf8")) as Frozen) }];
    } catch {
      return [];
    }
  });

describe("contracts: module host", () => {
  it("has a frozen surface for 1.5.0", () => {
    expect(frozen.map((f) => f.version)).toContain("1.5.0");
  });

  it("keeps components/Why with the three names add-ons 1.1.x import", () => {
    expect(Object.keys(MODULES["components/Why"] as object).sort()).toEqual(["BasisDoor", "Estimate", "approxText"]);
  });

  it("draws the children of BasisDoor with no toggle, and its text without them", () => {
    const { BasisDoor } = MODULES["components/Why"] as typeof import("../src/components/Why.tsx");
    const door = { text: "12,40 €", open: false, onToggle: () => {}, controls: "panel" };
    const { container, rerender } = render(createElement(BasisDoor, door, createElement("b", null, "Summa")));
    expect(screen.getByText("Summa")).toBeTruthy();
    expect(container.querySelector("button")).toBeNull();
    rerender(createElement(BasisDoor, door));
    expect(screen.getByText("12,40 €")).toBeTruthy();
  });

  for (const f of frozen) {
    it(`${f.version}: every key and export of apiVersion ${f.apiVersion} stays, or the apiVersion is raised`, () => {
      if (f.apiVersion < HOST_API_VERSION) return;
      expect(f.apiVersion).toBe(HOST_API_VERSION);
      const live = Object.fromEntries(Object.entries(MODULES).map(([key, mod]) => [key, Object.keys(mod as object)]));
      const missingKeys = Object.keys(f.modules).filter((key) => !(key in live));
      expect(missingKeys, "keys removed without a new apiVersion").toEqual([]);
      const missingExports = Object.entries(f.modules).flatMap(([key, names]) => names.filter((n) => !live[key]!.includes(n)).map((n) => `${key}: ${n}`));
      expect(missingExports, "exports removed without a new apiVersion").toEqual([]);
    });
  }
});
