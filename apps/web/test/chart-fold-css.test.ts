import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const css = readFileSync(new URL("../src/styles/table.css", import.meta.url), "utf8");

describe("the fold under a chart", () => {
  it("hides its row count while it is open, since the table shows the rows", () => {
    const open = rules(css).find((r) => r.selector === ".chart-fold[open] .chart-fold-count");
    expect(open?.body).toMatch(/display: none;/);
  });
});
