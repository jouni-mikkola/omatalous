import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { section as categories } from "../src/pages/reports/sections/Categories.tsx";
import { HeatTable } from "../src/components/reports/HeatTable.tsx";
import { section as pivot } from "../src/pages/reports/sections/Pivot.tsx";
import type { ReportContext, ReportSection } from "../src/pages/reports/types.ts";

const html = (s: ReportSection, data: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(s.Component, { ctx: { data, meta: { today: "2026-10-11", accounts: [] }, range: { from: "2026-01-01", to: "2026-09-30" }, exportHref: () => "" } as unknown as ReportContext }));

const cat = (category: string, totalCents: number) => ({ category, label: category, totalCents, share: 0.5, monthlyAvgCents: null, previousCents: 0 });
const group = (name: string, totalCents: number) => ({ group: name, totalCents, share: 0.5, previousCents: 0, categories: [cat(name, totalCents)] });
const categoriesData = (groups: ReturnType<typeof group>[], totalCents: number) => ({ categories: { groups, totalCents, previousTotalCents: 0, comparable: false }, cashflow: { unknownShare: 0 } });

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

describe("Raportit: the sum bracket of the table of every category by month", () => {
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

  /** The table behind Taulukko, drawn as it is. */
  const heat = (d: ReturnType<typeof data>) => renderToStaticMarkup(createElement(HeatTable, { r: d.pivot as never }));

  it("stands on the column of row totals when the rows add up to the grand total", () => {
    const out = heat(data([70_000, 30_000], 100_000));
    expect(out).toContain('<tbody class="adds-up">');
    expect(out.match(/class="num sum"/g)).toHaveLength(2);
  });

  it("is absent when the rows add up to the cent but not as printed", () => {
    const out = heat(data([40, 40, 40], 120));
    expect(out).not.toContain("adds-up");
  });

  it("is absent when the rows miss the grand total by a whole euro", () => {
    const out = heat(data([70_000, 30_000], 100_100));
    expect(out).not.toContain("adds-up");
    expect(out).not.toMatch(/class="num sum/);
  });
});

describe("Raportit: Menot kuukausittain", () => {
  const line = (id: string, label: string, v: number) => ({ id, label, category: id, values: [v], totalCents: v, usualCents: null, diffCents: null, payees: [{ name: "ESIMERKKI OY", values: [v], totalCents: v }], other: null });
  const theme = (id: string, label: string, v: number) => ({ id, label, values: [v], totalCents: v, usualCents: 40_000, diffCents: 12_000, lines: [line(id, label, v)] });
  const months = (extra: Record<string, unknown> = {}) => ({
    pivot: {
      months: ["2026-08"],
      complete: [true],
      rows: [{ category: "groceries", label: "Ruokakauppa", group: "Ruoka", values: [52_000], totalCents: 52_000, averageCents: 52_000 }],
      monthTotals: [52_000],
      totalCents: 52_000,
      averageCents: 52_000,
      themes: [theme("food", "Ruoka", 52_000)],
      rest: null,
      large: null,
      last: 0,
      strip: [],
      peak: null,
      peakRows: [],
      ...extra,
    },
  });
  const shown = (extra?: Record<string, unknown>) => html(pivot, months(extra));

  it("is the default view: the theme rows with the month, the usual level and the difference, and the CSV link", () => {
    const out = shown();
    expect(out).toContain("months-table");
    expect(out).not.toContain("heat-table");
    expect(out).toContain('aria-pressed="true">Kaavio');
    expect(out).toContain("Lataa CSV");
    expect(out.match(/<th scope="col" class="st-num">[^<]*</g)!.map((x) => x.replace(/<th[^>]*>|</g, ""))).toEqual(["Elokuu", "Tavallisesti", "Ero", "Yhteensä"]);
    expect(out).toContain("+120");
  });

  it("with no complete month has the total alone", () => {
    const out = shown({ last: null, complete: [false], themes: [{ ...theme("food", "Ruoka", 52_000), usualCents: null, diffCents: null }] });
    expect(out.match(/<th scope="col"/g)).toHaveLength(1);
    expect(out).not.toContain("Tavallisesti");
  });

  it("puts the card bills first when the report has them, and the rest and the large purchases after the themes", () => {
    const out = shown({ cardBills: [9_000], rest: { ...theme("rest", "x", 3_000), themes: [theme("pets", "Lemmikit", 3_000)] }, large: { values: [8_000], totalCents: 8_000, usualCents: null, diffCents: null, count: 2 } });
    const at = (s: string) => out.indexOf(s);
    expect(at("Luottokortin laskut")).toBeGreaterThan(-1);
    expect([at("Luottokortin laskut"), at("Ruoka"), at("Loput yhteensä"), at("Suuret hankinnat (2)")].every((x, i, xs) => i === 0 || x > xs[i - 1]!)).toBe(true);
    expect(shown()).not.toContain("Luottokortin laskut");
  });

  it("marks the highest month in the strip and links its largest rows to the rows of the month", () => {
    const out = shown({ strip: [0], peak: 0, peakRows: [{ key: "food/groceries", label: "Ruokakauppa", cents: 52_000, category: "groceries" }, { key: "large", label: "Suuret hankinnat", cents: 8_000, category: null }] });
    expect(out).toContain('class="is-peak"');
    expect(out).toContain('href="#/transactions?category=groceries&amp;from=2026-08-01&amp;to=2026-08-31"');
    expect(out).toContain("Suuret hankinnat");
    expect(out).not.toMatch(/<a [^>]*>Suuret hankinnat/);
  });

  it("the table behind Taulukko keeps every figure the old one had", () => {
    const out = renderToStaticMarkup(createElement(HeatTable, { r: months().pivot as never }));
    expect(out).toContain("heat-table");
    for (const word of ["Kategoria", "Ruokakauppa", "520", "Keskimäärin kuussa", "pivot-list", "pivot-narrow"]) expect(out, word).toContain(word);
  });
});
