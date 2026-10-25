import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

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
