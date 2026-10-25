/**
 * Edge cases of one definition per figure: the savings rate of complete months only (one helper, the same number on
 * the overview, the cash flow rows and Tilanne), the debt share Tilanne tells with its window, and credit drawn as the
 * net of a period never below zero. A month the history covers in part, a range that cuts a month, a refund of credit
 * (negative net), a pending row, a purchase refund and a twelve-month window. Made-up payees and sums only.
 *
 * A line marked `API: adjust name` guesses a name the change adds: adapt the call there, never the expectation.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import * as bridgeApi from "../src/analysis/bridge.ts";
import * as flowsApi from "../src/analysis/flows.ts";
import { debtShareOf } from "../src/analysis/insights/borrowing.ts";
import { completeMonthsBefore } from "../src/analysis/usual.ts";
import { situationOf } from "../src/optimise/situation.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-16";
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

/**
 * The history starts on 10.3.2026, so March is covered only in part. Each month: pay 3 000 € on the 15th, 500 € set
 * aside on the 20th, a mortgage of 1 300 € on the 12th, groceries. March has an extra 1 000 € set aside, so a rate that
 * reads it differs from the complete months' 1/6.
 */
function household(): Transaction[] {
  const rows = MONTHS.flatMap((m) => [
    tx({ bookingDate: `${m}-${m === "2026-03" ? "10" : "03"}`, amountCents: -6_000, merchant: "K-Market", category: "groceries", categorySource: "rule" }),
    tx({ bookingDate: `${m}-12`, amountCents: -130_000, merchant: "Esimerkki Pankki", description: "ASUNTOLAINA", category: "mortgage", categorySource: "rule" }),
    tx({ bookingDate: `${m}-15`, amountCents: 300_000, merchant: "Esimerkki Oy", description: "PALKKA", category: "salary", categorySource: "rule" }),
    tx({ bookingDate: `${m}-20`, amountCents: -50_000, merchant: "Oma säästö", category: "savings", categorySource: "rule" }),
  ]);
  return [
    ...rows,
    tx({ bookingDate: "2026-03-25", amountCents: -100_000, merchant: "Oma säästö", category: "savings", categorySource: "rule" }),
    // September: a purchase and its refund, and a pending purchase: none of them moves the rate
    tx({ bookingDate: "2026-09-05", amountCents: -4_000, merchant: "Esimerkki Kauppa", category: "shopping", categorySource: "rule" }),
    tx({ bookingDate: "2026-09-09", amountCents: 4_000, merchant: "Esimerkki Kauppa", category: "shopping", categorySource: "rule" }),
    tx({ bookingDate: "2026-09-29", amountCents: -2_500, merchant: "K-Market", category: "groceries", categorySource: "rule", status: "pending" }),
    // June: 500 € of credit drawn and 700 € paid back under the same category, a net of -200 €
    tx({ bookingDate: "2026-06-08", amountCents: 50_000, merchant: "Esimerkki Luotto", category: "credit_draw", categorySource: "rule" }),
    tx({ bookingDate: "2026-06-25", amountCents: -70_000, merchant: "Esimerkki Luotto", category: "credit_draw", categorySource: "user" }),
    // July: two draws of 400 € and 200 €, 100 € paid back, a net of 500 €
    tx({ bookingDate: "2026-07-06", amountCents: 40_000, merchant: "Esimerkki Luotto", category: "credit_draw", categorySource: "rule" }),
    tx({ bookingDate: "2026-07-18", amountCents: 20_000, merchant: "Esimerkki Luotto", category: "credit_draw", categorySource: "rule" }),
    tx({ bookingDate: "2026-07-28", amountCents: -10_000, merchant: "Esimerkki Luotto", category: "credit_draw", categorySource: "user" }),
  ].filter((t) => t.bookingDate <= today);
}

const ctx = createContext(household(), [checking], today);
const monthRange = (m: string) => ({ from: `${m}-01`, to: new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10) });
/** The helper's rate, whether it returns a number or an object that holds one. */
const rateOf = (months: string[]): number | null => {
  const r = (bridgeApi as unknown as { savingsRateOf: (c: typeof ctx, m: string[]) => unknown }).savingsRateOf(ctx, months); // API: adjust name
  return r !== null && typeof r === "object" ? ((r as { rate: number | null }).rate ?? null) : (r as number | null);
};
const SIXTH = 50_000 / 300_000;

describe("savings rate: one helper over complete months", () => {
  it("gives no rate for a month the history covers only in part, nor for the running month", () => {
    expect(rateOf(["2026-03"])).toBeNull();
    expect(rateOf(["2026-10"])).toBeNull();
  });

  it("pools a twelve-month window over its complete months only", () => {
    const year = ["2025-11", "2025-12", "2026-01", "2026-02", ...MONTHS];
    // April to September: the partial March (with its extra 1 000 €) and the running October are left out
    expect(rateOf(year)).toBeCloseTo(SIXTH, 10);
  });

  it("is not moved by a purchase refund or a pending purchase", () => {
    expect(rateOf(["2026-09"])).toBeCloseTo(SIXTH, 10);
  });
});

describe("savings rate on the overview", () => {
  it("tells none for a past month the history covers only in part", () => {
    const { bridge } = buildDashboard(ctx, monthRange("2026-03"));
    // the web tells a rate only for a month with a rate: one of the two must be missing
    expect(bridge.month === null || bridge.totals.savingsRate === null).toBe(true);
  });

  it("near miss: a complete past month has the helper's rate", () => {
    const { bridge } = buildDashboard(ctx, monthRange("2026-09"));
    expect(bridge.month).toBe("2026-09");
    expect(bridge.totals.savingsRate).toBeCloseTo(rateOf(["2026-09"])!, 10);
  });
});

describe("savings rate in the cash flow rows", () => {
  const report = cashflowReport(ctx, { from: "2026-03-01", to: "2026-10-31" });
  const rowOf = (m: string) => report.rows.find((r) => r.month === m)!;

  it("is null for the partial first month and for the running month", () => {
    expect(rowOf("2026-03").complete).toBe(false);
    expect(rowOf("2026-03").savingsRate).toBeNull();
    expect(rowOf("2026-10").savingsRate).toBeNull();
  });

  it("near miss: a complete month has the helper's rate, refund and pending row included", () => {
    expect(rowOf("2026-09").savingsRate).toBeCloseTo(rateOf(["2026-09"])!, 10);
  });

  it("is null for a month the range cuts: the row holds only part of it", () => {
    // found case: a range from the 15th holds the May pay and savings but not its mortgage, so May's row is half a month
    const cut = cashflowReport(ctx, { from: "2026-05-15", to: "2026-07-31" });
    expect(cut.rows.find((r) => r.month === "2026-05")!.savingsRate).toBeNull();
    expect(cut.rows.find((r) => r.month === "2026-06")!.savingsRate).toBeCloseTo(SIXTH, 10);
  });
});

describe("savings rate and debt share in Tilanne", () => {
  const months = completeMonthsBefore(ctx, "2026-10", 12);
  const facts = situationOf(ctx, months, [], NO_INPUTS);
  const fact = (id: string) => facts.find((f) => f.id === id)!;

  it("names its window and tells the helper's rate", () => {
    expect(months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(fact("savings_rate").label).toBe("Säästöaste, viimeiset 6 kuukautta");
    expect(fact("savings_rate").value).toBeCloseTo(rateOf(months)!, 10);
  });

  it("leaves a partial month out of the rate and of the count in its label", () => {
    const withMarch = situationOf(ctx, ["2026-03", ...months], [], NO_INPUTS).find((f) => f.id === "savings_rate")!;
    expect(withMarch.label).toBe("Säästöaste, viimeiset 6 kuukautta");
    expect(withMarch.value).toBeCloseTo(SIXTH, 10);
  });

  it("tells the debt share of the overview's debt finding, with its window", () => {
    expect(fact("debt_share").label).toBe("Velanhoito tavallisista tuloista, viimeiset 6 kuukautta");
    const share = debtShareOf(ctx, today, NO_INPUTS)!;
    expect(fact("debt_share").value).toBeCloseTo(share.debtCents / share.incomeCents, 10);
    const finding = buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" }).insights.find((i) => i.id === "debt");
    expect(finding).toBeDefined();
    const pct = Number(/(\d+)\s%/.exec(finding!.title.replace(/\s/g, " "))![1]);
    expect(fact("debt_share").text.replace(/\s/g, " ")).toBe(`${pct} %`);
  });
});

describe("credit drawn: the net of a period, never below zero", () => {
  const report = cashflowReport(ctx, { from: "2026-03-01", to: "2026-10-31" });

  it("shows no credit drawn in a month that paid back more than it drew", () => {
    expect(report.rows.find((r) => r.month === "2026-06")!.borrowedCents).toBe(0);
  });

  it("near miss: a month that drew more than it paid back shows the net", () => {
    expect(report.rows.find((r) => r.month === "2026-07")!.borrowedCents).toBe(50_000);
  });

  it("agrees with coverOf for each month", () => {
    for (const m of ["2026-06", "2026-07"]) {
      const t = buildDashboard(ctx, monthRange(m)).totals;
      expect(report.rows.find((r) => r.month === m)!.borrowedCents).toBe(flowsApi.coverOf(t).creditDrawnCents);
    }
  });

  it("tells no credit drawn on the overview for June, and the net of July with its two draws", () => {
    expect(buildDashboard(ctx, monthRange("2026-06")).insights.find((i) => i.id === "borrowed")).toBeUndefined();
    const july = buildDashboard(ctx, monthRange("2026-07")).insights.find((i) => i.id === "borrowed")!;
    expect(july.title.replace(/\s/g, " ")).toBe("Luottoa nostettu 500 €");
    expect(july.detail).toMatch(/^2 nostoa /);
  });

  it("over twelve months pools the net, never below zero", () => {
    const t = buildDashboard(ctx, { from: "2025-11-01", to: "2026-10-31" }).totals;
    expect(t.borrowedCents).toBe(30_000);
    expect(flowsApi.coverOf({ ...t, borrowedCents: -20_000 }).creditDrawnCents).toBe(0);
  });
});

describe("labels the brief names in the web files (read as text)", () => {
  const web = (path: string) => readFileSync(new URL(`../../../apps/web/src/${path}`, import.meta.url), "utf8");

  it("names the report's usual income Säännölliset tulot kuussa", () => {
    const income = web("pages/reports/sections/Income.tsx");
    expect(income).toContain("Säännölliset tulot kuussa");
    expect(income).not.toContain("Tavalliset tulot kuukaudessa");
  });
});

// Covers: savingsRateOf over complete months (partial first month, running month, 12-month window, refund, pending row).
// Covers: overview, cash flow rows (incl. a range that cuts a month) and Tilanne read the same rate; Tilanne's two window labels and debt share.
// Covers: credit drawn as max(0, net) in cash flow rows, coverOf and the overview finding (refund of credit, two draws, 12 months); one web label as text.
