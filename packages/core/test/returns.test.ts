import { describe, expect, it } from "vitest";
import { createContext, netPurchase } from "../src/analysis/context.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { matchReturns, pairedReturns } from "../src/returns.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };

// "Zxq Tmi": no rule knows it, so the purchase is "other" and the money back is plain income
const bought = (id: string, date: string, euros: number, extra: Partial<Transaction> = {}) =>
  tx({ id, bookingDate: date, amountCents: -Math.round(euros * 100), merchant: "Zxq Tmi", counterparty: "ZXQ TMI", category: "other", categorySource: "default", ...extra });
const back = (id: string, date: string, euros: number, extra: Partial<Transaction> = {}) =>
  tx({ id, bookingDate: date, amountCents: Math.round(euros * 100), merchant: "Zxq Tmi", counterparty: "ZXQ TMI", category: "income", categorySource: "default", ...extra });

// money in from the shop before it was ever paid: the shop has paid the household, so a later sum is no refund by that alone
const earlierIncome = back("i", "2026-08-01", 5);

describe("matchReturns", () => {
  it("pairs a refund with the earlier purchase at the same merchant", () => {
    expect([...matchReturns([bought("p", "2026-09-03", 79), back("r", "2026-09-17", 79)])]).toEqual([["r", "p"]]);
  });

  it("takes the purchase of exactly that amount, else the latest one with room", () => {
    const purchases = [bought("a", "2026-09-01", 79), bought("b", "2026-09-05", 25), bought("c", "2026-09-08", 120)];
    expect(matchReturns([...purchases, back("r", "2026-09-20", 79)]).get("r")).toBe("a");
    expect(matchReturns([...purchases, back("r", "2026-09-20", 50)]).get("r")).toBe("c");
  });

  it("a partial refund takes its part, two refunds can share a purchase, and the sum never exceeds it", () => {
    const m = matchReturns([earlierIncome, bought("p", "2026-09-03", 100), back("r1", "2026-09-10", 40), back("r2", "2026-09-12", 40), back("r3", "2026-09-14", 40)]);
    expect([...m.keys()]).toEqual(["r1", "r2"]);
  });

  it("ignores another merchant, a refund before the purchase, one larger than the purchase and one on another account", () => {
    const p = bought("p", "2026-09-03", 79);
    expect(matchReturns([earlierIncome, p, back("r", "2026-09-17", 79, { merchant: "Other", counterparty: "OTHER" })]).size).toBe(0);
    expect(matchReturns([earlierIncome, p, back("r", "2026-09-01", 79)]).size).toBe(0);
    expect(matchReturns([earlierIncome, p, back("r", "2026-09-17", 80)]).size).toBe(0);
    expect(matchReturns([earlierIncome, p, back("r", "2026-09-17", 79, { accountId: "sav" })]).size).toBe(0);
  });

  it("a shop refunds for 120 days, a person pays back for 90", () => {
    const shop = (days: number) => matchReturns([back("i", "2025-12-01", 5), bought("p", "2026-01-01", 79), back("r", new Date(Date.UTC(2026, 0, 1 + days)).toISOString().slice(0, 10), 79)]).size;
    expect([shop(120), shop(121)]).toEqual([1, 0]);
    const person = (days: number) =>
      matchReturns([
        tx({ id: "p", bookingDate: "2026-01-01", amountCents: -5000, merchant: "Elisa Virtanen", category: "p2p", categorySource: "rule" }),
        tx({ id: "r", bookingDate: new Date(Date.UTC(2026, 0, 1 + days)).toISOString().slice(0, 10), amountCents: 5000, merchant: "Elisa Virtanen", category: "p2p_in", categorySource: "rule" }),
      ]).size;
    expect([person(90), person(91)]).toEqual([1, 0]);
  });

  it("gives the same answer whatever the order of the input", () => {
    const rows = [bought("a", "2026-09-01", 50), bought("b", "2026-09-01", 50), back("r1", "2026-09-10", 50), back("r2", "2026-09-10", 50)];
    expect([...matchReturns(rows)]).toEqual([...matchReturns([...rows].reverse())]);
  });
});

describe("pairedReturns", () => {
  const enriched = (rows: Transaction[]) => {
    const changed = new Map(enrichTransactions(rows, [checking], []).map((t) => [t.id, t]));
    return rows.map((t) => changed.get(t.id) ?? t);
  };

  it("finds the pairs the pipeline made, from the finished rows", () => {
    const rows = [
      bought("p1", "2026-09-03", 79),
      back("r1", "2026-09-17", 79),
      bought("p2", "2026-09-04", 100),
      back("r2", "2026-09-20", 40),
      back("r3", "2026-09-22", 20),
      tx({ id: "bill", bookingDate: "2026-09-10", amountCents: -6600, merchant: "Ravintola Solmu", counterparty: "RAVINTOLA SOLMU", description: "KORTTIOSTO" }),
      tx({ id: "s1", bookingDate: "2026-09-11", amountCents: 2200, merchant: "Veikko Lahti", counterparty: "VEIKKO LAHTI", description: "MOBILEPAY" }),
      tx({ id: "s2", bookingDate: "2026-09-12", amountCents: 2200, merchant: "Tiina Aho", counterparty: "TIINA AHO", description: "MOBILEPAY" }),
    ];
    const final = enriched(rows);
    expect(final.filter((t) => t.categorySource === "match").map((t) => t.id)).toEqual(["r1", "r2", "r3", "s1", "s2"]);
    expect([...pairedReturns(final)].sort()).toEqual([["r1", "p1"], ["r2", "p2"], ["r3", "p2"], ["s1", "bill"], ["s2", "bill"]]);
  });

  it("a refund that a rule recognised cancels the purchase too, a salary does not", () => {
    const rows = [
      tx({ id: "p", bookingDate: "2026-09-03", amountCents: -16743, merchant: "K-Citymarket", category: "groceries", categorySource: "rule" }),
      tx({ id: "r", bookingDate: "2026-09-10", amountCents: 16743, merchant: "K-Citymarket", category: "groceries", categorySource: "rule" }),
      tx({ id: "pay", bookingDate: "2026-09-25", amountCents: 250000, merchant: "K-Citymarket", category: "salary", categorySource: "rule" }),
    ];
    expect([...pairedReturns(rows)]).toEqual([["r", "p"]]);
  });

  it("nets what came back off the purchase, never below zero", () => {
    const rows = enriched([bought("p", "2026-09-03", 100), back("r1", "2026-09-10", 40), back("r2", "2026-09-12", 60)]);
    const ctx = createContext(rows, [checking], "2026-10-09");
    const p = ctx.txs.find((t) => t.id === "p")!;
    expect([p.refunded, netPurchase(p)]).toEqual([10000, 0]);
  });
});
