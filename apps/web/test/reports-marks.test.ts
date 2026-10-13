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

  it("is absent when the groups miss Yhteensä by a whole euro", () => {
    const out = html(categories, categoriesData([group("Asuminen", 100_000), group("Ruoka", 50_000)], 150_100));
    expect(out).not.toContain("adds-up");
    expect(out).not.toMatch(/class="num sum/);
  });
});

describe("Raportit: the sum bracket of Kategoriat, on the euros as printed", () => {
  it("is absent when the groups add up to the cent but not as printed", () => {
    // 0,40 + 0,40 + 0,40 = 1,20 prints 0 + 0 + 0 under 1
    const out = html(categories, categoriesData([group("Asuminen", 40), group("Ruoka", 40), group("Muu", 40)], 120));
    expect(out).not.toContain("adds-up");
  });

  it("stands when the groups miss the total by cents but the printed euros add up", () => {
    // 700,40 + 299,90 prints 700 + 300 under 1 000, though the total is 1 000,31
    const out = html(categories, categoriesData([group("Asuminen", 70_040), group("Ruoka", 29_990)], 100_031));
    expect(out).toContain('<tbody class="adds-up">');
  });
});

describe("Raportit: the shares of Kategoriat add up to the whole they are parts of", () => {
  const shareCells = (out: string) => [...out.matchAll(/<td class="num">(\d+[\s ]%|–)<\/td>/g)].map((m) => m[1]!.replace(/\s/g, " "));
  // a group of 474 € in two categories, and two more, in a spending of 1 000 €: 47,4 + 26,4 + 26,2 print 47 + 26 + 26 = 99 on their own
  const cats = (name: string, ...totals: number[]) => totals.map((t, i) => cat(`${name}${i}`, t));
  const grouped = (name: string, ...totals: number[]) => ({ ...group(name, totals.reduce((a, b) => a + b, 0)), categories: cats(name, ...totals) });

  it("rounds the groups together to 100 and the categories of a group to the share the group printed", () => {
    const out = html(categories, categoriesData([grouped("Asuminen", 30_000, 17_400), grouped("Ruoka", 26_400), grouped("Muu", 26_200)], 100_000));
    // the groups: 48, 26, 26 (the first of two equal lost fractions goes up), then the foot row; the categories of Asuminen: 30 and 18 = 48
    expect(shareCells(out)).toEqual(["48 %", "30 %", "18 %", "26 %", "26 %", "26 %", "26 %", "100 %"]);
  });

  it("keeps a dash for a group below zero and leaves it out of the rounding", () => {
    const out = html(categories, categoriesData([grouped("Asuminen", 66_700), grouped("Ruoka", 33_300), grouped("Muu", -2_000)], 98_000));
    expect(shareCells(out)).toEqual(["67 %", "67 %", "33 %", "33 %", "–", "–", "100 %"]);
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

  it("is absent when the rows add up to the cent but not as printed", () => {
    const out = html(pivot, data([40, 40, 40], 120));
    expect(out).not.toContain("adds-up");
  });

  it("is absent when the rows miss the grand total by a whole euro", () => {
    const out = html(pivot, data([70_000, 30_000], 100_100));
    expect(out).not.toContain("adds-up");
    expect(out).not.toMatch(/class="num sum/);
  });
});
