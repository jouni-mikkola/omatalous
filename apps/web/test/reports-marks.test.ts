import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { section as spendingTable } from "../src/pages/reports/sections/SpendingTable.tsx";
import { HeatTable } from "../src/components/reports/HeatTable.tsx";
import { section as pivot } from "../src/pages/reports/sections/Pivot.tsx";
import type { ReportContext, ReportSection } from "../src/pages/reports/types.ts";

const html = (s: ReportSection, data: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(s.Component, { ctx: { data, meta: { today: "2026-10-11", accounts: [] }, range: { from: "2026-01-01", to: "2026-09-30" }, exportHref: () => "" } as unknown as ReportContext }));

const row = (category: string, totalCents: number) => ({ key: `x/${category}`, category, label: category, group: "Ryhmä", totalCents, fixedCents: 0, variableCents: totalCents, oneOffCents: 0, previous: null, yearAgo: null, yearCents: totalCents, count: 1 });
const tableData = (rows: ReturnType<typeof row>[]) => {
  const totalCents = rows.reduce((s, x) => s + x.totalCents, 0);
  return { spendingTable: { span: { from: "2026-01-01", to: "2026-09-30" }, totalCents, fixedCents: 0, variableCents: totalCents, oneOffCents: 0, periods: { previous: null, yearAgo: null }, totals: { previous: null, yearAgo: null }, year: { from: "2025-10-01", to: "2026-09-30", months: 12, totalCents }, rows, oneOffs: [] }, conclusions: { menot: null } };
};

describe("Raportit: Kategoriat", () => {
  it("brackets the rows that add up to Yhteensä, and names the twelve months", () => {
    const out = html(spendingTable, tableData([row("a", 100_000), row("b", 50_000), row("c", -2_000)]));
    expect(out).toContain('<tbody class="adds-up">');
    expect(out.replace(/\s+/g, " ")).toContain("12 kuukautta ajalta 1.10.2025–30.9.2026");
    expect(out).not.toContain("kertaostoja");
  });

  it("draws a share of nothing as a dash, not 0,00 €", () => {
    const out = html(spendingTable, tableData([row("a", 100_000)]));
    const body = out.slice(out.indexOf("<tbody"), out.indexOf("</tbody>"));
    expect(body).toContain('<span class="muted">–</span>');
    expect(body).not.toMatch(/>0,00\s*€</);
  });

  it("leaves the twelve month column out when the range is those twelve months", () => {
    const data = tableData([row("a", 100_000)]);
    data.spendingTable.span = { from: "2025-10-01", to: "2026-09-30" };
    const out = html(spendingTable, data).replace(/\s+/g, " ");
    expect(out).not.toContain("12 kuukautta");
    expect(out).toContain("Yhteensä");
  });

  it("leaves it out too when the running month stands in for the oldest of the twelve", () => {
    const data = tableData([row("a", 100_000)]);
    data.spendingTable.span = { from: "2025-11-01", to: "2026-10-11" };
    expect(html(spendingTable, data)).not.toContain("12 kuukautta");
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

  /** The table under the chart, drawn as it is. */
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
  const line = (id: string, label: string, v: number) => ({ id, label, category: id, values: [v], totalCents: v, expectedCents: null, diffCents: null, payees: [{ name: "ESIMERKKI OY", values: [v], totalCents: v }], other: null });
  const theme = (id: string, label: string, v: number) => ({ id, label, values: [v], totalCents: v, expectedCents: 40_000, diffCents: 12_000, lines: [line(id, label, v)] });
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

  it("is a heat table of the categories by month, each cell in core's bin, with no CSV link for a short list", () => {
    const out = shown({ months: ["2026-07", "2026-08"], complete: [true, true], strip: [0, 1], rows: [{ category: "groceries", label: "Ruokakauppa", group: "Ruoka", values: [20_000, 52_000], totalCents: 72_000, averageCents: 36_000, averageMonths: 2, heat: [0, 4] }] });
    // the shades of the cells are core's `heat`
    expect(out).toContain("heat-l4");
    expect(out).not.toContain("heat-grid");
    expect(out).toContain("heat-table");
    expect(out).not.toContain("Lataa taulukko (CSV)");
  });

  it("offers the CSV link only for a list of more than ten categories", () => {
    const row = (i: number) => ({ category: "groceries", label: `Luokka ${i}`, group: "Ruoka", values: [20_000, 52_000], totalCents: 72_000, averageCents: 36_000, averageMonths: 2, heat: [0, 4] });
    const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));
    const base = { months: ["2026-07", "2026-08"], complete: [true, true], strip: [0, 1] };
    expect(shown({ ...base, rows: rows(10) })).not.toContain("Lataa taulukko (CSV)");
    expect(shown({ ...base, rows: rows(11) })).toContain("Lataa taulukko (CSV)");
  });

  it("with no peak month says that the months are too few, and names no figure", () => {
    const out = shown();
    expect(out).toContain("Kuukausien vertailuun ei ole vielä tarpeeksi päättyneitä kuukausia.");
    expect(out).not.toContain("keskimäärin");
  });

  it("names the month a category jumped over its own expected month, both figures the server's", () => {
    const out = shown({ strip: [0], peak: 0, jump: { category: "groceries", label: "Ruokakauppa", month: 0, cents: 52_000, expectedCents: 36_000 } });
    const text = out.replace(/[\u00a0\u202f]/g, " ");
    expect(text).toContain("Ruokakauppa: elokuussa 2026 meni <strong>520 €</strong>, tavallisesti menee 360 €.");
  });

  it("says so when no category jumped", () => {
    const out = shown({ strip: [0], peak: 0, jump: null });
    expect(out).toContain("Minkään kategorian menot eivät nousseet selvästi tavallista suuremmiksi.");
  });

  it("the table under the chart keeps every figure the old one had", () => {
    const out = renderToStaticMarkup(createElement(HeatTable, { r: months().pivot as never }));
    expect(out).toContain("heat-table");
    for (const word of ["Kategoria", "Ruokakauppa", "520", "Keskimäärin kuussa", "rt-fold"]) expect(out, word).toContain(word);
  });
});
