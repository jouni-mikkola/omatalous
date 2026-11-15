import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");

describe("Tapahtumat and Laskut: the lines left at 700 and 390 px", () => {
  it("cuts a long category name in its chip and keeps the chip narrower on a phone", () => {
    const c = css("transactions.css");
    expect(c).toMatch(/\.tx-chip-label \{ overflow: hidden; text-overflow: ellipsis; \}/);
    // at most 12rem, and never wider than its row, so it does not run over the account mark beside it
    expect(c).toMatch(/\.tx-table td \.tx-chip \{ display: flex; width: fit-content; max-width: 100%;/);
  });
});

describe("Raportit: figures on one line, the list in two columns", () => {
  it("sets the figure of a key-figure cell at the foot of the cell", () => {
    expect(css("reports.css")).toMatch(/\.kv > div \{[^}]*display: flex; flex-direction: column; justify-content: space-between;/);
  });
});

