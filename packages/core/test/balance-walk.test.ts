/**
 * The day walk starts from the day the balance stands for. A bank's balance of the 7th, read on the 9th, holds the rows
 * of the 7th and not those of the 8th: stamped with the 7th, the walk adds the 8th, stamped with the 9th it would take
 * both off. Made-up sums.
 */
import { describe, expect, it } from "vitest";
import { balanceWalk } from "../src/analysis/balance-walk.ts";
import { createContext } from "../src/analysis/context.ts";
import { dayNumber } from "../src/dates.ts";
import { balanceReport } from "../src/reports/balances.ts";
import type { Account, BalanceInput, Transaction } from "../src/types.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const row = (id: string, bookingDate: string, amountCents: number, status: Transaction["status"] = "booked"): Transaction => ({
  id, accountId: "chk", bookingDate, amountCents, currency: "EUR", status, counterparty: null, counterpartyIban: null, description: null, mcc: null, merchant: "KAUPPA", category: "other", categorySource: "default", isTransfer: false,
});
const rows = [row("a", "2026-10-06", -3_000), row("b", "2026-10-07", -2_000), row("c", "2026-10-08", -5_000)];
const ctx = createContext(rows, [checking], "2026-10-09");
const account = (balanceAt: string | null): BalanceInput => ({ id: "chk", name: "Käyttötili", type: "checking", balanceCents: 100_000, ownerName: null, balanceAt });
const day = (s: string) => dayNumber(s);

describe("balanceWalk", () => {
  it("holds the balance at the end of its own day and adds the rows booked after it", () => {
    const walk = balanceWalk(ctx, account("2026-10-07T12:00:00.000Z"))!;
    expect(walk.asOfDay).toBe(day("2026-10-07"));
    expect(walk.at(day("2026-10-07"))).toBe(100_000);
    expect(walk.at(day("2026-10-08"))).toBe(95_000);
    expect(walk.at(day("2026-10-09"))).toBe(95_000);
    // before it: the rows of the 7th and the 6th come off the balance
    expect(walk.at(day("2026-10-06"))).toBe(102_000);
  });

  it("takes every row up to the day of the fetch off a balance stamped with that day, as when no reference day is known", () => {
    const walk = balanceWalk(ctx, account("2026-10-09T08:00:00.000Z"))!;
    expect(walk.at(day("2026-10-09"))).toBe(100_000);
    expect(walk.at(day("2026-10-08"))).toBe(100_000);
    expect(walk.at(day("2026-10-07"))).toBe(105_000);
  });

  it("leaves a pending row out and gives nothing for an account without a balance", () => {
    const pending = createContext([...rows, row("d", "2026-10-08", -7_700, "pending")], [checking], "2026-10-09");
    expect(balanceWalk(pending, account("2026-10-07T12:00:00.000Z"))!.at(day("2026-10-09"))).toBe(95_000);
    expect(balanceWalk(ctx, { ...account(null), balanceCents: null })).toBeNull();
  });
});

describe("balanceWalk with rows in another currency", () => {
  // the bank's euro balance may hold the euro value of such a row, which no euro row shows: every day before the newest one is unknown
  const withForeign = (newestDay: string) => createContext(rows, [checking], "2026-10-09", undefined, [{ accountId: "chk", count: 2, newestDay }]);

  it("is null before the newest foreign day and known from it", () => {
    const walk = balanceWalk(withForeign("2026-10-07"), account("2026-10-09T08:00:00.000Z"))!;
    expect(walk.at(day("2026-10-06"))).toBeNull();
    expect(walk.blanked(day("2026-10-06"))).toBe(true);
    expect(walk.at(day("2026-10-07"))).toBe(105_000);
    expect(walk.at(day("2026-10-09"))).toBe(100_000);
    expect(walk.blanked(day("2026-10-07"))).toBe(false);
  });

  it("is as before with no foreign rows, and for another account's rows", () => {
    const other = createContext(rows, [checking], "2026-10-09", undefined, [{ accountId: "sav", count: 1, newestDay: "2026-10-08" }]);
    for (const c of [ctx, other]) {
      const walk = balanceWalk(c, account("2026-10-09T08:00:00.000Z"))!;
      expect(walk.at(day("2026-10-06"))).toBe(107_000);
      expect(walk.blanked(day("2026-10-01"))).toBe(false);
    }
  });
});

describe("the month total with an account blanked by a row in another currency", () => {
  const savings: Account = { id: "sav", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
  const rowOf = (id: string, accountId: string, bookingDate: string, amountCents: number): Transaction => ({ ...row(id, bookingDate, amountCents), accountId });
  const txs = [rowOf("a", "chk", "2026-09-20", -3_000), rowOf("b", "chk", "2026-10-08", -5_000), rowOf("c", "sav", "2026-09-25", -1_000)];
  const inputs: BalanceInput[] = [
    { id: "chk", name: "Käyttötili", type: "checking", balanceCents: 100_000, ownerName: null, balanceAt: "2026-10-10T12:00:00.000Z" },
    { id: "sav", name: "Säästötili", type: "savings", balanceCents: 50_000, ownerName: null, balanceAt: "2026-10-10T12:00:00.000Z" },
  ];
  const report = (newestDay: string | null) =>
    balanceReport(createContext(txs, [checking, savings], "2026-10-10", undefined, newestDay ? [{ accountId: "chk", count: 1, newestDay }] : []), { from: "2026-09-01", to: "2026-10-31" }, inputs);

  it("is a dash on the day before the newest foreign day, and the sum of both accounts from it", () => {
    const r = report("2026-10-05");
    // the end of September: the checking account is unknown, so the total is not the savings account alone
    expect(r.total).toEqual([null, 150_000]);
    expect(r.accounts.find((a) => a.accountId === "sav")!.values).toEqual([50_000, 50_000]);
  });

  it("is the sum of both for a foreign row older than the day, and as before with none", () => {
    expect(report("2026-09-20").total).toEqual([155_000, 150_000]);
    expect(report(null).total).toEqual([155_000, 150_000]);
  });
});
