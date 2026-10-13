/**
 * Reports on a middle width: the month labels never touch (the year of January is a second line), the readouts
 * keep a sum with its share in one cell, and the pivot is a list wherever its table would cut the total.
 */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hasYearLine, MonthLabel } from "../src/charts/Axes.tsx";

const css = readFileSync(new URL("../src/styles/reports.css", import.meta.url), "utf8");

describe("month label", () => {
  it("puts the year of January on a second line under the month", () => {
    const html = renderToStaticMarkup(h("svg", null, h(MonthLabel, { month: "2026-01", x: 10, base: 100, withYear: true })));
    expect(html).toMatch(/<tspan x="10">tammi<\/tspan><tspan x="10" dy="12">2026<\/tspan>/);
    expect(html).not.toContain("tammi 2026");
  });
  it("prints no year for another month or when the year is not asked", () => {
    expect(renderToStaticMarkup(h("svg", null, h(MonthLabel, { month: "2026-02", x: 1, base: 0, withYear: true })))).not.toContain("2026");
    expect(renderToStaticMarkup(h("svg", null, h(MonthLabel, { month: "2026-01", x: 1, base: 0, withYear: false })))).not.toContain("2026");
  });
  it("makes room for the second line only when a January is labelled", () => {
    expect(hasYearLine(["2025-12", "2026-01"], 1)).toBe(true);
    expect(hasYearLine(["2025-12", "2026-01"], 2)).toBe(false);
    expect(hasYearLine(["2026-02", "2026-03"], 1)).toBe(false);
  });
});

describe("reports.css", () => {
  it("keeps a readout cell at 184 px or more", () => {
    expect(css).toContain("minmax(max(184px, calc(20% - 1px)), 1fr)");
  });
  it("shows the pivot as a list up to 1039 px", () => {
    expect(css).toMatch(/@media \(max-width: 1039px\) \{\s*\.pivot-wide \{ display: none; \}/);
  });
});

describe("pivot list", () => {
  it("drops the page-wide summary arrow, which would take a grid cell of its own", () => {
    expect(css).toContain(".pivot-list li > details > summary::before { display: none; }");
  });
});
