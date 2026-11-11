import { describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { fileLine, storeLine } from "../src/pages/settings/DataImport.tsx";

describe("fileLine", () => {
  it("names the export date before any count", () => {
    expect(fileLine({ version: 2, appVersion: "0.70.0", exportedAt: "2026-10-09T10:00:00.000Z" })).toBe("Omatalouden tietotiedosto, viety 9.10., versio 0.70.0");
  });
  it("says so when the file has no date", () => {
    expect(fileLine({ version: 2, appVersion: null, exportedAt: null })).toBe("Omatalouden tietotiedosto, viennin päiväystä ei ole");
  });
});

describe("storeLine", () => {
  it("says in Finnish that a row in another currency is not imported", () => {
    expect(storeLine({ key: "transactions", add: 2, exists: 0, skipped: [{ reason: "currency", n: 1 }] })).toContain("muu valuutta kuin euro");
  });
});
