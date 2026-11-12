import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@banking/core";
import { REPORT_PAGES, reportsOfPage, REPORT_SECTIONS } from "../src/pages/reports/registry.ts";

const DIR = new URL("../src/pages/reports/sections/", import.meta.url);
const strings = (list: string) => [...list.matchAll(/"(\w+)"/g)].map((m) => m[1]!);

describe("a page asks the server for the reports of its own sections", () => {
  it("a section reads no report it does not name, so what a page asks for is all its sections read", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBe(11);
    for (const file of files) {
      const text = readFileSync(new URL(file, DIR), "utf8");
      const named = strings(/\breports: \[([^\]]*)\]/.exec(text)?.[1] ?? "");
      // `ctx.data.cashflow`, `(… : ctx.data).upcoming` and `const { buffer } = ctx.data`
      const read = [...text.matchAll(/\bdata\)?\.(\w+)/g)].map((m) => m[1]!);
      for (const m of text.matchAll(/const \{([^}]*)\} = ctx\.data(?![.\w])/g)) read.push(...m[1]!.split(",").map((x) => x.trim().split(":")[0]!.trim()));
      for (const id of read) expect(named, `${file} reads ${id}`).toContain(id);
    }
  });

  it("every section of Raportit is on exactly one question page, and a page asks for the reports of its sections only", () => {
    const own = REPORT_SECTIONS.filter((s) => s.page === "reports").map((s) => s.id);
    const placed = REPORT_PAGES.flatMap((p) => p.sections.map((s) => s.id));
    expect([...placed].sort()).toEqual([...own].sort());
    expect(new Set(placed).size).toBe(placed.length);
    for (const p of REPORT_PAGES) expect(reportsOfPage(p), p.id).toEqual([...new Set(p.sections.flatMap((x) => x.reports))]);
  });

  it("the question pages are the list of core, one file each, and an old anchor's section is on the page its tab became", () => {
    expect(REPORT_PAGES.map((p) => p.id)).toEqual([...QUESTIONS]);
    const pageOf = (id: string) => REPORT_PAGES.find((p) => p.sections.some((s) => s.id === id))?.id;
    expect(pageOf("vuodet")).toBe("menot");
    expect(pageOf("verovuosi")).toBe("tulot");
    expect(pageOf("lainat")).toBe("velat");
    expect(pageOf("kiinteat-menot")).toBe("kiinteat");
  });
});
