import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");

describe("Säästövinkit, Tapahtumat and Laskut: the lines left at 700 and 390 px", () => {
  it("gives an insight's words the width its figure leaves", () => {
    expect(css("optimise.css")).toMatch(/\.finding-top \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/);
  });
  it("cuts a long category name in its chip and keeps the chip narrower on a phone", () => {
    const c = css("transactions.css");
    expect(c).toMatch(/\.tx-chip-label \{ overflow: hidden; text-overflow: ellipsis; \}/);
    // at most 12rem, and never wider than its row, so it does not run over the account mark beside it
    expect(c).toMatch(/\.tx-cat \.tx-chip \{ max-width: min\(12rem, 100%\); min-width: 0; overflow: hidden; \}/);
  });
  it("balances a name in Sopimukset ja laskut so its last word is not left alone above a phone", () => {
    expect(css("bills.css")).toMatch(/min-width: 601px\) \{ \.series-table td:first-child \{ text-wrap: balance; \}/);
  });
});

describe("Raportit: figures on one line, the list in two columns", () => {
  it("sets the figure of a key-figure cell at the foot of the cell", () => {
    expect(css("reports.css")).toMatch(/\.kv > div \{[^}]*display: flex; flex-direction: column; justify-content: space-between;/);
  });
  it("puts the pivot list in two columns between a phone and the table, rows whole, the total across both", () => {
    const c = css("reports.css");
    expect(c).toMatch(/min-width: 641px\) and \(max-width: 1039px\) \{\s*\.pivot-narrow \{ columns: 2;/);
    expect(c).toMatch(/\.pivot-list > li \{ break-inside: avoid; \}/);
    expect(c).toMatch(/\.pivot-list > \.pivot-sum \{ column-span: all; \}/);
  });
});

