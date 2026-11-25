import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the line of the notices on Yhteenveto", () => {
  it("wraps on a narrow screen instead of cutting the text", () => {
    expect(css("notices.css")).not.toMatch(/nowrap|text-overflow|overflow: hidden/);
  });
});
