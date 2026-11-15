/**
 * The figures of Yhteenveto (`overview.ts`): the month's income is the figure the income report gives for the month, its
 * earned part beside it. Made-up households only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { earnedIncome, monthIncome } from "../src/analysis/usual.ts";
import { buildOverview } from "../src/overview.ts";
import { buildReports } from "../src/reports/index.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { BalanceInput, Loan, UserInputs } from "../src/types.ts";
import { ACCOUNTS, randomHistory } from "./gen.ts";
import { tx } from "./helpers.ts";

const ON = "2025-10-20";
const input = (id: string, name: string, type: BalanceInput["type"], balanceCents: number | null): BalanceInput => ({ id, name, type, balanceCents, ownerName: null, balanceAt: null });
const inputsOf = (loans: Loan[]): UserInputs => ({ marks: [], expectedBills: [], loans });

function household(seed: number) {
  const { txs, accounts, rules } = randomHistory(seed, 400, { settled: true });
  const ctx = createContext(enrichTransactions(txs, accounts, rules), accounts, ON);
  // the loan account has no rows, so the walk knows it only from today on: it has no balance here
  const balances = ACCOUNTS.map((a) => input(a.id, a.name, a.type, a.type === "credit_card" ? -45_000 : a.type === "loan" ? null : 250_000));
  return { ctx, balances };
}

describe("the tiles' figures", () => {
  it("the income of the month is all of its income, and its earned part is the income of the earned rows", () => {
    const { ctx, balances } = household(5);
    const { income } = buildDashboard(ctx, { from: "2025-10-01", to: "2025-10-31" }, balances, inputsOf([])).overview;
    expect(income).toEqual({ cents: monthIncome(ctx, "2025-10"), earnedCents: earnedIncome(ctx, "2025-10") });
    expect(income).not.toHaveProperty("usualCents");
  }, 30_000);

  it("the income table of the income report reads the same two figures as the tile, for the same month", () => {
    const { ctx, balances } = household(5);
    const { income } = buildDashboard(ctx, { from: "2025-10-01", to: "2025-10-31" }, balances, inputsOf([])).overview;
    const month = buildReports({ ctx, range: { from: "2025-10-01", to: "2025-10-31" }, balances: [] }, ["income"]).income.months.find((m) => m.month === "2025-10")!;
    expect({ cents: month.totalCents, earnedCents: month.earnedCents }).toEqual(income);
  }, 30_000);

  describe("a month of made-up rows", () => {
    const pay = { merchant: "Acme Oy", counterparty: "Acme Oy", category: "salary", categorySource: "rule" as const };
    const refund = { merchant: "Verohallinto", counterparty: "Verohallinto", category: "tax_refund", categorySource: "rule" as const };
    const tileOf = (rows: ReturnType<typeof tx>[]) => {
      const ctx = createContext(rows, [{ id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" }], ON);
      const tile = buildOverview(ctx).income;
      const month = buildReports({ ctx, range: { from: "2025-10-01", to: "2025-10-31" }, balances: [] }, ["income"]).income.months.find((m) => m.month === "2025-10")!;
      return { tile, month };
    };

    it("a month with only unearned income shows that income, and no earned part", () => {
      const { tile, month } = tileOf([tx({ ...refund, bookingDate: "2025-10-08", amountCents: 50_000 })]);
      expect(tile).toEqual({ cents: 50_000, earnedCents: 0 });
      expect(month.totalCents).toBe(tile.cents);
      expect(month.earnedCents).toBe(tile.earnedCents);
    });

    it("a negative adjustment lowers the income and its earned part by what was taken back", () => {
      const { tile, month } = tileOf([
        tx({ ...pay, bookingDate: "2025-10-05", amountCents: 300_000 }),
        tx({ ...pay, bookingDate: "2025-10-09", amountCents: -20_000 }),
        tx({ ...refund, bookingDate: "2025-10-08", amountCents: 50_000 }),
      ]);
      expect(tile.cents).toBe(330_000);
      expect(tile.earnedCents).toBe(280_000);
      expect(month.totalCents).toBe(tile.cents);
      expect(month.earnedCents).toBe(tile.earnedCents);
    });
  });

  it("the running month's bars are the Menot and Tulot tiles' figures, and the months are twelve at most, oldest first", () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const { ctx, balances } = household(seed);
      const data = buildDashboard(ctx, { from: "2025-10-01", to: ON }, balances, inputsOf([]));
      const { months, income } = data.overview;
      const last = months.at(-1)!;
      if (last.month !== "2025-10" || last.complete) problems.push(`${seed}: the last month is ${JSON.stringify(last)}`);
      if (last.spendCents !== data.totals.expenseCents) problems.push(`${seed}: spent ${last.spendCents} against the bridge's ${data.totals.expenseCents}`);
      if (last.incomeCents !== income.cents) problems.push(`${seed}: income ${last.incomeCents} against the tile's ${income.cents}`);
      if (months.length > 12 || months.some((m, i) => i > 0 && m.month <= months[i - 1]!.month)) problems.push(`${seed}: months ${months.map((m) => m.month).join(",")}`);
    }
    expect(problems).toEqual([]);
  }, 30_000);

  it("the categories are the six largest of the month, largest first, and with the rest add up to the month's spending", () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const { ctx, balances } = household(seed);
      const { categories, months } = buildDashboard(ctx, { from: "2025-10-01", to: ON }, balances, inputsOf([])).overview;
      const { rows, otherCents, totalCents } = categories;
      if (rows.length > 6 || rows.some((r, i) => r.cents <= 0 || (i > 0 && r.cents > rows[i - 1]!.cents))) problems.push(`${seed}: rows ${JSON.stringify(rows)}`);
      if (rows.reduce((sum, r) => sum + r.cents, 0) + otherCents !== totalCents + categories.fromSavingsCents || totalCents !== months.at(-1)!.spendCents) problems.push(`${seed}: ${totalCents} does not add up`);
    }
    expect(problems).toEqual([]);
  }, 30_000);
});
