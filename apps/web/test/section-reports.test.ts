import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reportsOf, REPORT_SECTIONS } from "../src/pages/reports/registry.ts";
import type { ReportContext } from "../src/pages/reports/types.ts";

const DIR = new URL("../src/pages/reports/sections/", import.meta.url);
const strings = (list: string) => [...list.matchAll(/"(\w+)"/g)].map((m) => m[1]!);

describe("a page asks the server for the reports of its own sections", () => {
  it("a section reads no report it does not name, so what a page asks for is all its sections read", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(new URL(file, DIR), "utf8");
      const named = strings(/\breports: \[([^\]]*)\]/.exec(text)?.[1] ?? "");
      // `ctx.data.cashflow`, `(… : ctx.data).upcoming` and `const { buffer } = ctx.data`
      const read = [...text.matchAll(/\bdata\)?\.(\w+)/g)].map((m) => m[1]!);
      for (const m of text.matchAll(/const \{([^}]*)\} = ctx\.data(?![.\w])/g)) read.push(...m[1]!.split(",").map((x) => x.trim().split(":")[0]!.trim()));
      for (const id of read) expect(named, `${file} reads ${id}`).toContain(id);
    }
  });

  it("Yhteenveto asks for the spending change only", () => {
    expect(reportsOf("month")).toEqual(["spendingChange"]);
    expect(reportsOf("reports")).not.toContain("spendingChange");
  });

  it("Asetukset asks for the data quality notes only, and Raportit no longer shows them", () => {
    expect(reportsOf("settings")).toEqual(["dataQuality"]);
    expect(reportsOf("reports")).not.toContain("dataQuality");
    expect(REPORT_SECTIONS.filter((s) => s.page === "settings").map((s) => s.title)).toEqual(["Tietojen laatu"]);
  });

  it("Tietojen laatu says nothing while there is no account: Tilit already says what to add", () => {
    const quality = REPORT_SECTIONS.find((s) => s.id === "laatu")!;
    const ctx = (accounts: unknown[]) => ({ meta: { accounts } }) as unknown as ReportContext;
    expect(quality.visible?.(ctx([]))).toBe(false);
    expect(quality.visible?.(ctx([{ id: "a" }]))).toBe(true);
  });
});
