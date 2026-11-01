// The report of the running month: its gap rows add up to the gap, the estimate holds the spending so far, and a yearly bill in its own month is no deviation.
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { expectedFor, quantile } from "../src/analysis/expected.ts";
import { RANGE_HIGH, RANGE_LOW } from "../src/thresholds.ts";
import { thisMonthReport } from "../src/reports/this-month.ts";
import { NO_INPUTS, type Account, type Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const today = "2026-10-20";

/** Shopping on the 5th, 15th and 25th and rent on the 1st for 14 months, and a yearly insurance on 12 Oct 2025 that falls due again on 12 Oct 2026. */
function household(extra: Transaction[] = []): Transaction[] {
  const months = Array.from({ length: 14 }, (_, i) => `${2025 + Math.floor((8 + i) / 12)}-${String(((8 + i) % 12) + 1).padStart(2, "0")}`);
  const shop = months.flatMap((m) => [5, 15, 25].map((d) => tx({ bookingDate: `${m}-${String(d).padStart(2, "0")}`, amountCents: -10_000, merchant: "Prisma", category: "groceries" })));
  const rent = months.map((m) => tx({ bookingDate: `${m}-01`, amountCents: -100_000, merchant: "Sato Oyj", category: "housing" }));
  return [...shop, ...rent, ...extra].filter((t) => t.bookingDate <= today);
}
const report = (rows: Transaction[]) => thisMonthReport(createContext(rows, [checking], today), NO_INPUTS);
const sum = (rows: { gapCents: number }[]) => rows.reduce((s, r) => s + r.gapCents, 0);

describe("the report of this month", () => {
  it("has gap rows by day and by category that add up to the gap to the cent", () => {
    const sofa = tx({ bookingDate: "2026-10-12", amountCents: -80_000, merchant: "Sotka", category: "home" });
    const food = tx({ bookingDate: "2026-10-18", amountCents: -23_457, merchant: "Lidl", category: "groceries" });
    const r = report(household([sofa, food]));
    expect(r.gapCents).toBe(r.spentCents - r.expectedCents!);
    expect(r.gapCents).toBe(80_000 + 23_457);
    expect(sum(r.days)).toBe(r.gapCents);
    expect(sum(r.categories)).toBe(r.gapCents);
    expect(r.days[0]).toMatchObject({ day: 12, top: { merchant: "Sotka" } });
    expect(r.categories[0]).toMatchObject({ category: "home", gapCents: 80_000 });
  });

  it("estimates the month end from what is spent and what the rest of the month usually costs, as a range around it", () => {
    const r = report(household());
    expect(r.stillComingCents).toBe(10_000);
    expect(r.otherComingCents).toBe(r.stillComingCents! - (r.billsCents - r.earlierBillsCents));
    expect(r.estimate).toMatchObject({ cents: r.spentCents + 10_000 });
    expect(r.estimate!.lowCents).toBeLessThanOrEqual(r.estimate!.cents);
    expect(r.estimate!.highCents).toBeGreaterThanOrEqual(r.estimate!.cents);
    expect(r.estimate!.lowCents).toBeGreaterThanOrEqual(r.spentCents);
  });

  it("a yearly payment in its own month is not a deviation", () => {
    const insurance = series("2024-10-12", 365, 3, -48_000, { merchant: "Vakuutus Esimerkki", category: "insurance" });
    const r = report(household(insurance));
    expect(r.categories.find((c) => c.category === "insurance")).toBeUndefined();
    expect(r.gapCents).toBe(0);
  });

  it("says why there is no gap without history", () => {
    const r = report(household().filter((t) => t.bookingDate >= "2026-09-01"));
    expect(r).toMatchObject({ gapCents: null, expectedCents: null, estimate: null, gapReason: "history" });
    expect(r.categories).toEqual([]);
  });

  it("takes the range from what each base month spent after today, not from the difference of two cumulative quartiles", () => {
    // the 22nd costs 50, 100 or 150 euros by month, the 5th and 25th 100: the rest of the month differs by month
    const big = [3, 4, 5, 6, 7, 8, 9].map((m, i) => tx({ bookingDate: `2026-0${m}-22`, amountCents: -5_000 * ((i % 3) + 1), merchant: "Lidl", category: "groceries" }));
    const ctx = createContext(household(big), [checking], today);
    const r = thisMonthReport(ctx, NO_INPUTS);
    const figure = expectedFor(ctx, "2026-10")!;
    const rest = figure.totals(31).map((total, i) => total - figure.totals(20)[i]!).sort((a, b) => a - b);
    expect(rest[0]).toBeLessThan(rest[rest.length - 1]!);
    expect(r.estimate!.lowCents).toBe(Math.min(r.estimate!.cents, r.spentCents + quantile(rest, RANGE_LOW)));
    expect(r.estimate!.highCents).toBe(Math.max(r.estimate!.cents, r.spentCents + quantile(rest, RANGE_HIGH)));
    expect(r.estimate!.lowCents).toBeLessThan(r.estimate!.highCents);
  });

  it("keeps a bill that is late on the list and counts it in the estimate", () => {
    const months = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    const phone = (upTo: string) => months.filter((m) => m <= upTo).map((m) => tx({ bookingDate: `${m}-17`, amountCents: -2_990, merchant: "Elisa", category: "subscriptions" }));
    const paid = report(household(phone("2026-10")));
    const r = report(household(phone("2026-09")));
    expect(r.bills.find((b) => b.merchant === "Elisa")).toMatchObject({ late: true, cents: 2_990 });
    expect(paid.bills.find((b) => b.merchant === "Elisa")).toBeUndefined();
    // paid or not, the month ends at the same figure; the unpaid one only moves 29,90 from the spending to the rest
    expect(r.estimate!.cents).toBe(paid.estimate!.cents);
    expect(r.gapCents).toBe(paid.gapCents! - 2_990);
  });

  it("keeps the spent and expected columns adding up to their totals when a row has no gap", () => {
    const r = report(household([tx({ bookingDate: "2026-10-12", amountCents: -80_000, merchant: "Sotka", category: "home" })]));
    expect(r.categories.reduce((s, c) => s + c.spentCents, 0)).toBe(r.spentCents);
    expect(r.categories.reduce((s, c) => s + c.expectedCents, 0)).toBe(r.expectedCents);
    expect(r.days.reduce((s, c) => s + c.spentCents, 0)).toBe(r.spentCents);
  });

  it("holds a bill that falls due later this month in both ends of the range", () => {
    const insurance = series("2024-10-25", 365, 2, -48_000, { merchant: "Vakuutus Esimerkki", category: "insurance" });
    const r = report(household(insurance));
    expect(r.stillComingCents).toBe(10_000 + 48_000);
    expect(r.otherComingCents).toBe(10_000);
    expect(r.estimate!.lowCents).toBeGreaterThanOrEqual(r.spentCents + 48_000);
  });

  it("counts a bill due today that is not paid, so the estimate does not move with the date", () => {
    const months = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
    const phone = months.map((m) => tx({ bookingDate: `${m}-20`, amountCents: -2_990, merchant: "Elisa", category: "subscriptions" }));
    const r = report(household(phone));
    expect(r.estimate!.cents).toBe(r.spentCents + r.stillComingCents!);
    expect(r.stillComingCents).toBe(10_000 + 2_990);
  });
});
