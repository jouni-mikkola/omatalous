import { describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { fileLine } from "../src/pages/settings/DataImport.tsx";

describe("fileLine", () => {
  it("names the export date before any count", () => {
    expect(fileLine({ version: 2, appVersion: "0.70.0", exportedAt: "2026-10-09T10:00:00.000Z" })).toBe("Omatalouden tietotiedosto, viety 9.10., versio 0.70.0");
  });
  it("says so when the file has no date", () => {
    expect(fileLine({ version: 2, appVersion: null, exportedAt: null })).toBe("Omatalouden tietotiedosto, viennin päiväystä ei ole");
  });
});
