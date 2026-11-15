/**
 * A payment the bank has reserved and not booked yet has no text. It reads as a hold, not as "Muut menot", and it
 * still counts as spending. Its booking names the payee and sorts the row as any other. Every row is made up.
 */
import { describe, expect, it } from "vitest";
import { flowsOf } from "../src/analysis/flows.ts";
import { isKnownCategory } from "../src/categories.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { THEMES } from "../src/themes.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };

const row = (status: Transaction["status"], euros: number, counterparty: string | null, extra: Partial<Transaction> = {}): Transaction =>
  tx({ status, bookingDate: "2026-09-05", amountCents: Math.round(euros * 100), counterparty, merchant: normalizeMerchant(counterparty, null), ...extra });

const sorted = (rows: Transaction[]) => enrichTransactions(rows, [checking], []);

describe("a pending row with no text", () => {
  it("is a hold of spending, in a theme, and no row of Muut menot", () => {
    const [t] = sorted([row("pending", -23.5, null)]);
    expect(t!.category).toBe("hold");
    expect(isKnownCategory("hold")).toBe(true);
    expect(THEMES.some((theme) => theme.lines.some((l) => l.id === "hold"))).toBe(true);
    expect(flowsOf(t!, new Set()).consumption).toBe(2350);
  });

  it("is sorted as any row once the bank books it with a payee", () => {
    const [t] = sorted([row("booked", -23.5, "K-MARKET KAMPPI")]);
    expect(t!.category).toBe("groceries");
  });

  it("stays what it is when it has a payee, a card class or money in", () => {
    const named = sorted([row("pending", -23.5, "K-MARKET KAMPPI")])[0]!;
    expect(named.category).toBe("groceries");
    const coded = sorted([row("pending", -23.5, null, { mcc: "5411" })])[0]!;
    expect(coded.category).not.toBe("hold");
    const incoming = sorted([row("pending", 23.5, null)])[0]!;
    expect(incoming.category).not.toBe("hold");
  });

  it("is a hold only while it is pending: a booked row with no text stays in Muut menot", () => {
    const [t] = sorted([row("booked", -23.5, null)]);
    expect(t!.category).toBe("other");
  });
});
