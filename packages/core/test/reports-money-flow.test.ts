import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { totalsOf } from "../src/analysis/flows.ts";
import { inDays } from "../src/analysis/context.ts";
import { toDayRange } from "../src/analysis/period.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account } from "../src/types.ts";
import { dataset, monthlyOn } from "./report-dataset.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };

const flowOf = (ctx: ReturnType<typeof createContext>, range: { from: string; to: string }) => buildReports({ ctx, range, balances: [] }, ["moneyFlow"]).moneyFlow;

describe("Tulot ja menot: where the money came from and went", () => {
  it("both sides are equal on the demo-like household, over several ranges", () => {
    const ctx = createContext(dataset(), [checking], "2026-10-09");
    for (const range of [
      { from: "2026-01-01", to: "2026-09-30" },
      { from: "2026-09-01", to: "2026-09-30" },
      { from: "2025-10-01", to: "2026-10-09" },
    ]) {
      const f = flowOf(ctx, range);
      expect(f.sources.reduce((s, b) => s + b.cents, 0)).toBe(f.totalCents);
      expect(f.uses.reduce((s, b) => s + b.cents, 0)).toBe(f.totalCents);
      expect([...f.sources, ...f.uses].every((b) => b.cents > 0)).toBe(true);
    }
  });

  it("a period that took more than its income is paid for by the credit and savings drawn, and stays equal", () => {
    const rows = [
      ...monthlyOn("2026-01", 25, 3, () => 300000, { category: "salary", merchant: "Acme Oy" }),
      ...monthlyOn("2026-01", 2, 3, () => -150000, { category: "housing", merchant: "Sato Oyj" }),
      ...monthlyOn("2026-01", 10, 3, () => -200000, { category: "groceries", merchant: "K-Market" }),
      tx({ bookingDate: "2026-02-12", amountCents: 80000, category: "credit_draw", merchant: "Lainanostaja" }),
      tx({ bookingDate: "2026-03-12", amountCents: 50000, category: "investments", merchant: "Nordnet" }),
    ];
    const ctx = createContext(rows, [checking], "2026-04-15");
    const range = { from: "2026-01-01", to: "2026-03-31" };
    const f = flowOf(ctx, range);
    const totals = totalsOf(inDays(ctx, toDayRange(range)).map((x) => x.flows));
    const source = (id: string) => f.sources.find((b) => b.id === id)?.cents ?? 0;
    expect(source("credit")).toBe(80000);
    expect(source("savings")).toBe(50000);
    expect(source("earned")).toBe(totals.incomeCents);
    expect(f.uses.find((b) => b.id === "category:housing")?.cents).toBe(450000);
    expect(f.sources.reduce((s, b) => s + b.cents, 0)).toBe(f.uses.reduce((s, b) => s + b.cents, 0));
    // the consumption bands are the period's consumption, whole
    expect(f.uses.filter((b) => b.kind === "spending").reduce((s, b) => s + b.cents, 0)).toBe(totals.consumptionCents);
  });
});
