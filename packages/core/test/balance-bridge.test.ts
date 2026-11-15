/**
 * Saldot counts its change from the close of the day before the range starts, so the rows of the first day are in it:
 * the sum of the rows from the start to the end is the change to the cent. The bridge of the cash flow lays those
 * same rows in lines (income, consumption, debt, investments out, ...) that add up to the change. Checked on the demo
 * and the seeded households over 3, 6 and 12 months, this year and last, and with made-up sums for the edges.
 */
import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold, type Household, seededHousehold } from "../../../tools/findings/households.ts";
import { createContext } from "../src/analysis/context.ts";
import type { DateRange } from "../src/analysis/period.ts";
import { addDays, addMonths, monthEnd, monthOf } from "../src/dates.ts";
import { balanceReport } from "../src/reports/balances.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import type { Account, BalanceInput, Transaction } from "../src/types.ts";

/** The periods of the page's switch (`periodRange` of the web app): whole months before the running one, and the years. */
const PERIODS: Record<string, (today: string) => DateRange> = {
  "3 months": (today) => ({ from: `${addMonths(monthOf(today), -3)}-01`, to: monthEnd(addMonths(monthOf(today), -1)) }),
  "6 months": (today) => ({ from: `${addMonths(monthOf(today), -6)}-01`, to: monthEnd(addMonths(monthOf(today), -1)) }),
  "12 months": (today) => ({ from: `${addMonths(monthOf(today), -12)}-01`, to: monthEnd(addMonths(monthOf(today), -1)) }),
  "this year": (today) => ({ from: `${today.slice(0, 4)}-01-01`, to: today }),
  "last year": (today) => ({ from: `${Number(today.slice(0, 4)) - 1}-01-01`, to: `${Number(today.slice(0, 4)) - 1}-12-31` }),
};

const households: Household[] = [
  demoHousehold(),
  ...[1, 2, 3, 4, 5].flatMap((seed) => [seededHousehold(seed, false), seededHousehold(seed, true)]),
];

/** The booked rows of the accounts that have a balance, after the day `from` and up to the day `to`, as the bank keeps them. */
function rowsBetween(h: Household, from: string, to: string): Transaction[] {
  const withBalance = new Set(h.balances.filter((b) => b.balanceCents !== null).map((b) => b.id));
  return h.txs.filter((t) => t.status === "booked" && withBalance.has(t.accountId) && t.bookingDate > from && t.bookingDate <= to);
}

describe("the change of Saldot", () => {
  let checked = 0;
  for (const h of households) {
    for (const [period, rangeOf] of Object.entries(PERIODS)) {
      it(`is the sum of the rows from the start to the end: ${h.name}, ${period}`, () => {
        const ctx = contextOf(h);
        const range = rangeOf(h.today);
        const { change, accounts } = balanceReport(ctx, range, h.balances, h.inputs);
        if (!change) return;
        checked++;
        const rows = rowsBetween(h, change.from, change.to);
        expect(change.cents).toBe(rows.reduce((s, t) => s + t.amountCents, 0));
        // the accounts' parts add up to the total's
        expect(accounts.reduce((s, a) => s + a.changeCents!, 0)).toBe(change.cents);
        // every account with a row before the range is known the day before it: the change then starts there and the rows of the first day are in
        const startedBefore = h.balances.filter((b) => b.balanceCents !== null).every((b) => h.txs.some((t) => t.accountId === b.id && t.status === "booked" && t.bookingDate < range.from));
        expect(change.basis).toBe(startedBefore ? "dayBefore" : "firstDay");
        if (startedBefore) {
          expect(change.from).toBe(addDays(range.from, -1));
          expect(change.cents).toBe(rowsBetween(h, addDays(range.from, -1), change.to).reduce((s, t) => s + t.amountCents, 0));
        } else expect(change.from >= range.from).toBe(true);
      });
    }
  }

  it("was told for most of the households and periods", () => {
    expect(checked).toBeGreaterThan(households.length * Object.keys(PERIODS).length * 0.5);
  });
});

describe("the bridge of the cash flow", () => {
  let checked = 0;
  for (const h of households) {
    for (const [period, rangeOf] of Object.entries(PERIODS)) {
      it(`adds up to the change with no remainder: ${h.name}, ${period}`, () => {
        const ctx = contextOf(h);
        const range = rangeOf(h.today);
        const { change } = balanceReport(ctx, range, h.balances, h.inputs);
        const bridge = cashflowReport(ctx, range, h.balances).moneyBridge;
        expect(bridge === null).toBe(change === null);
        if (!bridge || !change) return;
        checked++;
        // one definition of the change: the same days and the same cents as Saldot
        expect({ from: bridge.from, to: bridge.to, basis: bridge.basis, cents: bridge.changeCents }).toEqual(change);
        expect(bridge.lines.reduce((s, l) => s + l.cents, 0)).toBe(change.cents);
        const byId = new Map(h.txs.map((t) => [t.id, t]));
        const seen = new Set<string>();
        for (const line of bridge.lines) {
          // the filter is the rows of the line: their sum is the line's, and no row is in two lines
          expect(line.rowIds.reduce((s, id) => s + byId.get(id)!.amountCents, 0), line.key).toBe(line.cents);
          for (const id of line.rowIds) {
            expect(seen.has(id), id).toBe(false);
            seen.add(id);
          }
        }
        // every row of the change is in a line
        expect(seen.size).toBe(rowsBetween(h, change.from, change.to).length);
        expect(bridge.lines.slice(0, 4).map((l) => l.key)).toEqual(["income", "consumption", "debt", "investedOut"]);
        const sign = Object.fromEntries(bridge.lines.map((l) => [l.key, l.cents]));
        expect(sign.income).toBeGreaterThanOrEqual(0);
        expect(sign.debt).toBeLessThanOrEqual(0);
      });
    }
  }

  it("was told for most of the households and periods", () => {
    expect(checked).toBeGreaterThan(households.length * Object.keys(PERIODS).length * 0.5);
  });

  it("has no bridge without a balance", () => {
    const h = households[0]!;
    expect(cashflowReport(contextOf(h), PERIODS["3 months"]!(h.today)).moneyBridge).toBeNull();
  });
});

describe("the edges of the change", () => {
  const account: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
  const row = (id: string, bookingDate: string, amountCents: number, category = "other"): Transaction => ({
    id, accountId: "chk", bookingDate, amountCents, currency: "EUR", status: "booked", counterparty: null, counterpartyIban: null, description: null, mcc: null, merchant: "KAUPPA", category, categorySource: "default", isTransfer: false,
  });
  const balance: BalanceInput = { id: "chk", name: "Käyttötili", type: "checking", balanceCents: 100_000, ownerName: null, balanceAt: "2026-10-09T08:00:00.000Z" };
  const today = "2026-10-09";

  it("takes the rows of the first day of the range in, when the day before is known", () => {
    // the balance of the 9th is 1 000,00 €: the 5th closed at 1 070,00 € and the 6th at 1 020,00 €
    const ctx = createContext([row("a", "2026-10-05", -1_000), row("b", "2026-10-06", -5_000), row("c", "2026-10-08", -2_000)], [account], today);
    const range = { from: "2026-10-06", to: "2026-10-09" };
    const { change } = balanceReport(ctx, range, [balance]);
    expect(change).toEqual({ from: "2026-10-05", to: "2026-10-09", cents: -7_000, basis: "dayBefore" });
    const bridge = cashflowReport(ctx, range, [balance]).moneyBridge!;
    expect(bridge.lines.find((l) => l.key === "consumption")!.cents).toBe(-7_000);
    expect(bridge.lines.reduce((s, l) => s + l.cents, 0)).toBe(-7_000);
  });

  it("names the first day it knows when nothing is known before the range", () => {
    // the account's first row is on the day the range starts: what it held before is not known
    const ctx = createContext([row("a", "2026-10-06", -5_000), row("b", "2026-10-08", -2_000)], [account], today);
    const range = { from: "2026-10-06", to: "2026-10-09" };
    const { change } = balanceReport(ctx, range, [balance]);
    expect(change).toEqual({ from: "2026-10-06", to: "2026-10-09", cents: -2_000, basis: "firstDay" });
    expect(cashflowReport(ctx, range, [balance]).moneyBridge!.changeCents).toBe(-2_000);
  });

  it("tells the change of a single day, and none for an account without a balance or one that starts that day", () => {
    const day = { from: "2026-10-09", to: "2026-10-09" };
    const known = createContext([row("a", "2026-10-08", -1_000), row("b", "2026-10-09", -5_000)], [account], today);
    expect(balanceReport(known, day, [balance]).change).toEqual({ from: "2026-10-08", to: "2026-10-09", cents: -5_000, basis: "dayBefore" });
    expect(balanceReport(known, day, [{ ...balance, balanceCents: null }]).change).toBeNull();
    const starts = createContext([row("b", "2026-10-09", -5_000)], [account], today);
    expect(balanceReport(starts, day, [balance]).change).toBeNull();
  });
});
