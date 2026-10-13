/** Tulot ja menot has one two-way switch with both choices in sight, and an opened month list is a block of its own. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("view switch", () => {
  const parts = read("../src/components/TableToggle.tsx");
  it("is one segmented pair with Kaavio and Taulukko both drawn, the chosen one pressed", () => {
    expect(parts).toContain('className="segmented"');
    expect(parts).toMatch(/aria-pressed=\{!table\}[\s\S]*?\n\s*Kaavio/);
    expect(parts).toMatch(/aria-pressed=\{table\}[\s\S]*?\n\s*Taulukko/);
  });
  it("is the key of every part that has a table and of the bridge", () => {
    for (const f of ["pages/reports/sections/Cashflow.tsx", "pages/reports/sections/Balances.tsx", "pages/reports/sections/SpendingChange.tsx", "components/SurplusBridge.tsx"])
      expect(read(`../src/${f}`), f).toContain("<TableToggle ");
  });
});

describe("opened row of the month list", () => {
  it("puts its months on the panel ground, inset", () => {
    expect(read("../src/styles/reports.css")).toMatch(/details\[open\] > \.pivot-months \{[^}]*padding: 8px[^}]*background: var\(--surface-2\)/);
  });
});
