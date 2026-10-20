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

  it("every section of Raportit names its tab, in the order of the tabs, and an old anchor's section stays on its tab", () => {
    const own = REPORT_SECTIONS.filter((s) => s.page === "reports");
    expect(own.filter((s) => !s.tab).map((s) => s.id)).toEqual([]);
    const tabOf = (id: string) => own.find((s) => s.id === id)?.tab;
    expect(tabOf("kuukaudet")).toBe("menot");
    expect(tabOf("kassavirta")).toBe("virta");
    expect(tabOf("lainat")).toBe("varat");
  });

  it("Asetukset asks for the data quality notes only, and Raportit no longer shows them", () => {
    expect(reportsOf("settings")).toEqual(["dataQuality"]);
    expect(reportsOf("reports")).not.toContain("dataQuality");
    expect(REPORT_SECTIONS.filter((s) => s.page === "settings").map((s) => s.title)).toEqual(["Tietojen laatu"]);
  });

  it("Tietojen laatu is a card only while the data has a note", () => {
    const quality = REPORT_SECTIONS.find((s) => s.id === "laatu")!;
    const ctx = (signals: unknown[], filed: unknown = null, accounts: unknown[] = []) => ({ data: { dataQuality: { signals, filed } }, meta: { accounts } }) as unknown as ReportContext;
    expect(quality.visible?.(ctx([]))).toBe(false);
    expect(quality.visible?.(ctx([{ id: "a" }]))).toBe(true);
    // the share filed without asking is the first lines of the card, so spending alone draws it
    expect(quality.visible?.(ctx([], { share: 0.9, guessShare: 0, userShare: 0, cents: 9, totalCents: 10 }))).toBe(true);
    // rows the last fetch could not read draw it too
    expect(quality.visible?.(ctx([], null, [{ name: "Käyttötili", refused: { status: 1 } }]))).toBe(true);
    expect(quality.visible?.(ctx([], null, [{ name: "Käyttötili", refused: null }]))).toBe(false);
  });
});
