/**
 * Yli jäi is what stayed on the accounts (ADR 0014). `totalsOf` owns the sum, and these tests hold it against the rows
 * themselves: what the rows of a period did to the balances, with no flow in between. Borrowed money is in the sum and
 * is never income, and `coverOf` says how a period that took more than its income was paid for.
 */
import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold, seededHousehold } from "../../../tools/findings/households.ts";
import { type AnalysisContext, createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { coverOf, type PeriodTotals, totalsOf } from "../src/analysis/flows.ts";
import { CATEGORIES, getCategory } from "../src/categories.ts";
import { addDays, addMonths, monthEnd, monthOf } from "../src/dates.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import type { Account, Transaction } from "../src/types.ts";
import { rng } from "./gen.ts";
import { tx } from "./helpers.ts";
import { CREDIT_DRAWN_CENTS, creditDrawn } from "./kit/events/credit-drawn.ts";
import { KIT_TODAY, kitHousehold } from "./kit/index.ts";

/**
 * What the rows of a period did to the accounts, counted from the rows alone: the change of every balance that is not
 * a loan's (a card's balance is what is owed on it), less the transfer legs that have no other half in the period (a
 * pair cancels itself in the sum), less what moved into savings accounts, which is Säästöön.
 */
function stayed(ctx: AnalysisContext, from: string, to: string): number {
  const type = new Map(ctx.accounts.map((a) => [a.id, a.type]));
  const change = new Map<string, number>();
  let legs = 0;
  let intoSavings = 0;
  for (const t of ctx.txs) {
    if (t.bookingDate < from || t.bookingDate > to) continue;
    change.set(t.accountId, (change.get(t.accountId) ?? 0) + t.amountCents);
    // a loan account mirrors the payments made from checking
    if (type.get(t.accountId) === "loan") continue;
    if (t.isTransfer || (getCategory(t.category).kind === "transfer" && t.category !== "credit_draw")) legs += t.amountCents;
    if (t.isTransfer && type.get(t.accountId) === "savings") intoSavings += t.amountCents;
  }
  const balances = [...change].reduce((s, [id, cents]) => (type.get(id) === "loan" ? s : s + cents), 0);
  return balances - legs - intoSavings;
}

const HOUSEHOLDS = [demoHousehold(), ...[1, 2, 3, 4, 5].flatMap((seed) => [seededHousehold(seed, false), seededHousehold(seed, true)]), kitHousehold(null), kitHousehold(creditDrawn)];

describe("totals: Yli jäi is what stayed on the accounts", () => {
  it.each(HOUSEHOLDS.map((h) => [h.name, h] as const))("%s: every month, the whole history and the bridge say the change of the balances", (_, h) => {
    const ctx = contextOf(h);
    const from = ctx.dataFrom!;
    const cash = cashflowReport(ctx, { from, to: h.today });
    expect(cash.totals.leftCents, "whole history").toBe(stayed(ctx, from, h.today));
    for (const row of cash.rows) {
      const first = `${row.month}-01`;
      const last = monthEnd(row.month);
      expect(row.leftCents, row.month).toBe(stayed(ctx, first < from ? from : first, last > h.today ? h.today : last));
    }
    // the month page of the latest month that has ended: its totals and the bridge under them
    const month = cash.rows.filter((r) => r.complete).at(-1)!.month;
    const d = buildDashboard(ctx, { from: `${month}-01`, to: monthEnd(month) });
    expect(d.totals.leftCents, month).toBe(stayed(ctx, `${month}-01`, monthEnd(month)));
    expect(d.bridge.totals.leftCents, month).toBe(d.totals.leftCents);
  });

  it("the kit household that drew a credit: the month of the car is covered with credit, and what stayed of the credit is in Yli jäi", () => {
    const ctx = contextOf(kitHousehold(creditDrawn));
    const month = addMonths(monthOf(KIT_TODAY), -2);
    const range = { from: `${month}-01`, to: monthEnd(month) };
    const before = buildDashboard(contextOf(kitHousehold(null)), range).totals;
    const totals = buildDashboard(ctx, range).totals;
    // the payout is borrowed and no income, and the car is spending
    expect(totals).toMatchObject({ borrowedCents: CREDIT_DRAWN_CENTS, incomeCents: before.incomeCents, consumptionCents: before.consumptionCents + 650_000 });
    expect(totals.leftCents).toBe(before.leftCents + CREDIT_DRAWN_CENTS - 650_000);
    expect(totals.leftCents).toBe(stayed(ctx, range.from, range.to));
    const cover = coverOf(totals);
    expect(cover.gapCents).toBeGreaterThan(0);
    expect(cover).toMatchObject({ creditCents: cover.gapCents, savingsCents: 0, accountsCents: 0, creditDrawnCents: CREDIT_DRAWN_CENTS, creditLeftCents: totals.leftCents });
    // the instalments of the months after are debt service, never credit paid back
    const next = buildDashboard(ctx, { from: `${addMonths(month, 1)}-01`, to: monthEnd(addMonths(month, 1)) }).totals;
    expect(next).toMatchObject({ borrowedCents: 0, debtCents: buildDashboard(contextOf(kitHousehold(null)), { from: `${addMonths(month, 1)}-01`, to: monthEnd(addMonths(month, 1)) }).totals.debtCents + 21_500 });
  });

  const TYPES: Account["type"][] = ["checking", "savings", "credit_card", "loan", "other"];
  const END = "2026-10-09";

  it.each(Array.from({ length: 20 }, (_, i) => i + 1))("random rows on every kind of account, credit drawn among them, seed %i", (seed) => {
    const r = rng(seed);
    const accounts: Account[] = TYPES.map((type, i) => ({ id: `a${i}`, name: type, iban: null, currency: "EUR", type }));
    const rows = Array.from({ length: 300 }, () => {
      const category = r() < 0.15 ? "credit_draw" : CATEGORIES[Math.floor(r() * CATEGORIES.length)]!.id;
      return tx({ accountId: accounts[Math.floor(r() * accounts.length)]!.id, bookingDate: addDays(END, -Math.floor(r() * 200)), amountCents: (r() < 0.7 ? -1 : 1) * (1 + Math.floor(r() * 250_000)), category, isTransfer: r() < 0.1 });
    });
    const ctx = createContext(rows, accounts, END);
    expect(ctx.txs.some((t) => t.flows.borrowed !== 0)).toBe(true);
    for (let k = 0; k < 6; k++) {
      const from = addDays(END, -Math.floor(r() * 200));
      const to = addDays(from, Math.floor(r() * 120));
      const totals = totalsOf(ctx.txs.filter((t) => t.bookingDate >= from && t.bookingDate <= to).map((t) => t.flows));
      expect(totals.leftCents, `${from}..${to}`).toBe(stayed(ctx, from, to));
      expect(totals.leftCents).toBe(totals.incomeCents + totals.borrowedCents - totals.expenseCents - totals.savedCents);
    }
  });
});

const chk: Account = { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const sav: Account = { id: "sav", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };

const on = (day: number, amountCents: number, category: string, extra: Partial<Transaction> = {}) => tx({ accountId: "chk", bookingDate: `2026-09-${String(day).padStart(2, "0")}`, amountCents, category, ...extra });
const pay = () => on(15, 300_000, "salary", { merchant: "Acme Oy" });
const credit = (cents: number) => on(16, cents, "credit_draw", { merchant: "Autorahoitus Oy" });
const dealer = (cents: number) => on(17, -cents, "car", { merchant: "Autoliike Oy" });
/** Money moved from the savings account to checking: both legs are transfers, and the savings side counts. */
const fromSavings = (cents: number) => [on(10, -cents, "transfer", { accountId: "sav", isTransfer: true }), on(10, cents, "transfer", { isTransfer: true })];

/** September as the month page and the cash flow report tell it. */
function september(rows: Transaction[]) {
  const ctx = createContext(rows, [chk, sav], "2026-10-09");
  const totals = buildDashboard(ctx, SEPTEMBER).totals;
  const cash = cashflowReport(ctx, SEPTEMBER);
  // one owner: the report's row and its totals are the month page's figure
  expect(cash.rows.map((x) => x.leftCents)).toEqual([totals.leftCents]);
  expect(cash.totals).toEqual(totals);
  expect(totals.leftCents).toBe(stayed(ctx, SEPTEMBER.from, SEPTEMBER.to));
  return { totals, cover: coverOf(totals) };
}

describe("totals and the cover of a gap: borrowed money is told as borrowed", () => {
  it("pay 3 000, a credit of 20 000 and a car for 13 000: 10 000 stayed, and credit paid the 10 000 the pay did not", () => {
    const { totals, cover } = september([pay(), credit(2_000_000), dealer(1_300_000)]);
    expect(totals.leftCents).toBe(1_000_000);
    expect(totals).toMatchObject({ incomeCents: 300_000, borrowedCents: 2_000_000, consumptionCents: 1_300_000, netCents: -1_000_000 });
    expect(cover).toEqual({ neededCents: 1_300_000, gapCents: 1_000_000, creditCents: 1_000_000, savingsCents: 0, accountsCents: 0, creditDrawnCents: 2_000_000, creditLeftCents: 1_000_000, savingsDrawnCents: 0, savingsLeftCents: 0, creditRepaidCents: 0 });
  });

  it("the same car with no credit: the accounts fell by 10 000 and paid the gap", () => {
    const { totals, cover } = september([pay(), dealer(1_300_000)]);
    expect(totals.leftCents).toBe(-1_000_000);
    expect(cover).toMatchObject({ gapCents: 1_000_000, creditCents: 0, savingsCents: 0, accountsCents: 1_000_000, creditDrawnCents: 0 });
  });

  it("savings drawn and credit in one month: credit is counted first, savings pay the rest and what is over stays", () => {
    const { totals, cover } = september([pay(), credit(500_000), ...fromSavings(400_000), dealer(1_000_000)]);
    expect(totals).toMatchObject({ savedCents: -400_000, borrowedCents: 500_000, leftCents: 200_000 });
    expect(cover).toMatchObject({ gapCents: 700_000, creditCents: 500_000, savingsCents: 200_000, accountsCents: 0, creditDrawnCents: 500_000, creditLeftCents: 0, savingsDrawnCents: 400_000, savingsLeftCents: 200_000 });
  });

  it("a credit drawn and paid back inside the month: the pay stayed, and the payment is debt service", () => {
    const { totals, cover } = september([pay(), credit(2_000_000), on(28, -2_000_000, "loans", { merchant: "Autorahoitus Oy" })]);
    expect(totals).toMatchObject({ leftCents: 300_000, debtCents: 2_000_000, borrowedCents: 2_000_000, incomeCents: 300_000 });
    expect(cover).toMatchObject({ gapCents: 1_700_000, creditCents: 1_700_000, savingsCents: 0, accountsCents: 0, creditDrawnCents: 2_000_000, creditLeftCents: 300_000 });
  });

  it("a household that borrowed nothing has the sum it had: income less spending and saving, and no gap to cover", () => {
    const { totals, cover } = september([pay(), on(2, -105_000, "housing"), on(6, -30_000, "investments"), on(20, -4_000, "interest")]);
    expect(totals.leftCents).toBe(300_000 - 105_000 - 4_000 - 30_000);
    expect(totals.netCents - totals.savedCents).toBe(totals.leftCents);
    expect(cover).toEqual({ neededCents: 139_000, gapCents: 0, creditCents: 0, savingsCents: 0, accountsCents: 0, creditDrawnCents: 0, creditLeftCents: 0, savingsDrawnCents: 0, savingsLeftCents: 0, creditRepaidCents: 0 });
  });

  it.each(Array.from({ length: 30 }, (_, i) => i + 1))("where the money came from is where it went, to the cent, seed %i", (seed) => {
    const r = rng(seed * 31);
    const cents = (max: number, negative = 0.1) => (r() < 0.2 ? 0 : (r() < negative ? -1 : 1) * Math.floor(r() * max));
    for (let k = 0; k < 200; k++) {
      const t: PeriodTotals = totalsOf([{ income: cents(600_000), consumption: cents(900_000), debt: cents(200_000, 0.02), saved: cents(300_000, 0.4), borrowed: cents(2_500_000, 0.05) }]);
      const c = coverOf(t);
      const label = JSON.stringify(t);
      for (const v of Object.values(c)) expect(Number.isInteger(v) && (v >= 0 || v === c.neededCents), label).toBe(true);
      // the one sum of the bridge: income, credit, savings and the accounts paid for what was needed and what stayed
      expect(t.incomeCents + c.creditDrawnCents + c.savingsDrawnCents + c.accountsCents, label).toBe(c.neededCents + Math.max(0, t.leftCents));
      expect(c.neededCents, label).toBe(t.consumptionCents + t.debtCents + Math.max(0, t.savedCents) + c.creditRepaidCents);
      expect(c.creditDrawnCents - c.creditRepaidCents, label).toBe(t.borrowedCents);
      expect(Math.max(0, t.savedCents) - c.savingsDrawnCents, label).toBe(t.savedCents);
      // the gap is covered once: by credit, by savings and by the accounts, none of them by more than there was
      expect(c.creditCents + c.savingsCents + c.accountsCents, label).toBe(c.gapCents);
      expect(c.gapCents, label).toBe(Math.max(0, c.neededCents - t.incomeCents));
      expect(c.creditCents, label).toBeLessThanOrEqual(c.creditDrawnCents);
      expect(c.savingsCents, label).toBeLessThanOrEqual(c.savingsDrawnCents);
      expect(c.accountsCents, label).toBe(Math.max(0, -t.leftCents));
      // the order is credit, then savings: credit covers all it can, and savings only what credit left
      expect(c.creditCents, label).toBe(Math.min(c.gapCents, c.creditDrawnCents));
      expect(c.savingsCents, label).toBe(Math.min(c.gapCents - c.creditCents, c.savingsDrawnCents));
      // the owner gives what the drawn money left, so no view subtracts: drawn money that paid no gap stayed on the accounts
      expect(c.creditLeftCents, label).toBe(c.creditDrawnCents - c.creditCents);
      expect(c.savingsLeftCents, label).toBe(c.savingsDrawnCents - c.savingsCents);
      if (c.gapCents > 0) expect(Math.max(0, t.leftCents), label).toBe(c.creditLeftCents + c.savingsLeftCents);
    }
  });
});
