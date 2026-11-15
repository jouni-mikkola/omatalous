import { describe, expect, it } from "vitest";
import { createContext, netPurchase } from "../src/analysis/context.ts";
import { addDays } from "../src/dates.ts";
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

  describe("money in with a refund word", () => {
    // the shop has paid the household before, so only the word makes the money a refund
    const word = (id: string, date: string, euros: number) => back(id, date, euros, { description: "HYVITYS" });

    it("larger than what is left of the payee's payments is paired with no payment: it is income, as the same row without the word", () => {
      const p = bought("p", "2026-09-03", 20);
      expect(matchReturns([p, word("r", "2026-09-12", 500)]).size).toBe(0);
      expect(matchReturns([earlierIncome, p, word("r", "2026-09-12", 500)]).size).toBe(0);
      expect(matchReturns([earlierIncome, p, back("r", "2026-09-12", 500)]).size).toBe(0);
      // the pipeline leaves it income: no category of a purchase, no pair
      const final = enrichTransactions([p, word("r", "2026-09-12", 500)], [checking], []);
      expect(final.find((t) => t.id === "r")?.categorySource).not.toBe("match");
    });

    it("at or under what is left is paired as before: with the latest payment when no one payment holds it", () => {
      const purchases = [earlierIncome, bought("a", "2026-09-01", 20), bought("b", "2026-09-05", 15)];
      expect([...matchReturns([...purchases, word("r", "2026-09-12", 30)])]).toEqual([["r", "b"]]);
      expect([...matchReturns([...purchases, word("r", "2026-09-12", 35)])]).toEqual([["r", "b"]]);
      expect(matchReturns([...purchases, word("r", "2026-09-12", 35.01)]).size).toBe(0);
      // the same sums without the word are income: the shop has paid the household before
      expect(matchReturns([...purchases, back("r", "2026-09-12", 30)]).size).toBe(0);
    });

    it("counts only the payments of the 120 days before it", () => {
      const rows = [earlierIncome, bought("old", "2026-01-10", 400), bought("a", "2026-09-01", 20), bought("b", "2026-09-05", 15)];
      expect(matchReturns([...rows, word("r", "2026-09-12", 36)]).size).toBe(0);
      expect(matchReturns([...rows, word("r", "2026-09-12", 35)]).get("r")).toBe("b");
    });

    it("cancels the payments once: a second refund has only what the first left", () => {
      const purchases = [earlierIncome, bought("a", "2026-09-01", 20), bought("b", "2026-09-03", 20), bought("c", "2026-09-05", 15)];
      // 30,00 took the 15,00 and 15,00 of the later 20,00: 25,00 is left, and no one payment holds 22,00
      expect([...matchReturns([...purchases, word("r1", "2026-09-12", 30), word("r2", "2026-09-14", 22)])]).toEqual([["r1", "c"], ["r2", "c"]]);
      expect([...matchReturns([...purchases, word("r1", "2026-09-12", 30), word("r2", "2026-09-14", 26)])]).toEqual([["r1", "c"]]);
      // a refund that one payment holds takes its part first: 30,00 is then more than the 25,00 left of 20,00 and 15,00
      const two = [earlierIncome, bought("a", "2026-09-01", 20), bought("b", "2026-09-05", 15)];
      expect([...matchReturns([...two, word("r1", "2026-09-12", 30), word("r2", "2026-09-14", 10)]).keys()]).toEqual(["r2"]);
    });

    it("a contract's closing refund is not touched: more than one rent comes back, paired with the last", () => {
      const rent = (m: number) => bought(`l${String(m).padStart(2, "0")}`, addDays("2025-01-05", 30 * m), 950, { category: "housing", categorySource: "rule" });
      const rents = Array.from({ length: 14 }, (_, m) => rent(m));
      const closing = word("r", addDays("2025-01-05", 30 * 13 + 40), 1500);
      expect([...matchReturns([...rents, closing], new Set(), new Set(), "2026-09-30")]).toEqual([["r", "l13"]]);
    });
  });

  describe("closing refunds stay in the contract's cost", () => {
    const pay = (m: number) => bought(`c${m}`, addDays("2025-01-05", 30 * m), 100, { merchant: "Liisinki Oy", counterparty: "LIISINKI OY", category: "housing", categorySource: "rule" });
    const payments = Array.from({ length: 6 }, (_, m) => pay(m));
    const last = addDays("2025-01-05", 150);
    const refund = (id: string, euros: number) => back(id, addDays(last, 2), euros, { merchant: "Liisinki Oy", counterparty: "LIISINKI OY" });
    const match = (rows: Transaction[]) => [...matchReturns(rows, new Set(), new Set(), "2026-09-30")];

    it("pairs the first of two refunds that together pass the cost; the second is income", () => {
      expect(match([...payments, refund("r1", 450), refund("r2", 450)])).toEqual([["r1", "c5"]]);
    });

    it("a small second refund that would pass the cost is income too, not paired by the payee's room", () => {
      expect(match([...payments, refund("r1", 450), { ...refund("r2", 200), description: "HYVITYS" }])).toEqual([["r1", "c5"]]);
    });

    it("counts each contract of a payee alone: a refund of the later one is not cut by the earlier one's", () => {
      const run = (from: string, tag: string) => Array.from({ length: 6 }, (_, m) => bought(`${tag}${m}`, addDays(from, 30 * m), 100, { merchant: "Liisinki Oy", counterparty: "LIISINKI OY", category: "housing", categorySource: "rule" }));
      const ref = (id: string, from: string) => back(id, addDays(from, 152), 450, { merchant: "Liisinki Oy", counterparty: "LIISINKI OY" });
      const rows = [...run("2024-01-05", "a"), ref("ra", "2024-01-05"), ...run("2025-06-05", "b"), ref("rb", "2025-06-05")];
      expect(match(rows)).toEqual([["ra", "a5"], ["rb", "b5"]]);
    });

    it("pairs both when together they fit the cost", () => {
      expect(match([...payments, refund("r1", 300), refund("r2", 300)])).toEqual([["r1", "c5"], ["r2", "c5"]]);
    });

    it("does not depend on the order of the input", () => {
      const rows = [...payments, refund("r1", 450), refund("r2", 450)];
      expect(match([...rows].reverse())).toEqual(match(rows));
    });
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
