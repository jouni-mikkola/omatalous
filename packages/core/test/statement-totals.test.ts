import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import type { StatementBill } from "../src/analysis/statement-explain.ts";
import { summaryReport } from "../src/reports/summary.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

/**
 * With a card statement read, the page's spending total and its categories are one sum: a purchase of February is in
 * February's "Menot" and in its categories, whenever the bill that paid it was booked.
 */
const checking: Account = { id: "chk", name: "Käyttötili", holder: "Matti Meikalainen", iban: null, currency: "EUR", type: "checking" };
const savings: Account = { id: "sav", name: "Säästötili", holder: "Matti Meikalainen", iban: null, currency: "EUR", type: "savings" };
const rows: StatementBill["rows"] = [
  { id: "r1", day: "2026-02-03", cents: 6150, text: "K-MARKET ESIMERKKI", category: "groceries" },
  { id: "r2", day: "2026-02-09", cents: 8000, text: "ESIMERKKI POLTTOAINE", category: "car" },
  { id: "r3", day: "2026-02-20", cents: 15000, text: "VERKKOKAUPPA ESIMERKKI", category: "shopping" },
];
const salary = (day: string) => tx({ accountId: "chk", bookingDate: day, amountCents: 300_000, merchant: "Acme Oy", category: "salary" });
const txs: Transaction[] = [
  salary("2026-02-25"),
  salary("2026-03-25"),
  tx({ id: "ruoka", accountId: "chk", bookingDate: "2026-02-05", amountCents: -10000, merchant: "Prisma", category: "groceries" }),
  tx({ id: "bill", accountId: "chk", bookingDate: "2026-03-10", amountCents: -42000, category: "card_bill", merchant: "ESIMERKKI KORTTI", counterparty: "ESIMERKKI KORTTI" }),
  // an own transfer to savings: saved, both legs
  tx({ id: "to-sav", accountId: "chk", bookingDate: "2026-02-06", amountCents: -20000, merchant: "Oma siirto", category: "transfer", isTransfer: true }),
  tx({ id: "in-sav", accountId: "sav", bookingDate: "2026-02-06", amountCents: 20000, merchant: "Oma siirto", category: "transfer", isTransfer: true }),
];
const statement: StatementBill = { billId: "bill", periodFrom: "2026-02-01", periodTo: "2026-02-28", rows };
const ctxOf = (list: StatementBill[]) => createContext(txs, [checking, savings], "2026-04-01", undefined, [], [], list);
const month = (m: string, end = "28") => ({ from: `${m}-01`, to: `${m}-${end}` });
const sum = (xs: readonly { cents: number }[]) => xs.reduce((n, x) => n + x.cents, 0);

describe("the spending total is the sum of its categories", () => {
  const ctx = ctxOf([statement]);

  it("February's Menot holds the purchases of the statement, March's only what the bill leaves", () => {
    const feb = buildDashboard(ctx, month("2026-02"));
    // 100.00 of Ruoka on the 5th and the three rows of the statement: the bill is not in February
    expect(feb.totals.expenseCents).toBe(10000 + 29150);
    expect(sum(feb.categories)).toBe(feb.totals.expenseCents);
    expect(feb.categories.find((c) => c.category === "groceries")!.cents).toBe(16150);
    const mar = buildDashboard(ctx, month("2026-03", "31"));
    expect(mar.totals.expenseCents).toBe(12850);
    expect(sum(mar.categories)).toBe(12850);
    // net and saved follow the same days: the salary is cash, the saved transfer is February's
    expect(feb.totals).toMatchObject({ incomeCents: 300_000, savedCents: 20000, netCents: 300_000 - 39150 });
    expect(mar.totals).toMatchObject({ incomeCents: 300_000, savedCents: 0, netCents: 300_000 - 12850 });
    expect(feb.previousTotals.expenseCents).toBe(0);
  });

  it("the summary's totals and its categories come from the same rows", () => {
    const feb = summaryReport(ctx, month("2026-02"));
    expect(feb).toMatchObject({ spendingCents: 39150, savedCents: 20000, netCents: 300_000 - 39150 });
    expect(sum(feb.topCategories)).toBe(16150 + 15000 + 8000);
    expect(feb.spendingCents).toBeGreaterThanOrEqual(sum(feb.topCategories));
    expect(summaryReport(ctx, month("2026-03", "31")).spendingCents).toBe(12850);
  });

  it("no euro is counted twice or lost over the months, and a bill without rows counts whole in its own month", () => {
    const whole = ctxOf([]);
    const all = { from: "2026-01-01", to: "2026-04-30" };
    expect(buildDashboard(ctx, all).totals).toEqual(buildDashboard(whole, all).totals);
    expect(buildDashboard(whole, month("2026-03", "31")).totals.expenseCents).toBe(42000);
    expect(buildDashboard(whole, month("2026-02")).totals.expenseCents).toBe(10000);
  });

  it("in every month Menot is at least its categories and is them when every row has a category", () => {
    for (const list of [[], [statement]]) {
      const c = ctxOf(list);
      for (const m of ["2026-01", "2026-02", "2026-03", "2026-04"]) {
        const d = buildDashboard(c, { from: `${m}-01`, to: `${m}-28` });
        expect(d.totals.expenseCents, m).toBeGreaterThanOrEqual(sum(d.categories));
        expect(d.totals.expenseCents, m).toBe(sum(d.categories));
        const s = summaryReport(c, { from: `${m}-01`, to: `${m}-28` });
        expect(s.spendingCents, m).toBeGreaterThanOrEqual(sum(s.topCategories));
      }
    }
  });
});
