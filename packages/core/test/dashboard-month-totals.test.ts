import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

/**
 * The first page tells the spending of a month twice: as the figure "Menot" and as the last point of the chart "Menojen
 * kertymä". They are one sum, whatever the month holds, so the page can show both and add nothing itself.
 */
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const savings: Account = { id: "acc-2", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
const today: IsoDate = "2026-10-12";

const buy = (bookingDate: IsoDate, cents: number, partial: Partial<Transaction> = {}) => tx({ bookingDate, amountCents: -cents, merchant: "Prisma", category: "groceries", ...partial });

/** September whole, October to the 12th: a salary, purchases, a refund, a loan payment and an own transfer to savings. */
const rows = [
  tx({ bookingDate: "2026-09-25", amountCents: 300_000, merchant: "Acme Oy", category: "salary" }),
  buy("2026-09-03", 12_000),
  buy("2026-09-20", 8_000),
  tx({ bookingDate: "2026-10-05", amountCents: 300_000, merchant: "Acme Oy", category: "salary" }),
  buy("2026-10-02", 10_000),
  buy("2026-10-09", 4_500),
  // a refund of part of the purchase on the 2nd
  tx({ bookingDate: "2026-10-10", amountCents: 2_500, merchant: "Prisma", category: "groceries" }),
  // the payment of a loan is spending too: debt service
  buy("2026-10-11", 90_000, { merchant: "Esimerkkipankki Oyj", category: "mortgage" }),
  // an own transfer to the savings account, both legs: neither is spending nor income
  tx({ bookingDate: "2026-10-06", amountCents: -20_000, merchant: "Oma siirto", category: "transfer", isTransfer: true }),
  tx({ bookingDate: "2026-10-06", amountCents: 20_000, accountId: "acc-2", merchant: "Oma siirto", category: "transfer", isTransfer: true }),
];
const ctx = createContext(rows, [checking, savings], today);

describe("the month's spending is one sum", () => {
  it("in the running month `totals.expenseCents` is the last point of the running curve of `pace`", () => {
    const d = buildDashboard(ctx, { from: "2026-10-01", to: today });
    const running = d.pace.current.filter((v): v is number => v !== null);
    // 100 + 45 + 900 less the refund of 25, in cents
    expect(d.totals.expenseCents).toBe(10_000 + 4_500 + 90_000 - 2_500);
    expect(d.totals.expenseCents).toBe(running.at(-1));
    expect(d.totals.expenseCents).toBe(d.pace.currentTotal);
    // the salary is income and the transfer is neither: they are in no sum of spending
    expect(d.totals.incomeCents).toBe(300_000);
  });

  it("holds for the whole month asked for before it has ended, and the curve stops at today", () => {
    const d = buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" });
    expect(d.pace.current[11]).toBe(d.totals.expenseCents);
    expect(d.pace.current[12]).toBeNull();
  });

  it("holds for a month that has ended: the whole curve ends on the figure", () => {
    const d = buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" });
    expect(d.totals.expenseCents).toBe(20_000);
    expect(d.pace.month).toBe("2026-09");
    expect(d.pace.current.at(-1)).toBe(d.totals.expenseCents);
  });

  it("the bars of the largest categories and the rest add up to the month's spending", () => {
    const many = [
      ...rows,
      ...["restaurants", "car", "health", "clothing", "hobbies"].flatMap((category, i) => [
        buy("2026-09-04", 3_000 + 500 * i, { merchant: `Kauppa ${i}`, category }),
        buy("2026-10-04", 2_000 + 900 * i, { merchant: `Kauppa ${i}`, category }),
      ]),
    ];
    const d = buildDashboard(createContext(many, [checking, savings], today), { from: "2026-10-01", to: today });
    expect(d.top.rows).toHaveLength(5);
    // the page prints the name as it comes: an English reader got the Finnish one
    const english = buildDashboard(createContext(many, [checking, savings], today), { from: "2026-10-01", to: today }, [], undefined, undefined, "en").top.rows.find((r) => r.category === "groceries")!;
    expect(english.label).toBe("Groceries");
    expect(d.top.rows.find((r) => r.category === "groceries")!.label).toBe("Ruokakauppa");
    expect(d.top.rows.map((r) => r.cents)).toEqual(d.categories.slice(0, 5).map((c) => c.cents));
    expect(d.top.rows.reduce((sum, r) => sum + r.cents, 0) + d.top.otherCents).toBe(d.totals.expenseCents);
    expect(d.top.totalCents).toBe(d.totals.expenseCents);
    expect(d.top.otherCount).toBe(d.categories.length - 5);
    // groceries: 100 + 45 less the refund of 25 by the 12th, against 120 by the 12th of September (the 80 of the 20th is later)
    const groceries = d.top.rows.find((r) => r.category === "groceries")!;
    expect(groceries).toMatchObject({ cents: 12_000, previousCents: 12_000, changeCents: 0 });
    const hobbies = d.top.rows.find((r) => r.category === "hobbies")!;
    expect(hobbies.changeCents).toBe(2_000 + 900 * 4 - (3_000 + 500 * 4));
    // the longest bar is the largest sum drawn, and every mark is on its bar
    expect(Math.max(...d.top.rows.map((r) => r.barShare))).toBe(1);
    for (const r of d.top.rows) expect(r.previousShare!).toBeLessThanOrEqual(1);
  });

  it("a first month has bars and no comparison", () => {
    const d = buildDashboard(createContext([buy("2026-10-03", 5_000)], [checking], today), { from: "2026-10-01", to: today });
    expect(d.top.rows).toEqual([{ category: "groceries", label: d.categories[0]!.label, cents: 5_000, barShare: 1, previousCents: null, changeCents: null, change: null, previousShare: null }]);
    expect(d.top.otherCents).toBe(0);
  });

  it("the words of a change: more, less, the same under a euro, and new", () => {
    const d = buildDashboard(
      createContext(
        [buy("2026-09-03", 12_000), buy("2026-10-02", 12_050), buy("2026-09-04", 3_000, { category: "car" }), buy("2026-10-04", 5_000, { category: "car" }), buy("2026-09-05", 9_000, { category: "health" }), buy("2026-10-05", 4_000, { category: "health" }), buy("2026-10-06", 2_000, { category: "clothing" })],
        [checking],
        today,
      ),
      { from: "2026-10-01", to: today },
    );
    expect(Object.fromEntries(d.top.rows.map((r) => [r.category, r.change]))).toEqual({ groceries: "same", car: "more", health: "less", clothing: "new" });
    for (const r of d.top.rows) expect(r.changeCents).toBe(r.cents - r.previousCents!);
  });

  it("a category with a row on an account the month before lacks has a bar and no comparison", () => {
    const card: Account = { id: "acc-3", name: "Kortti", iban: null, currency: "EUR", type: "credit_card" };
    const d = buildDashboard(
      createContext([...rows, buy("2026-09-04", 3_000, { category: "car" }), buy("2026-10-04", 5_000, { category: "car" }), buy("2026-10-03", 7_000, { accountId: "acc-3" })], [checking, savings, card], today),
      { from: "2026-10-01", to: today },
    );
    const groceries = d.top.rows.find((r) => r.category === "groceries")!;
    // the bar holds the new account's purchase, which September cannot be set against
    expect(groceries).toMatchObject({ cents: 19_000, previousCents: null, changeCents: null, change: null, previousShare: null });
    // a category wholly on the accounts both months have keeps its comparison, and its bar and mark are sums of the same accounts
    expect(d.top.rows.find((r) => r.category === "car")).toMatchObject({ cents: 5_000, previousCents: 3_000, changeCents: 2_000, change: "more" });
  });

  it("a month with no row has the figure 0 and a curve that never leaves it", () => {
    const d = buildDashboard(createContext([buy("2026-08-15", 1_000)], [checking], today), { from: "2026-10-01", to: today });
    expect(d.totals.expenseCents).toBe(0);
    expect(d.pace.currentTotal).toBe(0);
    expect(d.pace.current.filter((v) => v !== null).every((v) => v === 0)).toBe(true);
  });
});
