import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");

describe("Säästövinkit, Tapahtumat and Laskut: the lines left at 700 and 390 px", () => {
  it("keeps the facts of Tilanne in one row between a phone and the wide page", () => {
    expect(css("optimise.css")).toMatch(/min-width: 641px\) and \(max-width: 1039px\) \{ \.kv\.optimise-facts \{ grid-auto-flow: column/);
    expect(css("optimise.css")).not.toMatch(/max-width: 1039px\) \{ \.kv\.optimise-facts \{ grid-template-columns: repeat\(2/);
  });
  it("gives a finding's words the width its figure leaves and its unit the label step", () => {
    const c = css("optimise.css");
    expect(c).toMatch(/\.finding-top \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(c).toMatch(/\.finding-euros \.fig-unit \{ font-size: var\(--fs-label\); \}/);
  });
  it("lets a category select show its longest name from 640px and leaves no ghost frame on a phone", () => {
    const c = css("transactions.css");
    expect(c).toMatch(/min-width: 640px\) \{ \.tx-table td select, \.tx-table td \.select-lite \{ max-width: 14rem/);
    expect(c).toMatch(/\.tx-cat \.select-lite \{[^}]*border-color: transparent;[^}]*box-shadow: none;/);
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

