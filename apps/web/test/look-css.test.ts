import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the line of the notices on Yhteenveto", () => {
  it("wraps on a narrow screen instead of cutting the text", () => {
    expect(css("notices.css")).not.toMatch(/nowrap|text-overflow|overflow: hidden/);
  });
});

describe("the share track of Asuminen", () => {
  it("outranks the bracket's cap size on a middle row (td.share.sum), so the track is not clipped to 4 px", () => {
    const housing = css("housing.css");
    expect(housing).toMatch(/\.housing-charges \.adds-up > tr > td\.share\.sum \{ --track:/);
    expect(housing).not.toMatch(/\.adds-up > tr > td\.share \{/);
  });
});
