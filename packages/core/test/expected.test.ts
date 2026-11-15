/**
 * The expected figure (ADR 0021): made per category, added up to the headline, a bill that is not monthly expected whole in
 * its own month, a one-off left out.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { expectedFor, expectedIncome, expectedLevel, expectedSpending } from "../src/analysis/expected.ts";
import { monthPace } from "../src/analysis/forecast.ts";
import { pivotReport } from "../src/reports/pivot.ts";
import type { Account, Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const today = "2026-10-20";

/** Three shopping days a month for 13 months, rent on the 1st, a quarterly insurance and the pay on the 25th. */
function household(extra: Transaction[] = []): Transaction[] {
  const months = Array.from({ length: 14 }, (_, i) => `${2025 + Math.floor((8 + i) / 12)}-${String(((8 + i) % 12) + 1).padStart(2, "0")}`);
  const shop = months.flatMap((m) => [5, 15, 25].map((d) => tx({ bookingDate: `${m}-${String(d).padStart(2, "0")}`, amountCents: -10_000, merchant: "Prisma", category: "groceries" })));
  const rent = months.map((m) => tx({ bookingDate: `${m}-01`, amountCents: -100_000, merchant: "Sato Oyj", category: "housing" }));
  const pay = months.map((m) => tx({ bookingDate: `${m}-25`, amountCents: 300_000, merchant: "Acme Oy", category: "salary" }));
  const insurance = series("2025-10-10", 91, 5, -14_230, { merchant: "Vakuutus Esimerkki", category: "insurance" });
  return [...shop, ...rent, ...pay, ...insurance, ...extra].filter((t) => t.bookingDate <= today);
}
const ctxOf = (rows: Transaction[], on = today) => createContext(rows, [checking], on);

describe("the expected figure of a month", () => {
  const ctx = ctxOf(household());

  it("is the sum of its categories, to the cent, on every day of the month", () => {
    const figure = expectedFor(ctx, "2026-10")!;
    expect(figure.months).toHaveLength(6);
    for (const day of [1, 9, 10, 20, 31]) {
      const at = figure.at(day);
      expect(at.categories.reduce((sum, c) => sum + c.cents, 0)).toBe(at.cents);
    }
    expect(expectedSpending(ctx, "2026-10")).toBe(figure.at().cents);
  });

  it("holds the rent from the first day and the shopping as it comes", () => {
    const figure = expectedFor(ctx, "2026-10")!;
    expect(figure.at(1).categories).toEqual([{ category: "housing", kind: "dated", cents: 100_000 }]);
    const shopping = (day: number) => figure.at(day).categories.find((c) => c.category === "groceries")?.cents;
    expect(shopping(4)).toBeUndefined();
    expect(shopping(5)).toBe(10_000);
    expect(shopping(31)).toBe(30_000);
  });

  it("expects a quarterly insurance whole in the month it falls due and in no other", () => {
    const insurance = (month: string) => expectedFor(ctx, month)!.at().categories.find((c) => c.category === "insurance");
    expect(insurance("2026-10")).toMatchObject({ kind: "periodic", cents: 14_230 });
    expect(insurance("2026-09")).toBeUndefined();
    expect(insurance("2026-08")).toBeUndefined();
    // before its day in the month it is not yet expected
    expect(expectedFor(ctx, "2026-10")!.at(5).categories.find((c) => c.category === "insurance")).toBeUndefined();
    expect(expectedFor(ctx, "2026-10")!.due).toMatchObject([{ category: "insurance", cents: 14_230 }]);
  });

  it("leaves a one-off out of the next month's figure and lists it", () => {
    const sofa = tx({ bookingDate: "2026-08-12", amountCents: -180_000, merchant: "Sotka", category: "home" });
    const with_ = expectedFor(ctxOf(household([sofa])), "2026-10")!;
    const without = expectedFor(ctx, "2026-10")!;
    expect(with_.at().cents).toBe(without.at().cents);
    expect(with_.oneOffs).toMatchObject([{ merchant: "Sotka", cents: 180_000 }]);
    expect(without.oneOffs).toEqual([]);
  });

  it("is the mean of the months, so it follows a level that has moved", () => {
    // other shops each month, so the rows are no subscription
    const rise = ["2026-07", "2026-08", "2026-09"].map((m, i) => tx({ bookingDate: `${m}-20`, amountCents: -20_000, merchant: ["Sale", "K-Market", "Lidl"][i]!, category: "groceries" }));
    const groceries = (rows: Transaction[]) => expectedFor(ctxOf(rows), "2026-10")!.at().categories.find((c) => c.category === "groceries")!.cents;
    expect(groceries(household(rise)) - groceries(household())).toBe(10_000);
  });

  it("has no figure under three complete months", () => {
    const young = household().filter((t) => t.bookingDate >= "2026-08-01");
    expect(expectedFor(ctxOf(young), "2026-10")).toBeNull();
    expect(expectedSpending(ctxOf(young), "2026-10")).toBeNull();
  });
});

describe("the expected level of a series and of the income", () => {
  it("is the mean in whole cents, none under three values", () => {
    expect(expectedLevel([100, 200, 301])).toBe(200);
    expect(expectedLevel([100, 200])).toBeNull();
  });

  it("is the mean earned income of the base months", () => {
    expect(expectedIncome(ctxOf(household()), "2026-10")).toBe(300_000);
  });
});

describe("one expected figure on every page that reads it", () => {
  it("the report of months leaves a one-off out of a row's expected month", () => {
    const sofa = tx({ bookingDate: "2026-08-12", amountCents: -180_000, merchant: "Sotka", category: "home" });
    const report = pivotReport(ctxOf(household([sofa])), { from: "2026-04-01", to: "2026-09-30" });
    const home = report.rows.find((r) => r.category === "home")!;
    expect(home.values.reduce((a, b) => a + b, 0)).toBe(180_000);
    expect(home.expectedCents).toBe(0);
  });

  it("the report of months expects a new monthly bill and a quarterly one as the first page does", () => {
    const rent = household().filter((t) => t.category !== "housing" || t.bookingDate >= "2026-07-01");
    const insurance = ["2026-01-10", "2026-04-10", "2026-07-10"].map((d) => tx({ bookingDate: d, amountCents: -14_230, merchant: "If Vakuutus", category: "insurance" }));
    const ctxP = ctxOf([...rent, ...insurance]);
    const first = expectedFor(ctxP, "2026-10")!.at();
    // six complete months, April to September: the month after is the one the first page expects
    const report = pivotReport(ctxP, { from: "2026-04-01", to: "2026-09-30" });
    for (const category of ["housing", "insurance"]) {
      const row = report.rows.find((r) => r.category === category)!;
      expect(first.categories.find((c) => c.category === category)?.cents).toBeGreaterThan(0);
      expect(row.expectedCents).toBe(first.categories.find((c) => c.category === category)!.cents);
    }
  });

  it("a monthly bill that began in the middle of the base is expected whole, not diluted by the months before", () => {
    const rent = household().filter((t) => t.category !== "housing" || t.bookingDate >= "2026-07-01");
    const figure = expectedFor(ctxOf(rent, "2026-10-03"), "2026-10")!;
    expect(figure.at(3).categories.find((c) => c.category === "housing")?.cents).toBe(100_000);
  });

  it("a bill paid on the last day of every month is in the pace curve to the last day of a short month", () => {
    const monthEnds = Array.from({ length: 8 }, (_, i) => tx({ bookingDate: ["2025-07-31", "2025-08-31", "2025-09-30", "2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28"][i]!, amountCents: -100_000, merchant: "Sato Oyj", category: "housing" }));
    const day = "2026-03-02";
    const ctxF = ctxOf([...monthEnds, ...household().filter((t) => t.category !== "housing" && t.bookingDate <= "2026-02-28")], day);
    const pace = monthPace(ctxF, "2026-02", day);
    const whole = expectedFor(ctxF, "2026-02")!.at().cents;
    expect(pace.expected!.curve.at(-1)).toBe(whole);
    expect(pace.expected!.curve.at(-1)).toBeGreaterThanOrEqual(100_000);
  });
});

describe("the months of the expected figure with a late paying account", () => {
  const second: Account = { id: "acc-2", name: "Toinen tili", iban: null, currency: "EUR", type: "checking" };
  const days = (from: string, to: string, step: number, accountId: string, cents: number): Transaction[] => {
    const out: Transaction[] = [];
    for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + step * 86400000)) out.push(tx({ id: `${accountId}-${out.length}`, accountId, bookingDate: d.toISOString().slice(0, 10), amountCents: cents, merchant: "Prisma", category: "groceries" }));
    return out;
  };

  it("leaves out the months before the account was connected, as the change report does", () => {
    const rows = [...days("2026-03-02", "2026-10-15", 7, "acc-1", -5_000), ...days("2026-06-01", "2026-10-15", 2, "acc-2", -4_000)].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    const c = createContext(rows, [checking, second], "2026-10-15");
    expect(expectedFor(c, "2026-10")!.months).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
  });

  it("keeps all complete months when the rows are complete", () => {
    expect(expectedFor(ctxOf(household()), "2026-10")!.months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  });
});
