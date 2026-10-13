import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { section as categories } from "../src/pages/reports/sections/Categories.tsx";
import { section as pivot } from "../src/pages/reports/sections/Pivot.tsx";
import type { ReportContext, ReportSection } from "../src/pages/reports/types.ts";

const html = (s: ReportSection, data: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(s.Component, { ctx: { data, meta: { today: "2026-10-11", accounts: [] }, range: { from: "2026-01-01", to: "2026-09-30" }, exportHref: () => "" } as unknown as ReportContext }));

const cat = (category: string, totalCents: number) => ({ category, label: category, totalCents, share: 0.5, monthlyAvgCents: null, previousCents: 0 });
const group = (name: string, totalCents: number) => ({ group: name, totalCents, share: 0.5, previousCents: 0, categories: [cat(name, totalCents)] });
const categoriesData = (groups: ReturnType<typeof group>[], totalCents: number) => ({ categories: { groups, totalCents, previousTotalCents: 0, comparable: false } });

describe("Raportit: the sum bracket of Kategoriat", () => {
  it("stands on the groups when they add up to Yhteensä, a refund among them included", () => {
    const out = html(categories, categoriesData([group("Asuminen", 100_000), group("Ruoka", 50_000), group("Muu", -2_000)], 148_000));
    expect(out).toContain('<tbody class="adds-up">');
    expect(out.match(/class="num sum"/g)).toHaveLength(3);
    expect(out).toContain("part-first");
    expect(out).toContain("part-last");
    expect(out).toContain("sum-pad");
  });

  it("is absent when the groups miss Yhteensä by one cent", () => {
    const out = html(categories, categoriesData([group("Asuminen", 100_000), group("Ruoka", 50_000)], 150_001));
    expect(out).not.toContain("adds-up");
    expect(out).not.toMatch(/class="num sum/);
  });
});

describe("Raportit: the sum bracket of Kuukausitaulukko", () => {
  const data = (rows: number[], totalCents: number) => ({
    pivot: {
      months: ["2026-08"],
      complete: [true],
      rows: rows.map((t, i) => ({ category: `c${i}`, label: `c${i}`, values: [t], totalCents: t, averageCents: t })),
      monthTotals: [totalCents],
      totalCents,
      averageCents: totalCents,
    },
  });

  it("stands on the column of row totals when the rows add up to the grand total", () => {
    const out = html(pivot, data([70_000, 30_000], 100_000));
    expect(out).toContain('<tbody class="adds-up">');
    expect(out.match(/class="num sum"/g)).toHaveLength(2);
  });

  it("is absent when the rows miss the grand total by one cent", () => {
    const out = html(pivot, data([70_000, 30_000], 100_001));
    expect(out).not.toContain("adds-up");
    expect(out).not.toMatch(/class="num sum/);
  });
});
