import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { addDays, addMonths } from "../src/dates.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account, BalanceInput, Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

// test helpers put every transaction on account "acc-1"
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

/** A household with a year of history: salary, rent and groceries. */
function dataset(): Transaction[] {
  return [
    ...series("2025-09-25", 30.44, 13, 300000, { category: "salary", merchant: "Acme Oy" }),
    ...series("2025-09-02", 30.44, 13, -105000, { category: "housing", merchant: "Sato Oyj" }),
    ...series("2025-09-01", 3.5, 115, (i) => -(2000 + (i % 7) * 900), { category: "groceries", merchant: "K-Market" }),
  ].filter((t) => t.bookingDate <= today);
}

/** `count` charges on day `day` of consecutive months from `firstMonth`. */
function monthlyOn(firstMonth: string, day: number, count: number, amount: number, partial: Partial<Transaction>): Transaction[] {
  return Array.from({ length: count }, (_, i) => tx({ ...partial, bookingDate: `${addMonths(firstMonth, i)}-${String(day).padStart(2, "0")}`, amountCents: amount }));
}

const reports = (rows: Transaction[], range: { from: string; to: string }, accounts: Account[] = [checking]) =>
  buildReports({ ctx: createContext(rows, accounts, today), range, balances: [] });

describe("no average from a running month", () => {
  it("category and pivot averages are null inside the running month", () => {
    const r = reports(dataset(), { from: "2026-10-01", to: today });
    const stats = r.categories.groups.flatMap((g) => g.categories);
    expect(stats.length).toBeGreaterThan(0);
    for (const s of stats) {
      expect([s.monthlyAvgCents, s.medianMonthCents, s.minMonthCents, s.maxMonthCents]).toEqual([null, null, null, null]);
    }
    expect(r.pivot.rows.every((row) => row.averageCents === null)).toBe(true);
    expect(r.pivot.averageCents).toBeNull();
  });

  it("the totals stay numbers: only the averages leave", () => {
    const r = reports(dataset(), { from: "2026-10-01", to: today });
    expect(r.categories.totalCents).toBeGreaterThan(0);
    expect(r.pivot.totalCents).toBe(r.categories.totalCents);
  });

  it("a range with one complete month averages that month only", () => {
    const r = reports(dataset(), { from: "2026-09-01", to: today });
    const housing = r.categories.groups.flatMap((g) => g.categories).find((c) => c.category === "housing")!;
    expect(housing).toMatchObject({ monthlyAvgCents: 105000, medianMonthCents: 105000, minMonthCents: 105000, maxMonthCents: 105000 });
    expect(r.pivot.rows.find((row) => row.category === "housing")!.averageCents).toBe(105000);
  });

  it("a history that starts mid-month has no average for that month either", () => {
    const young = dataset().filter((t) => t.bookingDate >= "2026-09-15");
    const r = reports(young, { from: "2026-09-01", to: "2026-09-30" });
    expect(r.categories.groups.flatMap((g) => g.categories).every((c) => c.monthlyAvgCents === null)).toBe(true);
    expect(r.pivot.averageCents).toBeNull();
  });

  it("the three-month trend needs six complete months", () => {
    const rows = monthlyOn("2026-04", 10, 6, -10000, { category: "groceries", merchant: "K-Market" });
    const short = reports(rows, { from: "2026-04-01", to: "2026-09-30" }).categories.groups[0]!.categories[0]!;
    // the history starts on 10 April, so April is not a complete month
    expect(short.trend).toBeNull();
    const long = reports(dataset(), { from: "2026-04-01", to: "2026-09-30" }).categories.groups.flatMap((g) => g.categories).find((c) => c.category === "housing")!;
    expect(long.trend).toBe(0);
  });
});

describe("pivot flags and what a share is of", () => {
  it("marks the first month of a history that starts mid-month and the running month as incomplete", () => {
    const rows = dataset().filter((t) => t.bookingDate >= "2025-09-15");
    const p = reports(rows, { from: "2025-09-01", to: today }).pivot;
    expect(p.months[0]).toBe("2025-09");
    expect(p.months.at(-1)).toBe("2026-10");
    expect(p.complete).toHaveLength(p.months.length);
    expect(p.complete[0]).toBe(false);
    expect(p.complete.at(-1)).toBe(false);
    expect(p.complete.slice(1, -1).every(Boolean)).toBe(true);
  });

  it("a range that starts on the 15th leaves its first month incomplete although the history covers it", () => {
    const p = reports(dataset(), { from: "2026-08-15", to: "2026-09-30" }).pivot;
    expect(p.months).toEqual(["2026-08", "2026-09"]);
    expect(p.complete).toEqual([false, true]);
  });

  it("each group has its share of spending and of income", () => {
    const r = reports(dataset(), { from: "2026-09-01", to: "2026-09-30" }).categories;
    expect(r.incomeCents).toBe(300000);
    const housing = r.groups.find((g) => g.group === "Asuminen")!;
    expect(housing.share).toBeCloseTo(105000 / r.totalCents, 10);
    expect(housing.incomeShare).toBeCloseTo(105000 / 300000, 10);
    expect(housing.categories[0]!.incomeShare).toBeCloseTo(0.35, 10);
  });

  it("the share of income is null for a range without income", () => {
    const r = reports(dataset().filter((t) => t.category !== "salary"), { from: "2026-09-01", to: "2026-09-30" }).categories;
    expect(r.incomeCents).toBe(0);
    expect(r.groups.every((g) => g.incomeShare === null && g.categories.every((c) => c.incomeShare === null))).toBe(true);
  });
});

describe("nothing from fewer than three comparable months", () => {
  /** Groceries every third day from `start` to today: a history that starts exactly there. */
  const since = (start: string) => series(start, 3, 600, -3000, { category: "groceries", merchant: "K-Market" }).filter((t) => t.bookingDate <= today);
  const yoy = (start: string, to = "2026-09-30") => reports(since(start), { from: "2026-01-01", to }).yearOverYear;

  it("one comparable month is not a comparison", () => {
    const y = yoy("2025-09-01");
    expect(y.comparableFromMonth).toBe(9);
    expect(y.comparableMonths).toBe(1);
    expect(y.comparable).toBe(false);
  });

  it("two months are not enough, three are", () => {
    expect(yoy("2025-08-01")).toMatchObject({ comparableFromMonth: 8, comparableMonths: 2, comparable: false });
    expect(yoy("2025-07-01")).toMatchObject({ comparableFromMonth: 7, comparableMonths: 3, comparable: true });
    expect(yoy("2025-01-01")).toMatchObject({ comparableFromMonth: 1, comparableMonths: 9, comparable: true });
  });

  it("a month that is not over does not count", () => {
    // September and the running October are not three whole months
    expect(yoy("2025-08-01", today)).toMatchObject({ comparableMonths: 2, comparable: false });
    expect(yoy("2025-07-01", today)).toMatchObject({ comparableMonths: 3, comparable: true });
    // a range that stops on the 20th cuts September
    expect(yoy("2025-07-01", "2026-09-20")).toMatchObject({ comparableMonths: 2, comparable: false });
  });

  it("a history that starts mid-month leaves that month out", () => {
    expect(yoy("2025-07-15")).toMatchObject({ comparableFromMonth: 8, comparableMonths: 2, comparable: false });
  });

  it("no last year at all is not comparable", () => {
    expect(yoy("2026-03-01")).toMatchObject({ comparableFromMonth: null, comparableMonths: 0, comparable: false });
  });
});

describe("drift says what it checked", () => {
  /** Groceries every third day, 100 euros a month at a price of 1000 cents, from `start` to `end`. */
  const groceries = (start: string, end: string, price: number | ((day: string) => number)) =>
    series(start, 3, 400, -1000, { category: "groceries", merchant: "K-Market" })
      .filter((t) => t.bookingDate <= end)
      .map((t) => ({ ...t, amountCents: -(typeof price === "number" ? price : price(t.bookingDate)) }));
  const drift = (rows: Transaction[], now: string) => buildReports({ ctx: createContext(rows, [checking], now), range: { from: "2025-01-01", to: now }, balances: [] }).drift;

  it("a short history judges nothing and names the day the check starts", () => {
    const r = drift(groceries("2026-06-01", today, 1000), today);
    expect(r.months).toEqual([]);
    expect(r.checked).toBe(0);
    expect(r.neededMonths).toBe(9);
    // June to February are nine complete months
    expect(r.readyFrom).toBe("2027-03-01");
  });

  it("the check runs on the day it named and not the day before", () => {
    const rows = groceries("2026-06-01", "2027-03-01", 1000);
    expect(drift(rows, "2027-02-28").months).toEqual([]);
    const ready = drift(rows, "2027-03-01");
    expect(ready.months).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(ready.readyFrom).toBe("2027-03-01");
  });

  it("a history that starts after the 3rd leaves its first month out of the nine", () => {
    expect(drift(groceries("2026-06-15", today, 1000), today).readyFrom).toBe("2027-04-01");
  });

  it("a quiet history says how many categories it compared", () => {
    const r = drift(groceries("2025-06-01", today, 1000), today);
    expect(r.months).toHaveLength(3);
    expect(r.items).toEqual([]);
    expect(r.checked).toBe(1);
    expect(r.advice).toBe("");
  });

  it("a rise is told with its yearly cost and no closing advice", () => {
    const r = drift(groceries("2025-06-01", today, (day) => (day >= "2026-07-01" ? 2200 : 1000)), today);
    expect(r.items.map((i) => i.category)).toEqual(["groceries"]);
    expect(r.advice).toMatch(/^Ruokakauppa on ollut kolme kuukautta peräkkäin tavallista kalliimpi\. Jos taso pysyy, se maksaa .+ vuodessa\.$/);
  });
});

describe("data quality: savings out of sight, missing balances, quiet cards", () => {
  const range = { from: "2026-08-01", to: today };
  const savings: Account = { id: "sav-1", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
  const card: Account = { id: "card-1", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" };
  const signals = (rows: Transaction[], accounts: Account[] = [checking], balances: BalanceInput[] = []) => {
    const ctx = createContext(rows, accounts, today);
    return { ctx, signals: buildReports({ ctx, range, balances }).dataQuality.signals };
  };
  const find = (list: { id: string }[], id: string) => list.find((s) => s.id === id) as { id: string; detail: string; title: string; cents?: number } | undefined;
  const balance = (account: Account, balanceCents: number | null, ownerName: string | null = null): BalanceInput => ({ id: account.id, name: account.name, type: account.type, balanceCents, ownerName, balanceAt: null });

  describe("own_unconnected", () => {
    const funds = [
      ...series("2025-09-06", 30.44, 14, -20000, { category: "investments", merchant: "Nordnet" }),
      ...series("2025-09-08", 30.44, 14, -5000, { category: "pension", merchant: "Elo" }),
    ];

    it("is the saved flow of the savings rows that are not transfers", () => {
      // a connected savings account: the transfer into it is saved too, and not out of sight
      const connected = [
        tx({ bookingDate: "2026-09-10", amountCents: -30000, category: "transfer", isTransfer: true, merchant: "Säästötili" }),
        tx({ bookingDate: "2026-09-10", amountCents: 30000, category: "transfer", isTransfer: true, accountId: "sav-1", merchant: "Käyttötili" }),
      ];
      const { ctx, signals: found } = signals([...dataset(), ...funds, ...connected], [checking, savings]);
      const expected = ctx.txs.filter((t) => !t.isTransfer && t.flows.saved !== 0 && t.bookingDate >= range.from && t.bookingDate <= range.to).reduce((s, t) => s + t.flows.saved, 0);
      // August, September and October of both series
      expect(expected).toBe(3 * 20000 + 3 * 5000);
      const signal = find(found, "own_unconnected")!;
      expect(signal.cents).toBe(expected);
      expect(signal.title).toContain("säästöjä meni tilille, jota ei ole yhdistetty");
      // the largest payee first
      expect(signal.detail.indexOf("Nordnet")).toBeGreaterThan(-1);
      expect(signal.detail.indexOf("Nordnet")).toBeLessThan(signal.detail.indexOf("Elo"));
    });

    it("is not told for a household that saves only into connected accounts", () => {
      const connected = [
        tx({ bookingDate: "2026-09-10", amountCents: -30000, category: "transfer", isTransfer: true }),
        tx({ bookingDate: "2026-09-10", amountCents: 30000, category: "transfer", isTransfer: true, accountId: "sav-1" }),
      ];
      expect(find(signals([...dataset().filter((t) => t.category !== "investments"), ...connected], [checking, savings]).signals, "own_unconnected")).toBeUndefined();
    });

    it("is not told when more came out of the savings than went in", () => {
      const sold = tx({ bookingDate: "2026-09-12", amountCents: 900000, category: "investments", merchant: "Nordnet" });
      expect(find(signals([...dataset(), sold]).signals, "own_unconnected")).toBeUndefined();
    });

    it("counts the range only", () => {
      const { signals: found } = signals(funds);
      // August to 9 October: three Nordnet rows and three pension rows
      const inRange = funds.filter((t) => t.bookingDate >= range.from && t.bookingDate <= range.to);
      expect(find(found, "own_unconnected")!.cents).toBe(inRange.reduce((s, t) => s - t.amountCents, 0));
    });
  });

  describe("no_balance", () => {
    it("names the own checking and savings accounts without a balance", () => {
      const found = signals(dataset(), [checking, savings], [balance(checking, null), balance(savings, null)]).signals;
      expect(find(found, "no_balance")!.title).toBe("2 tilin saldoa ei tiedetä: Käyttötili ja Säästötili");
      const one = signals(dataset(), [checking], [balance(checking, null)]).signals;
      expect(find(one, "no_balance")!.title).toBe("Tilin Käyttötili saldoa ei tiedetä");
    });

    it("is quiet when the balances are known, for cards and for accounts of other members", () => {
      expect(find(signals(dataset(), [checking], [balance(checking, 123456)]).signals, "no_balance")).toBeUndefined();
      expect(find(signals(dataset(), [checking, card], [balance(checking, 123456), balance(card, null)]).signals, "no_balance")).toBeUndefined();
      expect(find(signals(dataset(), [checking], [balance(checking, 123456), balance(savings, null, "Laura")]).signals, "no_balance")).toBeUndefined();
      expect(find(signals(dataset()).signals, "no_balance")).toBeUndefined();
    });
  });

  describe("a quiet account", () => {
    /** Eleven card rows on consecutive days (a card needs ten dates to be judged), the last `quiet` days before today. */
    const cardRows = (quiet: number) => series(addDays(today, -quiet - 10), 1, 11, -2500, { accountId: "card-1", category: "groceries", merchant: "K-Market" });

    it("a card is stale after 21 days", () => {
      expect(find(signals([...dataset(), ...cardRows(21)], [checking, card]).signals, "stale")).toBeUndefined();
      const stale = find(signals([...dataset(), ...cardRows(22)], [checking, card]).signals, "stale")!;
      expect(stale.title).toContain("Nordea Gold");
    });

    it("a checking account is still stale after 7 days", () => {
      const quietChecking = (quiet: number) => series(addDays(today, -quiet - 10), 1, 11, -2500, { category: "groceries", merchant: "K-Market" });
      expect(find(signals(quietChecking(7)).signals, "stale")).toBeUndefined();
      expect(find(signals(quietChecking(8)).signals, "stale")).toBeDefined();
    });
  });
});
