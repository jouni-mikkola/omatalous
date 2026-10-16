import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { dataQualityReport } from "../src/analysis/data-quality.ts";
import { type DateRange, previousRange } from "../src/analysis/period.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { categoryReport } from "../src/reports/categories.ts";
import { pivotReport } from "../src/reports/pivot.ts";
import type { Account } from "../src/types.ts";
import { randomHistory } from "./gen.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const expenseOf = (ctx: ReturnType<typeof createContext>, range: DateRange) => cashflowReport(ctx, range).totals.expenseCents;
const row = (bookingDate: string, amountCents: number, category: string, merchant: string) => tx({ bookingDate, amountCents, category, merchant });

describe("the spending of a period is one figure on Raportit", () => {
  const today = "2025-11-15";
  // the first range is longer than the 24 months a table shows
  const ranges: DateRange[] = [
    { from: "2023-01-01", to: today },
    { from: "2025-04-01", to: "2025-06-30" },
    { from: "2025-10-01", to: today },
  ];
  const households = [
    ...Array.from({ length: 12 }, (_, i) => randomHistory(i + 1, 600)),
    ...Array.from({ length: 4 }, (_, i) => randomHistory(i + 1, 1500, { months: 30, settled: true })),
  ];

  it("pivot total, categories total and cashflow expense agree to the cent", () => {
    for (const [i, h] of households.entries()) {
      const ctx = createContext(enrichTransactions(h.txs, h.accounts, h.rules), h.accounts, today);
      for (const range of ranges) {
        const name = `household ${i} from ${range.from} to ${range.to}`;
        const expense = expenseOf(ctx, range);
        const pivot = pivotReport(ctx, range);
        const categories = categoryReport(ctx, range);
        expect(pivot.totalCents, name).toBe(expense);
        expect(categories.totalCents, name).toBe(expense);
        expect(categories.groups.reduce((s, g) => s + g.totalCents, 0), name).toBe(expense);
        // the months shown are the months of the cashflow report
        if (range.from > "2024-01-01") {
          expect(pivot.monthTotals, name).toEqual(cashflowReport(ctx, range).rows.map((r) => r.consumptionCents + r.debtCents));
        }
      }
    }
  }, 60_000);
});

describe("a category with more refunds than spending", () => {
  // A refund comes a month or two after its payment. Dec and Jan: shopping nets -5 000 (spent 4 000, and the 9 000 of
  // November came back); Feb and Mar: it nets -1 000 (spent 8 000, got back the 4 000 of January and 5 000 of February)
  const rows = [
    row("2025-11-20", -1000, "groceries", "K-Market"),
    row("2025-11-25", -9000, "shopping", "Zara"),
    row("2025-12-10", -20000, "groceries", "K-Market"),
    row("2026-01-05", -4000, "shopping", "Zara"),
    row("2026-01-12", -18000, "groceries", "K-Market"),
    row("2026-01-20", 9000, "shopping", "Zara"),
    row("2026-02-03", -21000, "groceries", "K-Market"),
    row("2026-02-10", -5000, "shopping", "Zara"),
    row("2026-02-20", 9000, "shopping", "Zara"),
    row("2026-03-03", -3000, "shopping", "Zara"),
    row("2026-03-17", -19000, "groceries", "K-Market"),
  ];
  const ctx = createContext(rows, [checking], "2026-04-15");
  const range = { from: "2026-02-01", to: "2026-03-31" };

  it("is a row with its minus at the end of the month table, and the months add up", () => {
    const pivot = pivotReport(ctx, range);
    expect(pivot.rows.map((r) => [r.category, r.values, r.totalCents])).toEqual([
      ["groceries", [21000, 19000], 40000],
      ["shopping", [-4000, 3000], -1000],
    ]);
    expect(pivot.monthTotals).toEqual([17000, 22000]);
    expect(pivot.totalCents).toBe(39000);
    expect(pivot.totalCents).toBe(expenseOf(ctx, range));
  });

  it("is a row with its minus last in Kategoriat, and its previous period nets too", () => {
    const report = categoryReport(ctx, range);
    const all = report.groups.flatMap((g) => g.categories);
    expect(all.map((c) => [c.category, c.totalCents, c.previousCents])).toEqual([
      ["groceries", 40000, 38000],
      ["shopping", -1000, -5000],
    ]);
    expect(report.comparable).toBe(true);
    expect(report.totalCents).toBe(39000);
    expect(report.groups.at(-1)!.totalCents).toBe(-1000);
    expect(report.groups.reduce((s, g) => s + g.totalCents, 0)).toBe(report.totalCents);
    expect(report.previousTotalCents).toBe(33000);
    expect(report.previousTotalCents).toBe(expenseOf(ctx, { from: previousRange(range.from, range.to)[0], to: previousRange(range.from, range.to)[1] }));
  });
});

describe("the share of Muut menot", () => {
  it("is the same in Tietojen laatu and in Kategoriat, with refunds taken off", () => {
    // spending 10 000 less 4 000 refunded: 1 000 of the 6 000 is 17 %, where 10 000 as the base gives 10 %
    const ctx = createContext(
      [row("2026-03-02", -9000, "groceries", "K-Market"), row("2026-03-05", -1000, "other", "Tuntematon"), row("2026-03-09", 4000, "groceries", "K-Market")],
      [checking],
      "2026-04-15",
    );
    const range = { from: "2026-03-01", to: "2026-03-31" };
    const other = categoryReport(ctx, range).groups.flatMap((g) => g.categories).find((c) => c.category === "other")!;
    const signal = dataQualityReport(ctx, range).signals.find((s) => s.id === "uncategorised")!;
    expect(other.share).toBeCloseTo(1000 / 6000, 10);
    // the title joins the number and the percent sign with a no-break space
    const title = signal.title.replace(/\s/g, " ");
    expect(title).toBe(`${Math.round(other.share * 100)} % menoista on luokittelematta`);
    expect(title).toBe("17 % menoista on luokittelematta");
  });
});

describe("the share of spending that is not itemised", () => {
  const range = { from: "2026-03-01", to: "2026-03-31" };
  const shareOf = (other: number, bill: number, groceries: number) =>
    cashflowReport(
      createContext([row("2026-03-02", -groceries, "groceries", "K-Market"), row("2026-03-05", -other, "other", "Tuntematon"), row("2026-03-06", -bill, "card_bill", "Visa")], [checking], "2026-04-15"),
      range,
    ).unknownShare;

  it("adds card bills to Muut menot against the spending base", () => {
    // 1 000 + 1 500 of 10 000
    expect(shareOf(1000, 1500, 7500)).toBeCloseTo(0.25, 10);
    // money in, money out: a refund of the groceries takes the base down and the share up
    expect(shareOf(1000, 0, 9000)).toBeCloseTo(0.1, 10);
  });

  it("is zero with no spending", () => {
    const ctx = createContext([row("2026-03-02", 5000, "salary", "Työnantaja")], [checking], "2026-04-15");
    expect(cashflowReport(ctx, range).unknownShare).toBe(0);
  });
});
