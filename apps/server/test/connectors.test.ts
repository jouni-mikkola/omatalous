import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONNECTORS } from "../src/connectors/registry.ts";

const DIR = new URL("../src/connectors/", import.meta.url);

describe("connector registry", () => {
  it("lists exactly the folders of connectors/, so a new connector cannot be forgotten", () => {
    const folders = readdirSync(DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const imported = [...readFileSync(new URL("registry.ts", DIR), "utf8").matchAll(/from "\.\/([^/"]+)\/index\.ts"/g)].map((m) => m[1]!).sort();
    expect(folders.length).toBeGreaterThan(0);
    expect(imported).toEqual(folders);
    expect(CONNECTORS).toHaveLength(folders.length);
  });

  it("keeps the ids that installed databases store, each once", () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // accounts.provider, connections.provider and transactions.source of existing installs
    expect(ids).toContain("enablebanking");
    expect(ids).toContain("csv");
  });

  it("gives a sync only to connectors that fetch by themselves", () => {
    const byId = (id: string) => CONNECTORS.find((c) => c.id === id);
    expect(byId("enablebanking")?.sync).toBeDefined();
    expect(byId("csv")?.sync).toBeUndefined();
  });
});
