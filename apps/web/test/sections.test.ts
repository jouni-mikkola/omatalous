import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { REPORT_SECTIONS, visibleSections } from "../src/pages/reports/registry.ts";
import { section as cashflow } from "../src/pages/reports/sections/Cashflow.tsx";
import { section as drift } from "../src/pages/reports/sections/Drift.tsx";
import { section as fixedVariable } from "../src/pages/reports/sections/FixedVariable.tsx";
import { section as priceChanges } from "../src/pages/reports/sections/PriceChanges.tsx";
import { section as upcomingSection } from "../src/pages/reports/sections/Upcoming.tsx";
import type { ReportContext, ReportSection } from "../src/pages/reports/types.ts";

/** A context with only the parts a test reads: the sections look at nothing else. */
const context = (data: Record<string, unknown>, accounts: unknown[] = []): ReportContext => ({ data, meta: { today: "2026-10-11", accounts }, exportHref: () => "/export.csv" }) as unknown as ReportContext;
const html = (s: ReportSection, ctx: ReportContext) => renderToStaticMarkup(createElement(s.Component, { ctx }));

const totals = { incomeCents: 400_000, expenseCents: 250_000, consumptionCents: 250_000, debtCents: 0, savedCents: 50_000, borrowedCents: 0, netCents: 150_000, leftCents: 100_000, savingsRate: 0.125 };
const row = { month: "2026-08", ...totals, complete: true };
const cashflowData = (over: Record<string, unknown> = {}) => ({ cashflow: { rows: [row], totals, average: null, running: false, closed: null, ...over } });

describe("Raportit: Tulot ja menot", () => {
  it("has no tile row: the bar holds the figures, so Tulot, Säästöön and Yli jäi are printed once", () => {
    const out = html(cashflow, context(cashflowData()));
    expect(out).toContain("Tulojen käyttö");
    expect(out).not.toContain('class="kv"');
    expect(out).not.toContain("Säästöaste");
  });

  it("the chart has the table's Luotonnostot series when the period borrowed, and not otherwise", () => {
    const legend = /<i class="swatch" style="background:var\(--series-4\)"><\/i>Luotonnostot/;
    expect(html(cashflow, context(cashflowData()))).not.toMatch(legend);
    const borrowed = { ...totals, borrowedCents: 40_000, leftCents: 140_000 };
    expect(html(cashflow, context(cashflowData({ totals: borrowed, rows: [{ ...row, ...borrowed }] })))).toMatch(legend);
  });

  it("a running range with no complete month has no bar, so the totals stand in its place", () => {
    const out = html(cashflow, context(cashflowData({ running: true, closed: null })));
    expect(out).not.toContain("Tulojen käyttö");
    expect(out).toContain('class="kv"');
    expect(out).toContain("Menot");
  });
});

describe("Raportit: Kiinteät ja muuttuvat", () => {
  const rows = [{ month: "2026-08", fixedCents: 120_000, habitCents: 30_000, variableCents: 50_000, debtCents: 0 }];
  const fixedData = (t: { fixedCents: number; habitCents: number; variableCents: number; debtCents: number }, buffer: Record<string, unknown> = {}) => ({
    fixedVariable: { totals: t, rows },
    buffer: { fixedMonthlyCents: 130_000, fixedShare: 0.4, ...buffer },
  });
  const parts = { fixedCents: 120_000, habitCents: 30_000, variableCents: 50_000, debtCents: 0 };
  /** The figures of the card: label and value of each tile, in order. */
  const tiles = (out: string) => [...out.replace(/[  ]/g, " ").matchAll(/<div class="k">([^<]*)<\/div><div class="v">((?:<[^>]*>|[^<])*?)<\/div>/g)].map((m) => `${m[1]}: ${m[2]!.replace(/<[^>]*>/g, "")}`);

  it("hides a part the period has none of", () => {
    const out = html(fixedVariable, context(fixedData({ fixedCents: 120_000, habitCents: 30_000, variableCents: 50_000, debtCents: 0 })));
    expect(out).toContain("Kiinteät");
    expect(out).toContain("Satunnaiset");
    expect(out).not.toContain("Muu velanhoito");
  });

  it("starts with the fixed costs a month and their share of the income, and has no paragraph and no chart", () => {
    const out = html(fixedVariable, context(fixedData(parts)));
    expect(tiles(out).slice(0, 2)).toEqual(["Kiinteät menot kuukaudessa: 1 300 €", "Osuus tuloista: 40 %"]);
    expect(out).not.toMatch(/<p|<svg|legend|Asetukset/);
  });

  it("a share of the income that is not known is a dash, and nothing else is said", () => {
    const out = html(fixedVariable, context(fixedData(parts, { fixedShare: null, fixedMonthlyCents: 0 })));
    expect(tiles(out).slice(0, 2)).toEqual(["Kiinteät menot kuukaudessa: 0 €", "Osuus tuloista: –"]);
    expect(out).not.toContain("<p");
  });

  it("shows every part when each has some, with its share of the spending", () => {
    const out = html(fixedVariable, context(fixedData({ fixedCents: 100_000, habitCents: 30_000, variableCents: 50_000, debtCents: 20_000 })));
    expect(out).toContain("Muu velanhoito");
    expect(out).toMatch(/50\s%/);
    expect(out).toMatch(/10\s%/);
  });
});

describe("Raportit: Kiinteät ja muuttuvat, the shares of the spending", () => {
  const shareOf = (out: string, label: string) => tilesOf(out).find((t) => t.startsWith(`${label}:`))!.split("·")[1]!.trim();
  const tilesOf = (out: string) => [...out.replace(/[  ]/g, " ").matchAll(/<div class="k">([^<]*)<\/div><div class="v">((?:<[^>]*>|[^<])*?)<\/div>/g)].map((m) => `${m[1]}: ${m[2]!.replace(/<[^>]*>/g, "")}`);
  const data = (t: Record<string, number>) => ({ fixedVariable: { totals: t, rows: [] }, buffer: { fixedMonthlyCents: 130_000, fixedShare: 0.4 } });

  it("prints 48, 38 and 14 for parts of 47,6, 37,8 and 14,6 percent, which add up to 100 and not to 101", () => {
    const out = html(fixedVariable, context(data({ fixedCents: 47_600, habitCents: 37_800, variableCents: 14_600, debtCents: 0 })));
    expect([shareOf(out, "Kiinteät"), shareOf(out, "Arkiostot"), shareOf(out, "Satunnaiset")]).toEqual(["48 %", "38 %", "14 %"]);
  });

  it("prints 34, 33 and 33 for three equal thirds, the first row taking the extra unit", () => {
    const out = html(fixedVariable, context(data({ fixedCents: 10_000, habitCents: 10_000, variableCents: 10_000, debtCents: 0 })));
    expect([shareOf(out, "Kiinteät"), shareOf(out, "Arkiostot"), shareOf(out, "Satunnaiset")]).toEqual(["34 %", "33 %", "33 %"]);
  });
});

describe("Raportit: Nousseet menot", () => {
  it("is shown only when a category rose", () => {
    expect(drift.visible?.(context({ drift: { items: [] } }))).toBe(false);
    expect(drift.visible?.(context({ drift: { items: [{ category: "groceries" }] } }))).toBe(true);
  });
});

describe("the page of a section", () => {
  /** What every section needs to be visible: the page has them all. */
  const full = () =>
    context({
      balances: { accounts: [{}] },
      income: { enough: true },
      spendingChange: { views: [{}] },
      yearOverYear: { comparable: true },
      drift: { items: [{}] },
      upcoming: { yearlyCents: 56500, manual: [] },
      priceChanges: { items: [{}] },
      loans: { saved: 1 },
      dataQuality: { signals: [{}] },
      food: {},
    }, [{}]);
  const ids = (page: "month" | "bills" | "reports" | "optimise" | "settings") => visibleSections(full(), page).map((s) => s.id);

  it("every section names one, and each page shows the sections that name it: Menojen muutos on Yhteenveto, Laskut its two, Tekniset asetukset the data quality notes", () => {
    expect(REPORT_SECTIONS.length).toBeGreaterThan(10);
    expect(ids("month")).toEqual(["muutos"]);
    expect(ids("bills")).toEqual(["tulevat", "hinnat"]);
    expect(ids("settings")).toEqual(["laatu"]);
    expect(ids("reports")).toHaveLength(REPORT_SECTIONS.length - 4);
    for (const id of ["muutos", "tulevat", "hinnat", "laatu"]) expect(ids("reports")).not.toContain(id);
  });

  it("a page renders only its own sections", () => {
    expect(ids("optimise")).toEqual([]);
  });
});

describe("Laskut: Harvinaiset laskut and Hinnanmuutokset", () => {
  const upcoming = (over: Record<string, unknown> = {}) => ({
    upcoming: { from: "2026-10-11", to: "2027-01-11", items: [], totalCents: 0, reserveMonthlyCents: 4700, yearlyCents: 56500, months: [{ month: "2026-10", cents: 0, names: [] }], manual: [], ...over },
  });
  const typed = { id: "b1", name: "Ajoneuvovero", amountCents: 31250, dueDate: "2026-12-01", cadence: "yearly", category: null, nextDate: "2026-12-01", counted: true };

  it("Harvinaiset laskut is shown only when a rare bill is found or one is typed in", () => {
    expect(upcomingSection.visible?.(context(upcoming()))).toBe(true);
    expect(upcomingSection.visible?.(context(upcoming({ yearlyCents: 0, manual: [typed] })))).toBe(true);
    expect(upcomingSection.visible?.(context(upcoming({ yearlyCents: 0, manual: [] })))).toBe(false);
  });

  it("has the twelve months and the typed-in bills, and neither the list of three months nor the form: Tulossa has those", () => {
    const out = html(upcomingSection, context(upcoming({ manual: [typed] })));
    expect(out).toContain("Harvinaiset laskut");
    expect(out).toContain("Seuraavat 12 kuukautta");
    expect(out).toContain("Poista lasku Ajoneuvovero");
    expect(out).not.toContain("Seuraavat kolme kuukautta");
    expect(out).not.toContain('aria-label="Lisää lasku"');
  });

  /** The markup with the spaces of the money format made plain, so a test reads "47 €". */
  const flat = (out: string) => out.replace(/[  ]/g, " ");

  it("Harvinaiset laskut has the monthly figure in the datum of its heading and a table of Eräpäivä, Saaja and Summa, and no sentence", () => {
    const months = [
      { month: "2026-10", cents: 14_100, names: ["If", "Lähitapiola"], paid: [{ merchant: "If", date: "2026-10-05" }] },
      { month: "2026-11", cents: 0, names: [], paid: [] },
      { month: "2026-12", cents: 31_200, names: ["Ajoneuvovero"], paid: [] },
    ];
    const out = flat(html(upcomingSection, context(upcoming({ months }))));
    expect(out).toContain('<div class="card-datum"><span class="fig fig-s"><span class="fig-int">47</span><span class="fig-unit"> €/kk</span></span></div>');
    expect(out).toContain('<th scope="col" class="due-col">Eräpäivä</th><th scope="col">Saaja</th><th scope="col" class="st-num">Summa</th><th scope="col" class="paid-col"></th>');
    expect(out).toContain('<td class="due-col">lokakuu 2026</td><td>If, Lähitapiola<div class="sub paid-sub">Maksettu 5.10.</div></td><td class="st-num">141 €</td><td class="paid-col"><div>Maksettu 5.10.</div></td>');
    // a month with nothing due is no row; one with nothing paid has an empty fourth cell
    expect(out).not.toContain("marraskuu 2026");
    expect(out).toContain('<td class="due-col">joulukuu 2026</td><td>Ajoneuvovero</td><td class="st-num">312 €</td><td class="paid-col"></td>');
    expect(out).not.toContain("vuodessa eli");
    expect(out).not.toContain('class="lead"');
  });

  it("when two bills of a month are paid each paid day names its payee, and with nothing found there is no table and no figure", () => {
    const paid = [{ merchant: "If", date: "2026-10-05" }, { merchant: "Lähitapiola", date: "2026-10-09" }];
    const out = flat(html(upcomingSection, context(upcoming({ months: [{ month: "2026-10", cents: 20_000, names: ["If", "Lähitapiola"], paid }] }))));
    expect(out).toContain('<td class="paid-col"><div>Maksettu 5.10. (If)</div><div>Maksettu 9.10. (Lähitapiola)</div>');
    const typedOnly = flat(html(upcomingSection, context(upcoming({ yearlyCents: 0, manual: [typed] }))));
    expect(typedOnly).toContain("Poista lasku Ajoneuvovero");
    expect(typedOnly).not.toContain("<table");
    expect(typedOnly).not.toContain("/kk");
  });

  it("Hinnanmuutokset is a table of Saaja, Muuttunut, Aiempi hinta, Uusi hinta and Vuodessa that ends in Yhteensä, with the loans apart", () => {
    const change = { merchant: "ESIMERKKI OY", category: "subscriptions", date: "2026-09-03", fromCents: 1_099, toCents: 1_299, yearlyEffectCents: 2_400 };
    const loan = { merchant: "Esimerkkipankki", category: "loans", date: "2026-08-01", fromCents: 80_000, toCents: 75_000, yearlyEffectCents: -60_000 };
    const ctx = (items: unknown[]) => {
      const base = context({ priceChanges: { items, totalYearlyEffectCents: 2_400, debtYearlyEffectCents: -60_000 } });
      return { ...base, meta: { ...base.meta, categories: [{ id: "subscriptions", kind: "expense" }, { id: "loans", kind: "debt" }] } } as ReportContext;
    };
    const both = flat(html(priceChanges, ctx([change, loan])));
    const heads = [...both.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(["Saaja", "Muuttunut", "Aiempi hinta", "Uusi hinta", "Vuodessa", "Yhteensä", "Lainojen erät"]);
    expect(both).toContain('<td class="hide-phone">3.9.2026</td><td class="num">10,99 €</td><td class="num">12,99 €</td>');
    expect(both).toContain('<th scope="row">Yhteensä</th><td class="hide-phone"></td><td class="num"></td><td class="num"></td><td class="num">+24 €</td>');
    expect(both).toContain('<th scope="row">Lainojen erät</th><td class="hide-phone"></td><td class="num"></td><td class="num"></td><td class="num">−600 €</td>');
    // no sentence on the card, no line under the payee
    expect(both).not.toContain("vuodessa,");
    expect(both).not.toContain("card-sub");
    expect(both).not.toContain('class="sub"');
    // near miss: with no loan there is no row for loans, and with only a loan none for prices
    expect(flat(html(priceChanges, ctx([change])))).not.toContain("Lainojen erät");
    expect(flat(html(priceChanges, ctx([loan])))).not.toContain("Yhteensä");
  });

  it("Hinnanmuutokset brackets Vuodessa to Yhteensä when the printed euros add up, also for a price that fell, and not otherwise", () => {
    const up = { merchant: "ESIMERKKI OY", category: "subscriptions", date: "2026-09-03", fromCents: 1_099, toCents: 1_299, yearlyEffectCents: 2_400 };
    const up2 = { ...up, merchant: "TOINEN OY", yearlyEffectCents: 14_400 };
    const down = { ...up, merchant: "KOLMAS OY", yearlyEffectCents: -2_000 };
    const ctx = (items: unknown[], total: number) => {
      const base = context({ priceChanges: { items, totalYearlyEffectCents: total, debtYearlyEffectCents: 0 } });
      return { ...base, meta: { ...base.meta, categories: [{ id: "subscriptions", kind: "expense" }] } } as ReportContext;
    };
    const out = flat(html(priceChanges, ctx([up, up2], 16_800)));
    expect(out).toContain('<tbody class="adds-up"><tr class="part-first">');
    expect(out).toContain('<tr class="part-last">');
    expect(flat(html(priceChanges, ctx([up, up2, down], 14_800)))).toContain("adds-up");
    // near miss: a euro off, and a single row, draw nothing
    expect(flat(html(priceChanges, ctx([up, up2], 17_000)))).not.toContain("adds-up");
    expect(flat(html(priceChanges, ctx([up], 2_400)))).not.toContain("adds-up");
  });

  it("Hinnanmuutokset is shown only when a price changed", () => {
    expect(priceChanges.visible?.(context({ priceChanges: { items: [] } }))).toBe(false);
    expect(priceChanges.visible?.(context({ priceChanges: { items: [{}] } }))).toBe(true);
  });
});
