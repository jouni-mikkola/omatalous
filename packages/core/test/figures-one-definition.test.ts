import { describe, expect, it } from "vitest";
import { savingsRateOf } from "../src/analysis/bridge.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { addMonths } from "../src/dates.ts";
import { yearWindow } from "../src/optimise/common.ts";
import { situationOf } from "../src/optimise/situation.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

function monthly(firstMonth: string, day: number, count: number, amount: number, partial: Partial<Transaction>): Transaction[] {
  return Array.from({ length: count }, (_, i) => tx({ ...partial, bookingDate: `${addMonths(firstMonth, i)}-${String(day).padStart(2, "0")}`, amountCents: amount }));
}

/** Salary 3 000 € and 300 € saved every month from 2025-09, so every complete month saves 10 %. */
const base = [
  ...monthly("2025-09", 25, 13, 300000, { category: "salary", merchant: "Acme Oy" }),
  ...monthly("2025-09", 2, 14, -105000, { category: "housing", merchant: "Sato Oyj" }),
  ...monthly("2025-09", 6, 14, -30000, { category: "investments", merchant: "Nordnet" }),
].filter((t) => t.bookingDate <= today);

const ctxOf = (rows: Transaction[], from = "0000-00-00") => createContext(rows.filter((t) => t.bookingDate >= from), [checking], today);
const draw = (bookingDate: string, amountCents: number) => tx({ bookingDate, amountCents, category: "credit_draw", merchant: "Nordea Rahoitus" });

describe("the savings rate has one helper", () => {
  const ctx = ctxOf(base);

  it("pools the complete months of the run and names how many", () => {
    const r = savingsRateOf(ctx, ["2026-08", "2026-09", "2026-10"]);
    expect(r.months).toEqual(["2026-08", "2026-09"]);
    expect(r.rate).toBeCloseTo(0.1, 10);
    expect(r.label).toBe("Säästöaste, viimeiset 2 kuukautta");
  });

  it("leaves a month the history covers only in part out, and has no rate when none is left", () => {
    const young = ctxOf(base, "2026-08-15");
    expect(savingsRateOf(young, ["2026-08", "2026-09"]).months).toEqual(["2026-09"]);
    expect(savingsRateOf(young, ["2026-08"])).toMatchObject({ rate: null, months: [] });
    expect(savingsRateOf(ctx, [])).toMatchObject({ rate: null, label: "Säästöaste, viimeiset 0 kuukautta" });
  });

  it("takes a twelve-month window as one pool, and money taken out of savings lowers it", () => {
    const window = yearWindow(ctx, "2026-09-30").months;
    expect(window).toHaveLength(12);
    expect(savingsRateOf(ctx, window)).toMatchObject({ label: "Säästöaste, viimeiset 12 kuukautta" });
    expect(savingsRateOf(ctx, window).rate).toBeCloseTo(0.1, 10);
    // 900 € taken out of savings in one month: 12 x 300 - 900 = 2 700 of 36 000
    const drawn = ctxOf([...base, tx({ bookingDate: "2026-03-10", amountCents: 90000, category: "investments", merchant: "Nordnet" })]);
    expect(savingsRateOf(drawn, window).rate).toBeCloseTo(0.075, 10);
  });

  it("the overview names a single month only when the history covers it, so a partial month has no rate", () => {
    const young = ctxOf(base, "2026-08-15");
    expect(buildDashboard(young, { from: "2026-08-01", to: "2026-08-31" }).bridge).toMatchObject({ basis: "range", month: null });
    expect(buildDashboard(young, { from: "2026-09-01", to: "2026-09-30" }).bridge).toMatchObject({ basis: "range", month: "2026-09" });
  });

  it("the cashflow row of a partial or running month has no rate", () => {
    const young = ctxOf(base, "2026-08-15");
    const rows = cashflowReport(young, { from: "2026-08-01", to: "2026-10-31" }).rows;
    expect(rows.map((r) => [r.month, r.complete, r.savingsRate === null ? null : Math.round(r.savingsRate * 100)])).toEqual([
      ["2026-08", false, null],
      ["2026-09", true, 10],
      ["2026-10", false, null],
    ]);
  });

  it("Tilanne names the window of the rate and of the debt share", () => {
    const window = yearWindow(ctx, "2026-09-30").months;
    const facts = situationOf(ctx, window, [], NO_INPUTS);
    const rate = facts.find((f) => f.id === "savings_rate")!;
    expect(rate.label).toBe("Säästöaste, viimeiset 12 kuukautta");
    expect(rate.value).toBeCloseTo(0.1, 10);
    expect(facts.find((f) => f.id === "debt_share")!.label).toBe("Velanhoito tuloista, viimeiset 6 kuukautta");
    // two complete months are too few to judge, and a partial month is not one of them
    const few = situationOf(ctx, ["2026-08", "2026-09"], [], NO_INPUTS).find((f) => f.id === "savings_rate")!;
    expect(few).toMatchObject({ value: null, label: "Säästöaste, viimeiset 2 kuukautta" });
    const partial = situationOf(ctxOf(base, "2026-08-15"), ["2026-08", "2026-09", "2026-10"], [], NO_INPUTS).find((f) => f.id === "savings_rate")!;
    expect(partial.value).toBeNull();
  });
});

describe("credit drawn is the net of the window and never below zero", () => {
  it("a month that paid credit back shows nothing drawn, in the row that the table and the CSV read", () => {
    const ctx = ctxOf([...base, draw("2026-07-12", 80000), draw("2026-08-12", -50000), draw("2026-09-12", 20000)]);
    const rows = cashflowReport(ctx, { from: "2026-07-01", to: "2026-09-30" }).rows;
    expect(rows.map((r) => r.borrowedCents)).toEqual([80000, 0, 20000]);
    // the row's money stays whole: the repayment is still in Yli jäi
    expect(rows[1]!.leftCents).toBe(300000 - 105000 - 30000 - 50000);
  });

  it("the insight counts the draws but tells the net, and says nothing when the net is a repayment", () => {
    const ctx = ctxOf([...base, draw("2026-08-05", 80000), draw("2026-08-20", 40000), draw("2026-08-28", -50000)]);
    const borrowed = buildDashboard(ctx, { from: "2026-08-01", to: "2026-08-31" }).insights.find((i) => i.id === "borrowed")!;
    expect(borrowed.yearlyCents).toBe(70000);
    expect(borrowed.title).toContain("700");
    expect(borrowed.detail).toContain("2 nostoa");
    const repaid = ctxOf([...base, draw("2026-08-05", 20000), draw("2026-08-28", -50000)]);
    expect(buildDashboard(repaid, { from: "2026-08-01", to: "2026-08-31" }).insights.find((i) => i.id === "borrowed")).toBeUndefined();
  });
});
