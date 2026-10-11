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
    expect(out).toContain("Mihin tulot menivät");
    expect(out).not.toContain('class="kv"');
    expect(out).not.toContain("Säästöaste");
  });

  it("a running range with no complete month has no bar, so the totals stand in its place", () => {
    const out = html(cashflow, context(cashflowData({ running: true, closed: null })));
    expect(out).not.toContain("Mihin tulot menivät");
    expect(out).toContain('class="kv"');
    expect(out).toContain("Menot");
  });
});

describe("Raportit: Kiinteät ja muuttuvat", () => {
  const rows = [{ month: "2026-08", fixedCents: 120_000, habitCents: 30_000, variableCents: 50_000, debtCents: 0 }];
  const fixedData = (t: { fixedCents: number; habitCents: number; variableCents: number; debtCents: number }) => ({ fixedVariable: { totals: t, rows }, buffer: { advice: null, cashCents: 10_000 } });

  it("hides a part the period has none of, with its legend entry", () => {
    const out = html(fixedVariable, context(fixedData({ fixedCents: 120_000, habitCents: 30_000, variableCents: 50_000, debtCents: 0 })));
    expect(out).toContain("Kiinteät");
    expect(out).toContain("Satunnaiset");
    expect(out).not.toContain("Muu velanhoito");
  });

  it("shows every part when each has some, with its share of the spending", () => {
    const out = html(fixedVariable, context(fixedData({ fixedCents: 100_000, habitCents: 30_000, variableCents: 50_000, debtCents: 20_000 })));
    expect(out).toContain("Muu velanhoito");
    expect(out).toMatch(/50\s%/);
    expect(out).toMatch(/10\s%/);
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
      spendingChange: { views: [{}] },
      yearOverYear: { comparable: true },
      drift: { items: [{}] },
      upcoming: { advice: "Varaa 47 € kuussa, harvinaiset laskut ovat 565 € vuodessa.", manual: [] },
      priceChanges: { items: [{}] },
    }, [{}]);
  const ids = (page: "month" | "bills" | "reports" | "optimise" | "settings") => visibleSections(full(), page).map((s) => s.id);

  it("every section names one, and each page shows the sections that name it: Menojen muutos on Kuukausi, Laskut its two, Tilit the data quality notes", () => {
    expect(REPORT_SECTIONS.length).toBeGreaterThan(10);
    expect(ids("month")).toEqual(["muutos"]);
    expect(ids("bills")).toEqual(["hinnat", "tulevat"]);
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
    upcoming: { from: "2026-10-11", to: "2027-01-11", items: [], totalCents: 0, reserveMonthlyCents: 4700, yearlyCents: 56500, months: [{ month: "2026-10", cents: 0, names: [] }], manual: [], advice: "Varaa 47 € kuussa, harvinaiset laskut ovat 565 € vuodessa.", ...over },
  });
  const typed = { id: "b1", name: "Ajoneuvovero", amountCents: 31250, dueDate: "2026-12-01", cadence: "yearly", category: null, nextDate: "2026-12-01", counted: true };

  it("Harvinaiset laskut is shown only when a rare bill is found or one is typed in", () => {
    expect(upcomingSection.visible?.(context(upcoming()))).toBe(true);
    expect(upcomingSection.visible?.(context(upcoming({ advice: "", manual: [typed] })))).toBe(true);
    expect(upcomingSection.visible?.(context(upcoming({ advice: "", manual: [] })))).toBe(false);
  });

  it("has the twelve months and the typed-in bills, and neither the list of three months nor the form: Tulossa has those", () => {
    const out = html(upcomingSection, context(upcoming({ manual: [typed] })));
    expect(out).toContain("Harvinaiset laskut");
    expect(out).toContain("Seuraavat 12 kuukautta");
    expect(out).toContain("Poista lasku Ajoneuvovero");
    expect(out).not.toContain("Seuraavat kolme kuukautta");
    expect(out).not.toContain("Lisää odotettu lasku");
  });

  it("Hinnanmuutokset is shown only when a price changed", () => {
    expect(priceChanges.visible?.(context({ priceChanges: { items: [] } }))).toBe(false);
    expect(priceChanges.visible?.(context({ priceChanges: { items: [{}] } }))).toBe(true);
  });
});
