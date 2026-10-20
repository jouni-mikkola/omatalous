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
const context = (data: Record<string, unknown>, accounts: unknown[] = []): ReportContext => ({ data, meta: { today: "2026-10-11", accounts }, range: { from: "2026-08-01", to: "2026-08-31" }, exportHref: () => "/export.csv" }) as unknown as ReportContext;
const html = (s: ReportSection, ctx: ReportContext) => renderToStaticMarkup(createElement(s.Component, { ctx }));

const totals = { incomeCents: 400_000, expenseCents: 250_000, consumptionCents: 250_000, debtCents: 0, savedCents: 50_000, borrowedCents: 0, netCents: 150_000, leftCents: 100_000, savingsRate: 0.125 };
const row = { month: "2026-08", ...totals, complete: true, stack: { inCents: 400_000, outCents: 300_000, gapCents: 100_000 } };
const cashflowData = (over: Record<string, unknown> = {}) => ({
  cashflow: {
    rows: [row], totals, settled: { ...totals, inCents: 400_000 }, average: null, running: false, closed: null, closedMonths: 0, usualRate: null,
    yearToDate: { year: 2026, current: Array(12).fill(null), previous: Array(12).fill(null), partialMonth: null, compared: null }, ...over,
  },
});
const plain = (out: string) => out.replace(/[\u00a0\u202f]/g, " ");

describe("Raportit: Tulot ja menot", () => {
  it("asks where the income went and answers with the period's flows, each a server total, and draws no tile row", () => {
    const out = plain(html(cashflow, context(cashflowData())));
    expect(out).toContain("Mihin tulot menivät 1 kuukaudessa?");
    expect(out).toContain("Tuloja tuli <strong>4 000 €</strong>. Kulutukseen meni 2 500 €, velanhoitoon 0 € ja säästöön 500 €. Yli jäi <strong>1 000 €</strong>.");
    expect(out).toContain("Yli jäi 1 000 €");
    expect(out).not.toContain('class="kv"');
  });

  it("has one Kaavio and Taulukko switch for the whole panel (critic 7)", () => {
    const out = html(cashflow, context(cashflowData()));
    expect(out.match(/aria-pressed="true">Kaavio/g)).toHaveLength(1);
  });

  it("the month table's total row is the settled months', named by their count, which core gives", () => {
    const out = plain(html(cashflow, context(cashflowData({ running: true, closedMonths: 1, settled: { ...totals, inCents: 400_000 }, rows: [row, { ...row, month: "2026-09" }, { ...row, month: "2026-10", complete: false }] }))));
    expect(out).toContain("Mihin tulot menivät 1 valmiissa kuukaudessa?");
    expect(out).toContain("<td>1 valmis kuukausi</td>");
  });

  it("a running range with no complete month has no settled figures, so the totals stand in their place", () => {
    const out = html(cashflow, context(cashflowData({ running: true, closed: null, settled: null })));
    expect(out).toContain("Jaksolla ei ole vielä valmista kuukautta.");
    expect(out).toContain('class="kv"');
  });

  it("a savings rate that never leaves its usual level is a sentence, and a band whose ends print the same says one figure", () => {
    const usualRate = { low: 0.11, mid: 0.11, high: 0.112, months: 12 };
    const rows = Array.from({ length: 4 }, (_, i) => ({ ...row, month: `2026-0${i + 5}`, savingsRate: 0.11 }));
    const out = plain(html(cashflow, context(cashflowData({ rows, usualRate }))));
    expect(out).toContain("Säästöön meni joka kuukausi tavallinen osuus tuloista, 11 % (12 kuukautta).");
    expect(out).not.toContain("11–11");
  });
});

describe("Raportit: Kiinteät ja muuttuvat", () => {
  const band = { month: "2026-08", fixedCents: 120_000, habitCents: 30_000, variableCents: 50_000, debtCents: 0, tops: [120_000, 150_000, 200_000, 200_000], fixedShare: 0.6, shares: [60, 15, 25, 0] };
  const fixedData = (buffer: Record<string, unknown> = {}) => ({
    fixedVariable: { totals: { ...band, spendingCents: 200_000 }, rows: [band] }, cashflow: { unknownShare: 0, rows: [{ month: "2026-08", complete: true }] },
    buffer: { fixedMonthlyCents: 130_000, fixedShare: 0.4, bufferMonths: 2.5, fixedShareLabel: "Kiinteät menot tavallisista tuloista, viimeiset 6 kuukautta", ...buffer },
  });

  it("heads the panel with the fixed costs a month and answers with the month's fixed share and the buffer, all server figures", () => {
    const out = plain(html(fixedVariable, context(fixedData())));
    expect(out).toContain("Kiinteät 1 300 € kuussa");
    expect(out).toContain("Elokuussa kiinteisiin menoihin meni <strong>60 %</strong> menoista.");
    expect(out).toContain("Kiinteät menot ovat nyt <strong>1 300 €</strong> kuussa, 40 % tavallisista tuloista.");
    expect(out).toContain("Tileillä olevat rahat riittävät 2,5 kuukauden tavallisiin menoihin.");
  });

  it("sets the newest month's fixed share against the first month the chart draws, in the shares the end labels show", () => {
    const before = { ...band, month: "2025-09", fixedShare: 0.517, shares: [52, 20, 28, 0] };
    const data = { ...fixedData(), fixedVariable: { totals: band, rows: [before, band] }, cashflow: { unknownShare: 0, rows: [{ month: "2025-09", complete: true }, { month: "2026-08", complete: true }] } };
    expect(plain(html(fixedVariable, context(data)))).toContain("Elokuussa kiinteisiin menoihin meni <strong>60 %</strong> menoista. Syyskuussa 2025 osuus oli 52 %.");
  });

  it("a share of the income that is not known and a buffer that is not known leave their sentences out", () => {
    const out = plain(html(fixedVariable, context(fixedData({ fixedShare: null, bufferMonths: null }))));
    expect(out).toContain("Kiinteät menot ovat nyt <strong>1 300 €</strong> kuussa.");
    expect(out).not.toContain("riittävät");
  });

  it("names in the legend only the layers that hold money: a layer of nothing is not drawn, so it is not named", () => {
    const out = html(fixedVariable, context(fixedData()));
    for (const l of ["Kiinteät", "Arkiostot", "Satunnaiset"]) expect(out).toContain(l);
    expect(out).not.toContain("Muu velanhoito");
    const withDebt = { ...band, debtCents: 10_000, tops: [120_000, 150_000, 200_000, 210_000] };
    expect(html(fixedVariable, context({ ...fixedData(), fixedVariable: { totals: { ...withDebt, spendingCents: 210_000, fixedShare: 0.57 }, rows: [withDebt] } }))).toContain("Muu velanhoito");
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
      categories: { comparable: true, groups: [{}] },
      days: { days: [{}] },
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
    // Yhteiset menot needs a joint account the user is weighted in, which the full answer does not have
    expect(ids("reports")).toHaveLength(REPORT_SECTIONS.length - 5);
    for (const id of ["muutos", "tulevat", "hinnat", "laatu", "yhteiset-menot"]) expect(ids("reports")).not.toContain(id);
  });

  it("Yhteiset menot shows only for a user who is weighted in a joint account", () => {
    const section = REPORT_SECTIONS.find((s) => s.id === "yhteiset-menot")!;
    const ctx = (users: { userId: string; weight: number }[]) => ({ meta: { user: { id: "u1" }, accounts: [{ use: { users } }] } }) as unknown as ReportContext;
    expect(section.visible?.(ctx([{ userId: "u1", weight: 50 }, { userId: "u2", weight: 50 }]))).toBe(true);
    // a near miss: she is named with no weight, or alone
    expect(section.visible?.(ctx([{ userId: "u1", weight: 0 }, { userId: "u2", weight: 100 }]))).toBe(false);
    expect(section.visible?.(ctx([{ userId: "u1", weight: 100 }]))).toBe(false);
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
    expect(out).toContain('<th scope="col">Eräpäivä</th><th scope="col">Saaja</th><th scope="col" class="num">Summa</th><th scope="col" class="hide-phone">Maksettu</th>');
    expect(out).toContain('<td class="due-col" data-label="Eräpäivä">lokakuu 2026</td><td data-label="Saaja">If, Lähitapiola<div class="sub paid-sub">Maksettu 5.10.</div></td><td class="num" data-rt="main">141 €</td><td class="hide-phone paid-col" data-label="Maksettu"><div>Maksettu 5.10.</div></td>');
    // a month with nothing due is no row; one with nothing paid has an empty fourth cell
    expect(out).not.toContain("marraskuu 2026");
    expect(out).toContain('<td class="due-col" data-label="Eräpäivä">joulukuu 2026</td><td data-label="Saaja">Ajoneuvovero</td><td class="num" data-rt="main">312 €</td><td class="hide-phone paid-col" data-label="Maksettu"></td>');
    expect(out).not.toContain("vuodessa eli");
    expect(out).not.toContain('class="lead"');
  });

  it("when two bills of a month are paid each paid day names its payee, and with nothing found there is no table and no figure", () => {
    const paid = [{ merchant: "If", date: "2026-10-05" }, { merchant: "Lähitapiola", date: "2026-10-09" }];
    const out = flat(html(upcomingSection, context(upcoming({ months: [{ month: "2026-10", cents: 20_000, names: ["If", "Lähitapiola"], paid }] }))));
    expect(out).toContain('<td class="hide-phone paid-col" data-label="Maksettu"><div>Maksettu 5.10. (If)</div><div>Maksettu 9.10. (Lähitapiola)</div>');
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
    const heads = [...both.matchAll(/<th[^>]*>(?:<button[^>]*>)?([^<]+)/g)].map((m) => m[1]);
    expect(heads).toEqual(["Saaja", "Muuttunut", "Aiempi hinta", "Uusi hinta", "Vuodessa", "Yhteensä", "Lainojen erät"]);
    expect(both).toContain("3.9.2026</td>");
    expect(both).toMatch(/10,99\s€<\/td><td[^>]*>12,99\s€<\/td>/);
    expect(both).toMatch(/<th scope="row">Yhteensä<\/th>(<td[^>]*><\/td>){3}<td[^>]*>\+24\s€<\/td>/);
    expect(both).toMatch(/<th scope="row">Lainojen erät<\/th>(<td[^>]*><\/td>){3}<td[^>]*>−600\s€<\/td>/);
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
