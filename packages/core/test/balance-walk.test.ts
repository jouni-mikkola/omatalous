/**
 * The day walk starts from the day the balance stands for. A bank's balance of the 7th, read on the 9th, holds the rows
 * of the 7th and not those of the 8th: stamped with the 7th, the walk adds the 8th, stamped with the 9th it would take
 * both off. Made-up sums.
 */
import { describe, expect, it } from "vitest";
import { balanceWalk } from "../src/analysis/balance-walk.ts";
import { createContext } from "../src/analysis/context.ts";
import { dayNumber } from "../src/dates.ts";
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
