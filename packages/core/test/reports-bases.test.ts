import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account } from "../src/types.ts";
import { dataset } from "./report-dataset.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

describe("report bases", () => {
  const ctx = createContext(dataset(), [checking], today);
  const range = { from: "2026-01-01", to: "2026-09-30" };

  it("Menot and Tulot of Raportit have two named bases that reconcile: the complete months, and the whole period", () => {
    // the second range holds the running month, so one month is partial
    for (const to of [range.to, today]) {
      const w = buildReports({ ctx, range: { from: range.from, to }, balances: [] }, ["cashflowMonths", "income", "figureParts", "categories", "moneyFlow"]);
      const name = `to ${to}`;
      const tiles = w.cashflowMonths.completeTotals!;
      const complete = new Set(w.cashflowMonths.months.filter((m) => m.complete).map((m) => m.month));
      // the Tulot tile is the income report's months, the complete ones of Tulot ja menot
      expect(tiles.incomeCents, name).toBe(w.income.months.filter((m) => complete.has(m.month)).reduce((s, m) => s + (m.totalCents ?? 0), 0));
      // and the income side of Rahan lähteet ja käyttö
      expect(tiles.incomeCents, name).toBe(w.moneyFlow.sources.filter((b) => b.id === "earned" || b.id === "other_income").reduce((s, b) => s + b.cents, 0));
      // the Menot tile is the complete part of the panel; Kaikki menot of Menot kategorioittain is that and what the tile leaves out
      const parts = w.figureParts;
      expect(tiles.spendCents, name).toBe(parts.cashflowSpend!.cents);
      expect(parts.categorySpend.cents, name).toBe(w.categories.totalCents);
      expect(parts.categorySpend.completeMonthsCents, name).toBe(tiles.spendCents);
      expect(parts.categorySpend.otherCents, name).toBe(0);
      expect(w.categories.totalCents, name).toBe(tiles.spendCents + parts.categorySpend.partialMonths.reduce((s, m) => s + m.cents, 0) + parts.categorySpend.fromSavingsCents);
    }
  });
});
