/**
 * Where a person is told by the shape of a credit transfer alone: the payee that stays out of it (a steady sender, a
 * bank's brand, a wallet's payee a register knows) and the finance-company name check the loan proposals read.
 */
import { describe, expect, it } from "vitest";
import { addMonths } from "../src/dates.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { isFinanceCompanyName } from "../src/wording-lenders.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking", holder: "ESIMERKKI ERKKI" };

function row(counterparty: string, description: string | null, euros: number, date = "2026-09-12"): Transaction {
  return { ...tx({ accountId: "chk", bookingDate: date, amountCents: Math.round(euros * 100), counterparty, counterpartyIban: "FI4950009420028731", description, merchant: normalizeMerchant(counterparty, description) }), reference: null } as Transaction;
}
const categories = (rows: Transaction[], industries?: Map<string, string>) => {
  const changed = new Map(enrichTransactions(rows, [checking], [], industries).map((t) => [t.id, t]));
  return rows.map((t) => (changed.get(t.id) ?? t).category);
};
const monthly = (count: number, euros: number, payee: string) => Array.from({ length: count }, (_, i) => row(payee, null, euros, `${addMonths("2026-10", i - (count - 1))}-05`));

describe("a person told by the shape of a transfer", () => {
  it("a sender of the same sum month after month is no p2p_in; one payment of it is", () => {
    expect(categories(monthly(5, 300, "VIRTANEN LIISA")).every((c) => c !== "p2p_in")).toBe(true);
    expect(categories([row("VIRTANEN LIISA", null, 300)])).toEqual(["p2p_in"]);
  });

  it("a bank's brand in front of PANKKI is a bank, a first name is a person", () => {
    expect(categories([row("POP PANKKI", null, -40)])).not.toContain("p2p");
    expect(categories([row("NORDEA PANKKI", null, -40)])).not.toContain("p2p");
    expect(categories([row("PEKKA PANKKI", null, -40)])).toEqual(["p2p"]);
  });

  it("a name with a word of a purchase is no p2p, the same name with a plain thanks is", () => {
    expect(categories([row("Liisa Virtanen", "Kiitos osto", -40)])).not.toContain("p2p");
    expect(categories([row("Liisa Virtanen", "OSTOKSET", -40)])).not.toContain("p2p");
    expect(categories([row("Liisa Virtanen", "Kiitos", -40)])).toEqual(["p2p"]);
  });

  it("a register entry does not take a wallet payment: MobilePay to a person stays p2p", () => {
    const industries = new Map([[normalizeMerchant("PIKKU ILONA", "MOBILEPAY"), "restaurants"]]);
    expect(categories([row("PIKKU ILONA", "MOBILEPAY", -32)], industries)).toEqual(["p2p"]);
  });
});

describe("a finance company by the end of its name", () => {
  it.each(["ESIMERKKI RAHOITUS OY", "ESIMERKKIRAHOITUS", "ESIMERKKI FINANCE OY", "ESIMERKKI FINANS AB", "ESIMERKKI CREDIT LTD", "ESIMERKKI KREDIT AB"])("%s is one", (name) => {
    expect(isFinanceCompanyName(name)).toBe(true);
  });
  it.each(["RAHOITUS ESIMERKKI OY", "ESIMERKKI FINANSSI", "ESIMERKKI BANK AB", "ESIMERKKI OY"])("%s is not", (name) => {
    expect(isFinanceCompanyName(name)).toBe(false);
  });
});
