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

describe("report CSV by name", () => {
  const url = (report: string) => `/api/export/report.csv?${report}from=2026-01-01&to=2026-10-09`;

  it("answers the three known reports, and the month table when none is named", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const file = (r: { res: Response }) => r.res.headers.get("content-disposition");
    const absent = await admin.call("GET", url(""));
    const pivot = await admin.call("GET", url("report=pivot&"));
    expect(absent.status).toBe(200);
    expect(file(absent)).toBe('attachment; filename="kuukausitaulukko_2026-01-01_2026-10-09.csv"');
    expect(file(pivot)).toBe(file(absent));
    expect(pivot.body).toBe(absent.body);
    expect(pivot.body.startsWith("Kategoria;Ryhmä;")).toBe(true);
    const categories = await admin.call("GET", url("report=categories&"));
    expect(file(categories)).toBe('attachment; filename="kategoriat_2026-01-01_2026-10-09.csv"');
    expect(categories.body.startsWith("Ryhmä;Kategoria;")).toBe(true);
    const cashflow = await admin.call("GET", url("report=cashflow&"));
    expect(file(cashflow)).toBe('attachment; filename="kassavirta_2026-01-01_2026-10-09.csv"');
    expect(cashflow.body.startsWith("Kuukausi;Tulot €;")).toBe(true);
  });

  it("refuses an unknown report with 400 and no file", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    for (const report of ["report=months&", "report=&", "report=Pivot&", "report=categories%20&"]) {
      const r = await admin.call("GET", url(report));
      expect(r.status).toBe(400);
      expect(r.body.messageCode).toBe("check.report");
      expect(r.res.headers.get("content-disposition")).toBeNull();
      expect(r.res.headers.get("content-type")).toContain("json");
    }
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
    // 1.-9.10.2026: only the running month, so no category has a monthly average, lowest or highest month
    const running = rows((await admin.call("GET", "/api/export/report.csv?report=categories&from=2026-10-01&to=2026-10-09")).body);
    expect(running[0]!.slice(6, 9)).toEqual(["Keskimäärin kuussa €", "Pienin kuukausi €", "Suurin kuukausi €"]);
    expect(running[0]).not.toContain("Tavallisesti kuussa €");
    expect(running.length).toBeGreaterThan(1);
    for (const row of running.slice(1)) expect(row.slice(6, 9)).toEqual(["", "", ""]);
    const pivot = rows((await admin.call("GET", "/api/export/report.csv?report=pivot&from=2026-10-01&to=2026-10-09")).body);
    for (const row of pivot.slice(1, -1)) expect(row.at(-1)).toBe("");

    const month = rows((await admin.call("GET", "/api/export/report.csv?report=categories&from=2026-09-01&to=2026-09-30")).body);
    for (const row of month.slice(1)) expect(row.slice(6, 9).every((c) => c !== "")).toBe(true);
  });
});
