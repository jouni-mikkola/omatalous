import { describe, expect, it } from "vitest";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, CategoryRule, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };

const run = (rows: Transaction[], rules: CategoryRule[] = []) => {
  const changed = new Map(enrichTransactions(rows, [checking], rules, new Map()).map((t) => [t.id, t]));
  return rows.map((t) => ({ ...t, ...changed.get(t.id) }));
};
const rule = (pattern: string, category: string): CategoryRule => ({ id: 1, field: "merchant_exact", pattern, category, priority: 5 });

describe("a rule of the user's reads the direction of its category", () => {
  const kela = (id: string, euros: number, description: string) =>
    tx({ id, bookingDate: "2026-09-15", amountCents: Math.round(euros * 100), merchant: "Kela", counterparty: "KELA", description });

  it("a rule for medical payees files what the payee charges, not the benefit it pays", () => {
    const [charge, benefit] = run([kela("charge", -16, "OMAVASTUU"), kela("benefit", 94.8, "LAPSILISA")], [rule("Kela", "health")]);
    expect([charge!.category, charge!.categorySource]).toEqual(["health", "rule"]);
    expect([benefit!.category, benefit!.categorySource]).toEqual(["benefits", "rule"]);
  });

  it("money in under a rule of spending, with nothing else that reads it, is income and not that category", () => {
    const [unknown] = run([tx({ id: "in", bookingDate: "2026-09-15", amountCents: 5000, merchant: "Zxq Tmi", counterparty: "ZXQ TMI", description: "VIESTI" })], [rule("Zxq Tmi", "health")]);
    expect(unknown!.category).not.toBe("health");
    expect(unknown!.categorySource).not.toBe("user");
  });

  it("a rule of an income category still reads the money in, and a user's own mark is left alone", () => {
    const [pay, marked] = run([kela("pay", 94.8, "LAPSILISA"), { ...kela("marked", 20, "VIESTI"), category: "health", categorySource: "user" }], [rule("Kela", "sales")]);
    expect([pay!.category, pay!.categorySource]).toEqual(["sales", "rule"]);
    expect([marked!.category, marked!.categorySource]).toEqual(["health", "user"]);
  });
});

describe("a payment through the wallet reads the same with its prefix and without it", () => {
  const pay = (id: string, euros: number, merchant: string, counterparty: string) =>
    tx({ id, bookingDate: "2026-09-09", amountCents: Math.round(euros * 100), merchant, counterparty, description: "MOBILEPAY" });

  it("a business named by a trade word is a business, a person's name stays a person's", () => {
    const [prefixed, bare, person, barePerson] = run([
      pay("a", -24, "Mobilepay Taika Pizza", "MOBILEPAY TAIKA PIZZA"),
      pay("b", -24, "Taika Pizza", "TAIKA PIZZA"),
      pay("c", -30, "Mobilepay Korhonen Liisa", "MOBILEPAY KORHONEN LIISA"),
      pay("d", -30, "Korhonen Liisa", "KORHONEN LIISA"),
    ]);
    expect([prefixed!.category, bare!.category]).toEqual(["restaurants", "restaurants"]);
    expect([person!.category, barePerson!.category]).toEqual(["p2p", "p2p"]);
  });

  it("money in from a business named so is no payment from a person", () => {
    const [prefixed, bare] = run([pay("a", 24, "Mobilepay Taika Pizza", "MOBILEPAY TAIKA PIZZA"), pay("b", 24, "Taika Pizza", "TAIKA PIZZA")]);
    expect(prefixed!.category).toBe(bare!.category);
    expect(prefixed!.category).not.toBe("p2p_in");
  });

  it("money in from a person through the wallet stays a payment from a person with or without the prefix", () => {
    const [prefixed, bare] = run([pay("a", 30, "Mobilepay Korhonen Liisa", "MOBILEPAY KORHONEN LIISA"), pay("b", 30, "Korhonen Liisa", "KORHONEN LIISA")]);
    expect([prefixed!.category, bare!.category]).toEqual(["p2p_in", "p2p_in"]);
  });
});
