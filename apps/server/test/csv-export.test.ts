import { describe, expect, it } from "vitest";
import { csv } from "../src/routes/shared.ts";
import { setupApp } from "./helpers.ts";

describe("csv()", () => {
  it("writes Excel-friendly Finnish CSV", () => {
    const out = csv([["Nimi", "Summa"], ["Kahvila; Oy", 12.5], ['Sanoi "moi"', null]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain('"Kahvila; Oy";12,5');
    expect(out).toContain('"Sanoi ""moi""";');
  });

  it("neutralises spreadsheet formulas in text cells", () => {
    expect(csv([["=HYPERLINK(\"x\")", "+1", "-2", "@cmd"]])).toContain("'=HYPERLINK");
    expect(csv([["+1"]])).toContain("'+1");
    expect(csv([[-2]])).toContain("-2"); // numbers stay numbers
  });
});

describe("report CSV without a complete month", () => {
  const rows = (body: string) =>
    body
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(";"));

  it("writes empty cells for the averages of the running month, and numbers once a month is complete", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    // 1.-9.10.2026: only the running month, so no category has a monthly average, median, lowest or highest month
    const running = rows((await admin.call("GET", "/api/export/report.csv?report=categories&from=2026-10-01&to=2026-10-09")).body);
    expect(running[0]!.slice(6, 10)).toEqual(["Keskimäärin kuussa €", "Tavallisesti kuussa €", "Pienin kuukausi €", "Suurin kuukausi €"]);
    expect(running.length).toBeGreaterThan(1);
    for (const row of running.slice(1)) expect(row.slice(6, 10)).toEqual(["", "", "", ""]);
    const pivot = rows((await admin.call("GET", "/api/export/report.csv?report=pivot&from=2026-10-01&to=2026-10-09")).body);
    for (const row of pivot.slice(1, -1)) expect(row.at(-1)).toBe("");

    const month = rows((await admin.call("GET", "/api/export/report.csv?report=categories&from=2026-09-01&to=2026-09-30")).body);
    for (const row of month.slice(1)) expect(row.slice(6, 10).every((c) => c !== "")).toBe(true);
  });
});
