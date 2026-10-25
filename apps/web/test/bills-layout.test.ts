import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { placeParts } from "../src/pages/Bills.tsx";
import { section } from "../src/pages/reports/sections/Upcoming.tsx";
import type { SectionProps } from "../src/pages/reports/types.ts";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");
const part = (order: number, span?: 5 | 6 | 7) => ({ order, span, node: null });
const shape = (placed: ReturnType<typeof placeParts>) => placed.map((p) => ("columns" in p ? "columns" : p.order));

describe("Laskut: half-width panels", () => {
  it("stand as two columns, the first panel on the left and the rest stacked on the right, in the page's order", () => {
    const placed = placeParts([part(10, 5), part(20, 7), part(40, 6), part(45, 6), part(50, 6), part(55, 6), part(60)]);
    expect(placed).toHaveLength(4);
    const cols = (placed[2] as { columns: { order: number }[][] }).columns;
    expect(cols.map((c) => c.map((p) => p.order))).toEqual([[40], [45, 50, 55]]);
    expect((placed[3] as { order: number }).order).toBe(60);
  });

  it("leaves a lone half-width panel as it was (a near miss: one panel has no second column to fill)", () => {
    expect(shape(placeParts([part(10, 5), part(40, 6), part(60)]))).toEqual([10, 40, 60]);
  });

  it("does not join two runs that a whole-width panel parts", () => {
    expect(shape(placeParts([part(40, 6), part(45, 6), part(60), part(70, 6)]))).toEqual(["columns", 60, 70]);
  });
});

describe("Laskut: Harvinaiset laskut on a phone", () => {
  const upcoming = {
    yearlyCents: 30_000,
    reserveMonthlyCents: 2_500,
    months: [{ month: "2026-10", cents: 30_000, names: ["If Vahinkovakuutus Oy"], paid: [{ merchant: "If Vahinkovakuutus Oy", date: "2026-10-05", cents: 30_000 }] }],
    manual: [],
  };
  const html = renderToStaticMarkup(createElement(section.Component, { ctx: { data: { upcoming } } } as unknown as SectionProps));

  it("says the state of a month in its own column, which a phone block shows as a labelled pair", () => {
    expect(html).toContain('<th scope="col">Maksettu</th>');
    expect(html).toContain('<td data-label="Maksettu"><div>Maksettu 5.10.</div></td>');
    expect(html).not.toContain("paid-sub");
  });

  it("keeps a month on one line", () => {
    expect(css("bills.css")).toMatch(/\.due-col \{ white-space: nowrap; \}/);
  });
});

describe("panels and folds (base.css)", () => {
  const base = css("base.css");

  it("takes the empty ruled body from a panel whose only child is its name strip", () => {
    expect(base).toMatch(/\.card > \.card-head:only-child[^{]*\{[^}]*margin-bottom: calc\(-1 \* var\(--pad\)\); border-bottom: 0;/);
  });

  it("opens a fold with a chevron and not the browser's triangle, and leaves the user menu its own", () => {
    expect(base).toContain("details:not(.user-menu) > summary { list-style: none;");
    expect(base).toContain("details:not(.user-menu) > summary::-webkit-details-marker { display: none; }");
    expect(base).toContain("details:not(.user-menu) > summary::before");
    expect(base).toContain("details[open]:not(.user-menu) > summary::before { transform: rotate(45deg); }");
  });
});
