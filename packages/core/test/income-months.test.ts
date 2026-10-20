import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { addMonths } from "../src/dates.ts";
import { incomeReport } from "../src/reports/income.ts";
import type { Account, Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

// The Tulot table reads the months the page chose, the same ones Tulot ja menot draws.
const TODAY = "2026-10-18";
const ACCOUNTS: Account[] = [
  { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" },
  { id: "card-1", name: "Kortti", iban: null, currency: "EUR", type: "credit_card" },
];
const pay = { merchant: "Työnantaja Oy", counterparty: "Työnantaja Oy", category: "salary", categorySource: "rule" as const };
const rows: Transaction[] = [
  ...series("2024-10-01", 2, 330, -2500, { merchant: "Ruokakauppa", category: "groceries", categorySource: "rule" }),
  ...Array.from({ length: 24 }, (_, i) => tx({ ...pay, bookingDate: `${addMonths("2024-10", i)}-15`, amountCents: 300_000 })),
  // a bonus on 10.9. that Mikä muuttui tells
  tx({ ...pay, merchant: "Toinen Oy", counterparty: "Toinen Oy", description: "PALKKIO", bookingDate: "2026-09-10", amountCents: 619_000 }),
  // a card that joined in mid-September: its first month is not a complete one
  ...series("2026-09-12", 3, 12, -1500, { accountId: "card-1", merchant: "Kahvila", category: "restaurants", categorySource: "rule" }),
];
const ctx = createContext(rows, ACCOUNTS, TODAY);

describe("income months", () => {
  it("12 kk from October to September gives the twelve rows October to September", () => {
    const r = incomeReport(ctx, { from: "2025-10-01", to: "2026-09-30" });
    expect(r.months.map((m) => m.month)).toEqual(Array.from({ length: 12 }, (_, i) => addMonths("2025-10", i)));
    expect(r.window).toEqual({ from: "2025-10-01", to: "2026-09-30" });
    const september = r.months.find((m) => m.month === "2026-09")!;
    expect(september.totalCents).toBe(300_000 + 619_000);
    expect(r.months.reduce((s, m) => s + m.totalCents, 0)).toBe(12 * 300_000 + 619_000);
  });

  it("3 kk gives three rows", () => {
    const r = incomeReport(ctx, { from: "2026-07-01", to: "2026-09-30" });
    expect(r.months.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(r.earnedCents).toBe(3 * 300_000 + 619_000);
  });

  it("this year runs to the month in progress", () => {
    const r = incomeReport(ctx, { from: "2026-01-01", to: TODAY });
    expect(r.months.map((m) => m.month)).toEqual(Array.from({ length: 10 }, (_, i) => addMonths("2026-01", i)));
    expect(r.months.at(-1)!.complete).toBe(false);
  });
});
