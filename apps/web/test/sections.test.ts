import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { REPORT_SECTIONS, visibleSections } from "../src/pages/reports/registry.ts";
import { section as cashflow } from "../src/pages/reports/sections/Cashflow.tsx";
import { section as drift } from "../src/pages/reports/sections/Drift.tsx";
import { section as borrowed } from "../src/pages/reports/sections/Borrowed.tsx";
import { section as buffer } from "../src/pages/reports/sections/Buffer.tsx";
import { section as fixedVariable } from "../src/pages/reports/sections/FixedVariable.tsx";
import type { ReportContext, ReportSection } from "../src/pages/reports/types.ts";

/** A context with only the parts a test reads: the sections look at nothing else. */
const context = (data: Record<string, unknown>, accounts: unknown[] = []): ReportContext => ({ data, meta: { today: "2026-10-11", accounts }, range: { from: "2026-08-01", to: "2026-08-31" }, exportHref: () => "/export.csv" }) as unknown as ReportContext;
const html = (s: ReportSection, ctx: ReportContext) => renderToStaticMarkup(createElement(s.Component, { ctx }));

const totals = { incomeCents: 400_000, expenseCents: 250_000, consumptionCents: 250_000, debtCents: 0, savedCents: 50_000, borrowedCents: 0, netCents: 150_000, leftCents: 100_000, savingsRate: 0.125 };
const row = { month: "2026-08", ...totals, complete: true, stack: { inCents: 400_000, outCents: 300_000, gapCents: 100_000 } };
const cashflowData = (over: Record<string, unknown> = {}) => ({
  cashflow: {
    rows: [row], totals, whole: { ...totals, inCents: 400_000 }, average: null, running: false, usualRate: null,
    rateCompare: null, ...over,
  },
});
const plain = (out: string) => out.replace(/[\u00a0\u202f]/g, " ");

describe("Raportit: Tulot ja menot", () => {
  it("asks where the income went and answers with the period's flows, each a server total, and draws no tile row", () => {
    const out = plain(html(cashflow, context(cashflowData())));
    expect(out).toContain("Tulojen käyttö 1 kuukaudessa");
    expect(out).toContain("Tuloja oli <strong>4 000 €</strong>. Kulutukseen meni 2 500 €. Velanhoitoon meni 0 €. Säästöön meni 500 €. Tulos <strong>1 000 €</strong>.");
    expect(out).toContain("Käteen jäi 1 000 €");
    expect(out).not.toContain('class="kv"');
  });

  it("has no Kaavio and Taulukko switch: every chart is followed by its table", () => {
    const out = html(cashflow, context(cashflowData()));
    expect(out).not.toContain("Taulukko</button>");
    expect(out).not.toContain("Kaavio</button>");
  });

  it("a running range tells one sum: the total row adds up every row, the running month's too", () => {
    const out = plain(html(cashflow, context(cashflowData({ running: true, whole: { ...totals, inCents: 400_000 }, rows: [row, { ...row, month: "2026-09" }, { ...row, month: "2026-10", complete: false }] }))));
    expect(out).toContain("Tulojen käyttö 3 kuukaudessa");
    expect(out).toContain('<th scope="row">3 kuukautta</th>');
  });

  it("a savings rate that never leaves its usual level is a sentence, and a band whose ends print the same says one figure", () => {
    const usualRate = { low: 0.11, mid: 0.11, high: 0.112, months: 12 };
    const rows = Array.from({ length: 4 }, (_, i) => ({ ...row, month: `2026-0${i + 5}`, savingsRate: 0.11 }));
    const out = plain(html(cashflow, context(cashflowData({ rows, usualRate }))));
    expect(out).toContain("Säästöön meni joka kuukausi tavallinen osuus tuloista, 11 % (12 kuukautta).");
    expect(out).not.toContain("11–11");
  });

  it("lays the bridge from the money in to the accounts' change in lines that add up to it", () => {
    const lines = [
      { key: "income", cents: 400_000, rowIds: ["a"] },
      { key: "consumption", cents: -250_000, rowIds: ["b", "c"] },
      { key: "debt", cents: 0, rowIds: [] },
      { key: "investedOut", cents: -50_000, rowIds: ["d"] },
    ];
    const out = plain(html(cashflow, context(cashflowData({ moneyBridge: { from: "2026-07-31", to: "2026-08-31", basis: "dayBefore", changeCents: 100_000, lines } }))));
    expect(out).toContain("Tilien muutos");
    expect(out).toContain("<strong>1 000 €</strong> enemmän rahaa kuin 31.7.");
    expect(out).toContain("Säästöön ja sijoituksiin");
    expect(out).toContain("Tilien muutos");
  });

  it("sets the newest month's savings rate beside the same month a year ago, and beside the month before only when the table has no row of it", () => {
    const rateCompare = { month: "2026-08", rate: 0.125, previous: { month: "2026-07", rate: 0.1 }, yearAgo: { month: "2025-08", rate: 0.1 } };
    const inTable = plain(html(cashflow, context(cashflowData({ rateCompare, rows: [{ ...row, month: "2026-07" }, row] }))));
    expect(inTable).toContain("Vuotta aiemmin: 10 % (+3 prosenttiyksikköä).");
    expect(inTable).not.toContain("Edellinen kuukausi");
    const short = plain(html(cashflow, context(cashflowData({ rateCompare }))));
    expect(short).toContain("Edellinen kuukausi: 10 % (+3 prosenttiyksikköä).");
    const none = plain(html(cashflow, context(cashflowData({ rateCompare: { ...rateCompare, yearAgo: { month: "2025-08", rate: null } } }))));
    expect(none).not.toContain("Vuotta aiemmin");
  });
});

describe("Raportit: Kiinteät ja muuttuvat", () => {
  const band = { month: "2026-08", fixedCents: 120_000, habitCents: 30_000, variableCents: 50_000, debtCents: 0, tops: [120_000, 150_000, 200_000, 200_000], fixedShare: 0.6, fixedPercent: 60, shares: [60, 15, 25, 0] };
  const fixedData = (buffer: Record<string, unknown> = {}) => ({
    fixedVariable: { totals: { ...band, spendingCents: 200_000 }, rows: [band] }, cashflow: { unknownShare: 0, rows: [{ month: "2026-08", complete: true }] },
    buffer: { fixedMonthlyCents: 130_000, fixedShare: 0.4, bufferMonths: 2.5, fixedShareLabel: "Kiinteät menot tavallisista tuloista, viimeiset 6 kuukautta", ...buffer },
  });

  it("heads the panel with the fixed costs a month and answers with the month's fixed share and the buffer, all server figures", () => {
    const out = plain(html(fixedVariable, context(fixedData())));
    expect(out).toContain("Kiinteät 1 300 € kuussa");
    expect(out).toContain("Elokuussa kiinteisiin menoihin meni <strong>60 %</strong> menoista.");
    expect(out).toContain("Kiinteät menot ovat nyt <strong>1 300 €</strong> kuussa, 40 % tavallisista tuloista.");
    expect(out).toContain("Tilien saldo riittää 2,5 kuukauden tavallisiin menoihin.");
  });

  it("reads the table's percent when the labels' rounding together would say another", () => {
    const september = { ...band, month: "2026-08", fixedCents: 169_200, habitCents: 160_500, variableCents: 59_300, tops: [169_200, 329_700, 389_000, 389_000], fixedShare: 169_200 / 389_000, fixedPercent: 43, shares: [44, 41, 15, 0] };
    const data = { ...fixedData(), fixedVariable: { totals: september, rows: [september] }, cashflow: { unknownShare: 0, rows: [{ month: "2026-08", complete: true }] } };
    expect(plain(html(fixedVariable, context(data)))).toContain("<strong>43 %</strong> menoista");
  });

  it("sets the newest month's fixed share against the first month the chart draws, in the percent the table prints", () => {
    const before = { ...band, month: "2025-09", fixedShare: 0.517, fixedPercent: 52, shares: [52, 20, 28, 0] };
    const data = { ...fixedData(), fixedVariable: { totals: band, rows: [before, band] }, cashflow: { unknownShare: 0, rows: [{ month: "2025-09", complete: true }, { month: "2026-08", complete: true }] } };
    expect(plain(html(fixedVariable, context(data)))).toContain("Elokuussa kiinteisiin menoihin meni <strong>60 %</strong> menoista. Syyskuussa 2025 osuus oli 52 %.");
  });

  it("Puskuri shows the cash less card debt and the bills before payday, and the months it carries", () => {
    const data = { buffer: { cashCents: 1_000_000, cardDebtCents: 200_000, dueBeforePaydayCents: 0, netCents: 800_000, bufferMonths: 4, expectedSpendCents: 200_000 } };
    const out = plain(html(buffer, context(data)));
    expect(out).toContain("Korttivelka");
    expect(out).not.toContain("Ennen palkkapäivää erääntyvät laskut");
    expect(out).toContain("4,0 kuukauden");
    expect(plain(html(buffer, context({ buffer: { ...data.buffer, cashCents: null, netCents: null, bufferMonths: null } })))).toBe("");
  });

  it("Nostettu luotto tells the credit drawn and is quiet without a draw", () => {
    const flow = (borrowedCents: number) => ({ cashflow: { totals: { incomeCents: 0, consumptionCents: 0, debtCents: 0, savedCents: 0, borrowedCents } } });
    expect(plain(html(borrowed, context(flow(50_000))))).toContain("Nostettu luotto ei ole tuloa");
    expect(borrowed.visible?.(context(flow(0)))).toBe(false);
  });

  it("a share of the income that is not known and a buffer that is not known leave their sentences out", () => {
    const out = plain(html(fixedVariable, context(fixedData({ fixedShare: null, bufferMonths: null }))));
    expect(out).toContain("Kiinteät menot ovat nyt <strong>1 300 €</strong> kuussa.");
    expect(out).not.toContain("riittävät");
  });

  it("names in the legend only the layers that hold money: a layer of nothing is not drawn, so it is not named", () => {
    const out = html(fixedVariable, context(fixedData()));
    for (const l of ["Kiinteät", "Arkiostot", "Kertaostot"]) expect(out).toContain(l);
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
      drift: { items: [{}] },
      fixedCosts: { rows: [{}] },
      loans: { saved: 1 },
      cashflow: { totals: { incomeCents: 0, consumptionCents: 0, debtCents: 0, savedCents: 0, borrowedCents: 50_000 } },
      dataQuality: { signals: [{}] },
      food: {},
      taxYear: { income: { types: [{}] }, refunds: { rows: [] }, interest: { rows: [] }, loanPayments: [], household: { rows: [] }, residual: { rows: [] } },
    }, [{}]);
  const ids = (page: "month" | "bills" | "reports" | "optimise" | "settings") => visibleSections(full(), page).map((s) => s.id);

  it("every section names one, and each page shows the sections that name it: Menojen muutos on Yhteenveto, Laskut none, Tiedot the data quality notes", () => {
    expect(REPORT_SECTIONS.length).toBeGreaterThan(10);
    expect(ids("month")).toEqual(["muutos"]);
    expect(ids("bills")).toEqual([]);
    expect(ids("settings")).toEqual(["laatu"]);
    // Yhteiset menot needs a joint account the user is weighted in, which the full answer does not have
    expect(ids("reports")).toHaveLength(REPORT_SECTIONS.length - 3);
    for (const id of ["muutos", "laatu", "yhteiset-menot"]) expect(ids("reports")).not.toContain(id);
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
