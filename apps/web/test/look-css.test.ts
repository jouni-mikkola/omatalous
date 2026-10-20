import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("Kauppiaat between the phone list and the full table", () => {
  it("hides the columns after Yhteensä from 601 to 960 px and narrows the category select", () => {
    expect(css("categories.css")).toMatch(
      /@media \(min-width: 601px\) and \(max-width: 960px\) \{\s*\.merchant-table :is\(th, td\):nth-child\(n\+5\) \{ display: none; \}\s*\.merchant-table td select, \.merchant-table td \.select-lite \{ max-width: 11rem; \}/,
    );
  });
});

describe("Ilmoitukset", () => {
  it("wraps the detail under 1040 px instead of cutting it", () => {
    expect(css("notices.css")).toMatch(/@media \(max-width: 1039px\) \{\s*\.notice-item \.notice-text \{[^}]*white-space: normal;/);
  });
});

describe("the share track of Asuminen", () => {
  it("outranks the bracket's cap size on a middle row (td.share.sum), so the track is not clipped to 4 px", () => {
    const housing = css("housing.css");
    expect(housing).toMatch(/\.housing-charges \.adds-up > tr > td\.share\.sum \{ --track:/);
    expect(housing).not.toMatch(/\.adds-up > tr > td\.share \{/);
  });
});
