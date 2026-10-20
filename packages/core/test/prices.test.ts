import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { CATEGORY_COICOP, priceSplit } from "../src/analysis/prices.ts";
import { CATEGORIES } from "../src/categories.ts";
import { addMonths } from "../src/dates.ts";
import { CPI_CLASS_NAMES, CPI_FACTS } from "../src/optimise/facts/cpi.ts";
import { factFrom } from "../src/optimise/index.ts";
import { categoryReport } from "../src/reports/categories.ts";
import { driftReport } from "../src/reports/drift.ts";
import type { Account, Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-19";

/** The mean index of `coicop` over `months`, read from the facts as a calc line would. */
const factOn = (id: string, on: string) => factFrom(CPI_FACTS, id, on);
const meanIndex = (coicop: string, months: string[]) => months.reduce((s, m) => s + factOn(`cpi_index:${coicop}:${m}`, today)!.value, 0) / months.length;
const monthsFrom = (first: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(first, i));

/** Salary and rent to keep the household steady, groceries at `level` cents a month from 2025-07, the months in `high` dearer. */
function household(level: number, high: Record<string, number>): Transaction[] {
  return [
    ...series("2025-07-25", 30.44, 15, 300000, { category: "salary", merchant: "Acme Oy" }),
    ...series("2025-07-02", 30.44, 15, -105000, { category: "housing", merchant: "Sato Oyj" }),
    ...monthsFrom("2025-07", 15).map((month, i) => tx({ bookingDate: `${month}-12`, amountCents: -(high[month] ?? level), category: "groceries", merchant: `Kauppa ${i % 4}` })),
  ].filter((t) => t.bookingDate <= today);
}

describe("price split", () => {
  it("a category whose spend rose by price and quantity splits into parts that add up to the change to the cent", () => {
    const ctx = createContext(household(40000, { "2026-07": 52011, "2026-08": 53007, "2026-09": 54003 }), [checking], today);
    const item = driftReport(ctx, { from: "2026-01-01", to: "2026-09-30" }).items.find((i) => i.category === "groceries")!;
    const p = item.prices!;
    expect(p.coicop).toBe("01");
    expect(p.currentMonths).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(p.baseMonths).toEqual(monthsFrom("2025-07", 12));
    expect(p.changeCents).toBe(item.recentCents - item.usualCents);
    expect(p.priceCents + p.quantityCents).toBe(p.changeCents);
    // groceries were dearer than in the year before: both parts are there, the household bought more too
    expect(p.priceCents).toBe(Math.round(40000 * (meanIndex("01", p.currentMonths) / meanIndex("01", p.baseMonths) - 1)));
    expect(p.priceCents).toBeGreaterThan(0);
    expect(p.quantityCents).toBeGreaterThan(p.priceCents);
    expect(p.source.url).toMatch(/^https:\/\/pxdata\.stat\.fi\//);
    expect(p.verifiedAt).toBe("2026-10-19");
  });

  it("Kategoriat splits the rise from the previous period of complete months, and is quiet over the running month", () => {
    const rows = household(40000, Object.fromEntries(monthsFrom("2026-04", 6).map((m, i) => [m, 45000 + i * 1013])));
    const ctx = createContext(rows, [checking], today);
    const stat = (from: string, to: string) => categoryReport(ctx, { from, to }).groups.flatMap((g) => g.categories).find((c) => c.category === "groceries")!;
    const s = stat("2026-04-01", "2026-09-30");
    const p = s.prices!;
    expect(p.baseMonths).toEqual(monthsFrom("2025-10", 6));
    expect(p.currentMonths).toEqual(monthsFrom("2026-04", 6));
    expect(p.changeCents).toBe(s.comparedCents - s.previousCents);
    expect(p.priceCents + p.quantityCents).toBe(p.changeCents);
    // October 2026 has no index yet
    expect(stat("2026-10-01", "2026-10-31").prices).toBeNull();
    // housing has no class, salary is not spending
    expect(categoryReport(ctx, { from: "2026-04-01", to: "2026-09-30" }).groups.flatMap((g) => g.categories).find((c) => c.category === "housing")?.prices).toBeNull();
  });

  it("is quiet without a rise, a class, a base or valid index rows", () => {
    const base = { cents: 40000, months: ["2025-07", "2025-08", "2025-09"] };
    const current = { cents: 46000, months: ["2026-07", "2026-08", "2026-09"] };
    expect(priceSplit("01", base, current, today)).not.toBeNull();
    expect(priceSplit("01", current, base, today)).toBeNull();
    expect(priceSplit("01", base, { ...current, cents: 40000 }, today)).toBeNull();
    expect(priceSplit(CATEGORY_COICOP.shopping, base, current, today)).toBeNull();
    expect(priceSplit("01", { ...base, cents: 0 }, current, today)).toBeNull();
    expect(priceSplit("99.9", base, current, today)).toBeNull();
    // a month before the series and a month after it
    expect(priceSplit("01", { ...base, months: ["2023-09"] }, current, today)).toBeNull();
    expect(priceSplit("01", base, { ...current, months: ["2026-10"] }, today)).toBeNull();
    // the series ages as one: six months after its release nothing is split
    expect(priceSplit("01", base, current, "2027-03-30")).not.toBeNull();
    expect(priceSplit("01", base, current, "2027-03-31")).toBeNull();
  });

  it("prices that fell leave all of the rise and more to what was bought", () => {
    // bank fees fell from 2024 to 2026
    const p = priceSplit("12.2.2", { cents: 1000, months: ["2024-01"] }, { cents: 1200, months: ["2026-09"] }, today)!;
    expect(p.priceChange).toBeLessThan(0);
    expect(p.priceCents).toBeLessThan(0);
    expect(p.quantityCents).toBeGreaterThan(p.changeCents);
    expect(p.priceCents + p.quantityCents).toBe(200);
  });

  it("maps only expense categories, each to a bundled series of 36 months", () => {
    for (const [category, coicop] of Object.entries(CATEGORY_COICOP)) {
      expect(CATEGORIES.find((c) => c.id === category)?.kind, category).toBe("expense");
      expect(CPI_CLASS_NAMES.has(coicop), coicop).toBe(true);
      expect(CPI_FACTS.filter((f) => f.id.startsWith(`cpi_index:${coicop}:`)).map((f) => f.period)).toEqual(monthsFrom("2023-10", 36));
    }
    expect(factOn("cpi_index:01:2026-09", today)).toMatchObject({ value: 102.19, label: "Kuluttajahintaindeksi syyskuussa 2026, Elintarvikkeet ja alkoholittomat juomat" });
  });
});
