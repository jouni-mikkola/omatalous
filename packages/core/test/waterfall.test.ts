import { describe, expect, it } from "vitest";
import { type AnalysisContext, createContext } from "../src/analysis/context.ts";
import { NAMED_CATEGORIES } from "../src/analysis/category-totals.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const accounts: Account[] = [
  { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" },
  { id: "acc-2", name: "Säästötili", iban: null, currency: "EUR", type: "savings" },
];
const today = "2026-10-09";
/** The waterfall the dashboard gives for a range. */
const dashboardWaterfall = (c: AnalysisContext, range: { from: string; to: string }) => buildDashboard(c, range).waterfall;
const monthOnly = (c: AnalysisContext, month: string) => dashboardWaterfall(c, { from: `${month}-01`, to: `${month}-28` });
const bar = (w: ReturnType<typeof dashboardWaterfall>, key: string) => w?.bars.find((b) => b.key === key)?.cents;
const sum = (w: NonNullable<ReturnType<typeof dashboardWaterfall>>) => w.bars.reduce((n, b) => n + b.cents, 0);
const by = (category: string, bookingDate: string, amountCents: number, more: Partial<Transaction> = {}) => tx({ category, bookingDate, amountCents, categorySource: "rule", merchant: `ESIMERKKI ${category}`, ...more });

/** September: pay, eight kinds of spending, an unknown payment each way, savings, a transfer to the savings account, credit drawn. */
const september: Transaction[] = [
  by("salary", "2026-09-25", 300000),
  by("housing", "2026-09-02", -105000),
  by("groceries", "2026-09-03", -40000),
  by("groceries", "2026-09-12", -15000),
  by("transport", "2026-09-04", -9000),
  by("restaurants", "2026-09-05", -8000),
  by("health", "2026-09-06", -7000),
  by("shopping", "2026-09-07", -6000),
  by("entertainment", "2026-09-08", -5000),
  by("fees", "2026-09-09", -2000),
  by("other", "2026-09-10", -2500, { categorySource: "default" }),
  by("income", "2026-09-11", 1000, { categorySource: "default" }),
  by("investments", "2026-09-06", -30000),
  by("transfer", "2026-09-13", -20000, { isTransfer: true }),
  by("transfer", "2026-09-13", 20000, { isTransfer: true, accountId: "acc-2" }),
  by("credit_draw", "2026-09-14", 10000),
];
const ctx = createContext(september, accounts, today);

describe("the month waterfall", () => {
  it("adds up to the table's Yli jäi, with savings and credit as a bar of their own", () => {
    const w = monthOnly(ctx, "2026-09")!;
    expect(w.leftCents).toBe(cashflowReport(ctx, { from: "2026-09-01", to: "2026-09-30" }).totals.leftCents);
    expect(sum(w)).toBe(w.leftCents);
    // the money in the default called other income is income, as the table counts it
    expect(bar(w, "income")).toBe(301000);
    // savings (30 000) and the money landing on the savings account (20 000) leave Yli jäi; the credit drawn is in it
    expect(bar(w, "transfers")).toBe(-30000 - 20000 + 10000);
    // nine categories, all named: the unclassified payment is the category Muut menot, in the order of the category table
    expect(w.bars.map((b) => b.key)).toEqual(["income", "category:housing", "category:groceries", "category:transport", "category:restaurants", "category:health", "category:shopping", "category:entertainment", "category:other", "category:fees", "transfers"]);
    expect(bar(w, "category:other")).toBe(-2500);
    expect(bar(w, "category:groceries")).toBe(-55000);
  });

  it("tells the month with the figures of the table under it: Tulot, Menot, a loan payment and an unclassified row included", () => {
    const rows = [...september, by("loans", "2026-09-15", -45000), by("other", "2026-09-16", -1500, { categorySource: "default" })];
    const c = createContext(rows, accounts, today);
    const range = { from: "2026-09-01", to: "2026-09-30" };
    const { totals, categories } = buildDashboard(c, range);
    const w = dashboardWaterfall(c, range)!;
    expect(bar(w, "income")).toBe(totals.incomeCents);
    const spending = w.bars.filter((b) => b.key.startsWith("category:") || b.key === "other");
    expect(-spending.reduce((n, b) => n + b.cents, 0)).toBe(totals.expenseCents);
    // the loan payment is spending, the savings are not
    expect(bar(w, "category:loans")).toBe(-45000);
    expect(bar(w, "transfers")).toBe(-30000 - 20000 + 10000);
    expect(sum(w)).toBe(totals.incomeCents - totals.expenseCents + bar(w, "transfers")!);
    // the same grouping as the category table: the nine largest, the rest as one bar that counts them
    expect(w.bars.filter((b) => b.key.startsWith("category:")).map((b) => b.key.slice(9))).toEqual(categories.slice(0, NAMED_CATEGORIES).map((x) => x.category));
    expect(bar(w, "other")).toBe(-categories.slice(NAMED_CATEGORIES).reduce((n, x) => n + x.cents, 0));
    expect(w.bars.find((b) => b.key === "other")?.count).toBe(categories.length - NAMED_CATEGORIES);
  });

  it("a card bill read off its statement counts as the table counts it, in the month of the purchases and in the month of the bill", () => {
    const cards: Account[] = [{ id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" }, { id: "card", name: "Esimerkki Kortti", iban: null, currency: "EUR", type: "credit_card" }];
    const bill = tx({ id: "bill", accountId: "chk", bookingDate: "2026-03-10", amountCents: -42000, category: "card_bill", merchant: "ESIMERKKI KORTTI", counterparty: "ESIMERKKI KORTTI", categorySource: "rule" });
    const rows = [{ id: "r1", day: "2026-02-03", cents: 6150, text: "K-MARKET ESIMERKKI", category: "groceries" }, { id: "r2", day: "2026-02-09", cents: 8000, text: "ESIMERKKI POLTTOAINE", category: "car" }, { id: "r3", day: "2026-02-20", cents: 15000, text: "VERKKOKAUPPA ESIMERKKI", category: "shopping" }];
    const pay = (id: string, bookingDate: string) => tx({ id, accountId: "chk", bookingDate, amountCents: 300000, category: "salary", categorySource: "rule", merchant: "ESIMERKKI TYÖNANTAJA OY" });
    const c = createContext([pay("p1", "2026-02-25"), pay("p2", "2026-03-25"), bill], cards, "2026-04-01", undefined, [], [], [{ billId: "bill", periodFrom: "2026-02-01", periodTo: "2026-02-28", rows }]);
    const spent = { "2026-02": 6150 + 8000 + 15000, "2026-03": 42000 - (6150 + 8000 + 15000) };
    for (const month of ["2026-02", "2026-03"] as const) {
      const range = { from: `${month}-01`, to: `${month}-28` };
      const { totals } = buildDashboard(c, range);
      const w = dashboardWaterfall(c, range)!;
      expect(totals.expenseCents).toBe(spent[month]);
      expect(bar(w, "income")).toBe(totals.incomeCents);
      expect(-w.bars.filter((b) => b.key.startsWith("category:") || b.key === "other").reduce((n, b) => n + b.cents, 0)).toBe(totals.expenseCents);
      expect(w.leftCents).toBe(totals.leftCents);
      expect(sum(w)).toBe(w.leftCents);
    }
  });

  it("counts only the days of the range: a row booked after today or before the range's first day is not in the sentence", () => {
    const rows = [by("salary", "2026-10-02", 100000), by("groceries", "2026-10-03", -5000), by("groceries", "2026-10-25", -80000)];
    const c = createContext(rows, accounts, today);
    for (const range of [{ from: "2026-10-01", to: today }, { from: "2026-10-03", to: today }, { from: "2026-10-01", to: "2026-10-31" }]) {
      const { totals } = buildDashboard(c, range);
      const w = dashboardWaterfall(c, range)!;
      expect(bar(w, "income")).toBe(totals.incomeCents);
      expect(-w.bars.filter((b) => b.key.startsWith("category:")).reduce((n, b) => n + b.cents, 0)).toBe(totals.expenseCents);
      expect(w.leftCents).toBe(totals.leftCents);
    }
    expect(bar(dashboardWaterfall(c, { from: "2026-10-01", to: today }), "category:groceries")).toBe(-5000);
    expect(bar(dashboardWaterfall(c, { from: "2026-10-03", to: today }), "income")).toBe(0);
  });

  it("a row the household classified changes no sum: the same payments with a rule add up the same", () => {
    const classified = september.map((t) => (t.category === "other" || t.category === "income" ? { ...t, categorySource: "rule" as const } : t));
    const w = monthOnly(createContext(classified, accounts, today), "2026-09")!;
    expect(sum(w)).toBe(w.leftCents);
    expect(bar(w, "income")).toBe(301000);
    expect(bar(w, "category:other")).toBe(-2500);
  });

  it("a refund lowers its category and the sum rule still holds", () => {
    const withRefund = [...september, by("shopping", "2026-09-20", 6000, { merchant: "ESIMERKKI shopping" })];
    const w = monthOnly(createContext(withRefund, accounts, today), "2026-09")!;
    expect(sum(w)).toBe(w.leftCents);
    expect(w.leftCents).toBe(monthOnly(ctx, "2026-09")!.leftCents + 6000);
    // the refund took the purchase back: the category nets to nothing and the refund is no income
    expect(bar(w, "category:shopping")).toBeUndefined();
    expect(bar(w, "income")).toBe(301000);
  });

  it("is null for a month with no rows and for a range after today; a long range ends in today's month", () => {
    expect(monthOnly(ctx, "2026-08")).toBeNull();
    expect(dashboardWaterfall(ctx, { from: "2026-11-01", to: "2026-11-30" })).toBeNull();
    expect(dashboardWaterfall(ctx, { from: "2026-08-01", to: "2026-08-31" })).toBeNull();
    // a range running past today: today's month (October has no rows here), a range ending in September: September
    expect(dashboardWaterfall(ctx, { from: "2026-09-01", to: "2026-12-31" })).toBeNull();
    expect(dashboardWaterfall(ctx, { from: "2026-07-01", to: "2026-09-30" })?.month).toBe("2026-09");
  });

  it("a month with pay alone has income as its only bar", () => {
    const w = monthOnly(createContext([by("salary", "2026-09-25", 300000)], accounts, today), "2026-09")!;
    expect(w.bars).toEqual([{ key: "income", cents: 300000, parts: [{ key: "payee:ESIMERKKI salary", cents: 300000 }] }]);
    expect(w.leftCents).toBe(300000);
  });
});

describe("what a bar is made of", () => {
  const parts = (w: NonNullable<ReturnType<typeof dashboardWaterfall>>, key: string) => w.bars.find((b) => b.key === key)!.parts.map((p) => [p.key, p.cents, p.count]);
  const addsUp = (w: NonNullable<ReturnType<typeof dashboardWaterfall>>) => {
    for (const b of w.bars) expect(b.parts.reduce((n, p) => n + p.cents, 0)).toBe(b.cents);
  };

  it("adds every bar's parts up to the bar, in a month with savings, credit drawn and an unclassified row", () => {
    addsUp(monthOnly(ctx, "2026-09")!);
  });

  it("lists a category's payees largest first, eight at most, the rest as one row with its count", () => {
    const shops = Array.from({ length: 11 }, (_, i) => by("groceries", "2026-09-03", -(1000 + i * 100), { merchant: `ESIMERKKI KAUPPA ${i + 1}` }));
    const w = monthOnly(createContext([by("salary", "2026-09-25", 300000), ...shops, by("groceries", "2026-09-04", -500, { merchant: "ESIMERKKI KAUPPA 11" })], accounts, today), "2026-09")!;
    const list = w.bars.find((b) => b.key === "category:groceries")!.parts;
    expect(list).toHaveLength(9);
    expect(list.slice(0, 3).map((p) => p.key)).toEqual(["payee:ESIMERKKI KAUPPA 11", "payee:ESIMERKKI KAUPPA 10", "payee:ESIMERKKI KAUPPA 9"]);
    // the eleventh shop was paid at twice: one payee, 2 000 + 500
    expect(list[0]!.cents).toBe(-2500);
    expect(list[8]).toEqual({ key: "rest", cents: -(1000 + 1100 + 1200), count: 3 });
    addsUp(w);
  });

  it("nets a refund into its payee: the payee shows what is left, a payee that nets to nothing is not listed", () => {
    const rows = [by("salary", "2026-09-25", 300000), by("shopping", "2026-09-02", -6000, { merchant: "ESIMERKKI A" }), by("shopping", "2026-09-03", -9000, { merchant: "ESIMERKKI B" }), by("shopping", "2026-09-04", 9000, { merchant: "ESIMERKKI B" }), by("shopping", "2026-09-05", 2000, { merchant: "ESIMERKKI A" })];
    const w = monthOnly(createContext(rows, accounts, today), "2026-09")!;
    expect(parts(w, "category:shopping")).toEqual([["payee:ESIMERKKI A", -4000, undefined]]);
    addsUp(w);
  });

  it("lists the payers of income, and what the rest of the spending folds as its categories", () => {
    const rows = [by("salary", "2026-09-25", 250000, { merchant: "ESIMERKKI OY" }), by("salary", "2026-09-26", 50000, { merchant: "ESIMERKKI OY" }), by("income", "2026-09-11", 1000, { merchant: "MATTI MEIKALAINEN", categorySource: "default" })];
    const small = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"].map((x, i) => by(`${x}`, "2026-09-05", -(100 + i), { merchant: `ESIMERKKI ${x}` }));
    const w = monthOnly(createContext([...rows, ...small], accounts, today), "2026-09")!;
    expect(parts(w, "income")).toEqual([["payee:ESIMERKKI OY", 300000, undefined], ["payee:MATTI MEIKALAINEN", 1000, undefined]]);
    const other = w.bars.find((b) => b.key === "other")!;
    expect(other.parts).toHaveLength(other.count!);
    expect(other.parts.every((p) => p.key.startsWith("category:"))).toBe(true);
    addsUp(w);
  });

  it("splits savings and credit into what was saved and what was drawn", () => {
    const w = monthOnly(ctx, "2026-09")!;
    expect(parts(w, "transfers")).toEqual([["saved", -50000, undefined], ["borrowed", 10000, undefined]]);
    // a refund of the savings account's money back (a drawn saving) is a plus on saved
    const back = monthOnly(createContext([...september, by("transfer", "2026-09-20", -5000, { isTransfer: true, accountId: "acc-2" })], accounts, today), "2026-09")!;
    expect(parts(back, "transfers")).toEqual([["saved", -45000, undefined], ["borrowed", 10000, undefined]]);
    addsUp(back);
  });

  it("has no part for a read card statement: its purchases are spending in their month and the bill leaves nothing in the transfers", () => {
    const cards: Account[] = [{ id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" }, { id: "card", name: "Esimerkki Kortti", iban: null, currency: "EUR", type: "credit_card" }];
    const bill = tx({ id: "bill", accountId: "chk", bookingDate: "2026-03-10", amountCents: -42000, category: "card_bill", merchant: "ESIMERKKI KORTTI", counterparty: "ESIMERKKI KORTTI", categorySource: "rule" });
    const rows = [{ id: "r1", day: "2026-02-03", cents: 6150, text: "K-MARKET ESIMERKKI", category: "groceries" }, { id: "r2", day: "2026-02-09", cents: 8000, text: "ESIMERKKI POLTTOAINE", category: "car" }, { id: "r3", day: "2026-02-20", cents: 15000, text: "VERKKOKAUPPA ESIMERKKI", category: "shopping" }];
    const pay = (id: string, bookingDate: string) => tx({ id, accountId: "chk", bookingDate, amountCents: 300000, category: "salary", categorySource: "rule", merchant: "ESIMERKKI TYÖNANTAJA OY" });
    const c = createContext([pay("p1", "2026-02-25"), pay("p2", "2026-03-25"), bill], cards, "2026-04-01", undefined, [], [], [{ billId: "bill", periodFrom: "2026-02-01", periodTo: "2026-02-28", rows }]);
    const feb = dashboardWaterfall(c, { from: "2026-02-01", to: "2026-02-28" })!;
    expect(feb.bars.some((b) => b.key === "transfers")).toBe(false);
    addsUp(feb);
    const mar = dashboardWaterfall(c, { from: "2026-03-01", to: "2026-03-28" })!;
    addsUp(mar);
    expect(mar.bars.some((b) => b.key === "transfers")).toBe(false);
  });
});
