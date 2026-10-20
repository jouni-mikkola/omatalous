import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { printedParts } from "@banking/core";
import { section as categories } from "../src/pages/reports/sections/Categories.tsx";
import { HeatTable } from "../src/components/reports/HeatTable.tsx";
import { section as pivot } from "../src/pages/reports/sections/Pivot.tsx";
import type { ReportContext, ReportSection } from "../src/pages/reports/types.ts";

const html = (s: ReportSection, data: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(s.Component, { ctx: { data, meta: { today: "2026-10-11", accounts: [] }, range: { from: "2026-01-01", to: "2026-09-30" }, exportHref: () => "" } as unknown as ReportContext }));

const cat = (category: string, totalCents: number, shareUnits: number | null = null) => ({ category, label: category, totalCents, share: 0.5, shareUnits, monthlyAvgCents: null, previousCents: 0, changeCents: null, prices: null });
const group = (name: string, totalCents: number, shareUnits: number | null = null) => ({ group: name, totalCents, share: 0.5, shareUnits, monthlyAvgCents: null, previousCents: 0, changeCents: null, categories: [cat(name, totalCents, shareUnits)] });
/** What core's categoryReport adds: the printed euros of the groups into Yhteensä and of each group's categories into theirs. */
const printed = (groups: ReturnType<typeof group>[], totalCents: number) => {
  const euros = printedParts(groups.map((g) => g.totalCents), totalCents);
  return groups.map((g, gi) => ({ ...g, printedCents: euros[gi]!, printedChangeCents: null, categories: printedParts(g.categories.map((c) => c.totalCents), g.totalCents, euros[gi]!).map((e, ci) => ({ ...g.categories[ci]!, printedCents: e!, printedChangeCents: null })) }));
};
const categoriesData = (groups: ReturnType<typeof group>[], totalCents: number) => ({ categories: { groups: printed(groups, totalCents), totalCents, previousTotalCents: 0, comparable: false }, cashflow: { unknownShare: 0 } });

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
  it("stands when the groups add up to the cent, their euros rounded together to the total's", () => {
    // 0,40 + 0,40 + 0,40 = 1,20: each on its own prints 0 under 1; rounded together (core printedParts) 1 + 0 + 0
    const out = html(categories, categoriesData([group("Asuminen", 40), group("Ruoka", 40), group("Muu", 40)], 120));
    expect(out).toContain('<tbody class="adds-up">');
    expect([...out.matchAll(/class="num sum"[^>]*>([^<]+)</g)].map((m) => m[1]!.replace(/\s/g, " "))).toEqual(["1 €", "0 €", "0 €"]);
  });

  it("stands when the groups miss the total by cents but the printed euros add up", () => {
    // 700,40 + 299,90 prints 700 + 300 under 1 000, though the total is 1 000,31
    const out = html(categories, categoriesData([group("Asuminen", 70_040), group("Ruoka", 29_990)], 100_031));
    expect(out).toContain('<tbody class="adds-up">');
  });
});

describe("Raportit: the shares of Kategoriat are core's", () => {
  const shareCells = (out: string) => [...out.matchAll(/<td class="num(?: rt-share)?">(\d+[\s ]%|–)<\/td>/g)].map((m) => m[1]!.replace(/\s/g, " "));

  it("prints each row's printed share as core rounded it (report-charts.test.ts holds the rounding), a dash for none", () => {
    const out = html(categories, categoriesData([group("Asuminen", 66_700, 67), group("Ruoka", 33_300, 33), group("Muu", -2_000, null)], 98_000));
    expect(shareCells(out)).toEqual(["67 %", "67 %", "33 %", "33 %", "–", "–", "100 %"]);
  });
});

describe("Raportit: the sum bracket of the table of every category by month", () => {
  const data = (rows: number[], totalCents: number) => ({
    pivot: {
      months: ["2026-08"],
      complete: [true],
      rows: rows.map((t, i) => ({ category: `c${i}`, label: `c${i}`, values: [t], totalCents: t, averageCents: t, heat: [0] })),
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
      rows: [{ category: "groceries", label: "Ruokakauppa", group: "Ruoka", values: [52_000], totalCents: 52_000, averageCents: 52_000, averageMonths: 1, heat: [0] }],
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

  it("is a heat map of the categories by month, each cell in core's bin, with the panel's switch and the CSV link", () => {
    const out = shown({ months: ["2026-07", "2026-08"], complete: [true, true], strip: [0, 1], rows: [{ category: "groceries", label: "Ruokakauppa", group: "Ruoka", values: [20_000, 52_000], totalCents: 72_000, averageCents: 36_000, averageMonths: 2, heat: [0, 4] }] });
    // the cells are drawn at the measured width, which a server render has not: the shades are core's `heat`
    expect(out).toContain("heat-grid");
    expect(out).toContain("Tavalliseen verrattuna:");
    expect(out).toContain('aria-pressed="true">Kaavio');
    expect(out).toContain("Lataa CSV");
    expect(out).toContain("Minä kuukautena jonkin kategorian menot nousivat selvästi?");
  });

  it("with no peak month says that the months are too few, and names no figure", () => {
    const out = shown();
    expect(out).toContain("Kuukausien vertailuun ei ole vielä tarpeeksi valmiita kuukausia.");
    expect(out).not.toContain("keskimäärin");
  });

  it("names the month a category jumped over its own usual month, both figures the server's", () => {
    const out = shown({ strip: [0], peak: 0, jump: { category: "groceries", label: "Ruokakauppa", month: 0, cents: 52_000, usualCents: 36_000 } });
    const text = out.replace(/[\u00a0\u202f]/g, " ");
    expect(text).toContain("Ruokakauppa: elokuussa 2026 meni <strong>520 €</strong>, tavallisesti 360 € kuussa.");
  });

  it("says so when no category jumped", () => {
    const out = shown({ strip: [0], peak: 0, jump: null });
    expect(out).toContain("Minkään kategorian menot eivät nousseet selvästi tavallista suuremmiksi.");
  });

  it("the table behind Taulukko keeps every figure the old one had", () => {
    const out = renderToStaticMarkup(createElement(HeatTable, { r: months().pivot as never }));
    expect(out).toContain("heat-table");
    for (const word of ["Kategoria", "Ruokakauppa", "520", "Keskimäärin kuussa", "pivot-list", "pivot-narrow"]) expect(out, word).toContain(word);
  });
});
