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

describe("table of Tulot ja menot on a phone", () => {
  const phone = css.slice(css.lastIndexOf("/* the month is told once"));
  it("keeps the month in sight on the panel's ground, with an edge, and narrows the cells' sides", () => {
    expect(phone).toMatch(/#kassavirta \.table-wrap :is\(th, td\) \{ padding-inline: 4px; \}/);
    expect(phone).toMatch(/:is\(th, td\):first-child \{ position: sticky; left: 0; background: var\(--surface\); box-shadow: 1px 0 0 var\(--axis\); \}/);
  });
  it("prints the month long above the phone block and short under it, on one line", () => {
    const src = readFileSync(new URL("../src/pages/reports/sections/Cashflow.tsx", import.meta.url), "utf8");
    expect(src).toContain("monthLong(x.month)");
    expect(src).toContain("monthLabel(x.month, true)");
    expect(css).toContain(".month-name { white-space: nowrap; }");
    expect(css).toContain(".month-short { display: none; }");
    expect(phone).toContain("#kassavirta .month-long { display: none; }");
    expect(phone).toContain("#kassavirta .month-short { display: inline; }");
    expect(css.indexOf(".month-short { display: none; }")).toBeLessThan(css.indexOf("#kassavirta .month-short { display: inline; }"));
  });
});

describe("pivot list", () => {
  it("opens with the chevron of a fold, turned when open, and tells the open row by its bold name", () => {
    expect(css).not.toContain("clip-path");
    expect(css).toMatch(/\.pivot-name::before \{[^}]*border-right: 1\.5px solid[^}]*rotate\(-45deg\)/);
    expect(css).toMatch(/details\[open\] summary \.pivot-name::before \{ transform: rotate\(45deg\)/);
    expect(css).toContain("details[open] summary .pivot-name { font-weight: 600; }");
  });
  it("drops the page-wide summary arrow, which would take a grid cell of its own", () => {
    expect(css).toContain(".pivot-list li > details > summary::before { display: none; }");
  });
});
