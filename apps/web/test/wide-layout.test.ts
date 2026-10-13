import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Section } from "../src/components/Section.tsx";
import { halfPanels } from "../src/pages/Optimise.tsx";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");
/** The text of the `@media` block that opens with `query`, braces balanced. */
const media = (sheet: string, query: string) => {
  const at = sheet.indexOf(`@media (${query})`);
  if (at < 0) return "";
  let depth = 0;
  for (let i = sheet.indexOf("{", at); i < sheet.length; i++) {
    if (sheet[i] === "{") depth++;
    if (sheet[i] === "}" && --depth === 0) return sheet.slice(at, i + 1);
  }
  return "";
};

describe("the wide screen: panels side by side from 1600 px", () => {
  it("stands a stack that holds a half on twelve columns, two halves six each, and only from 1600 px", () => {
    const base = css("base.css");
    const wide = media(base, "min-width: 1600px");
    expect(wide).toContain(".stack:has(> .half) { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr));");
    expect(wide).toMatch(/\.stack > \.half:is\(:has\(\+ \.half\), \.half \+ \.half\) \{ grid-column: span 6; \}/);
    // under 1600 px nothing changes: no other rule of the sheet names a half
    expect(base.replace(wide, "").replace(/\/\*[^]*?\*\//g, "")).not.toContain(".half");
  });

  it("makes the column 100 px: the container less its margins is twelve columns and eleven gutters", () => {
    const scale = css("scale.css");
    const container = Number(/@media \(min-width: 1600px\) \{ :root \{ --container: (\d+)px;/.exec(scale)?.[1]);
    const pad = 16;
    expect((container - 2 * pad - 11 * 16) / 12).toBe(100);
  });

  it("gives a panel the class half only when asked (a near miss: a panel of a page that is not a stack stays as it was)", () => {
    const html = (half?: boolean) => renderToStaticMarkup(createElement(Section, { id: "x", title: "T", half, children: null }));
    expect(html(true)).toContain('class="card half"');
    expect(html()).toContain('class="card"');
    expect(html(false)).not.toContain("half");
  });
});

describe("Säästövinkit: which panels of findings are halves", () => {
  it("pairs the area panels and Muut havainnot, and leaves the last of an odd count whole", () => {
    expect(halfPanels(1, true)).toEqual({ areas: 1, others: true });
    expect(halfPanels(2, true)).toEqual({ areas: 2, others: false });
    expect(halfPanels(3, false)).toEqual({ areas: 2, others: false });
    expect(halfPanels(2, false)).toEqual({ areas: 2, others: false });
  });

  it("makes no half of a panel that has no partner", () => {
    expect(halfPanels(1, false)).toEqual({ areas: 0, others: false });
    expect(halfPanels(0, true)).toEqual({ areas: 0, others: false });
    expect(halfPanels(0, false)).toEqual({ areas: 0, others: false });
  });
});

describe("Laskut: the two figures on top", () => {
  it("stand as two cells from 641 px, not from 1040 px", () => {
    const bills = css("bills.css");
    expect(media(bills, "min-width: 641px")).toContain(".bills-top .st-row + .st-row");
    expect(bills).not.toContain("min-width: 1040px");
  });
});
