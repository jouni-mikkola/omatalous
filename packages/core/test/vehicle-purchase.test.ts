/**
 * Auton osto: a payment to a car dealer of 1 500 € or more is a car bought, under it the car's upkeep. A dealer is told
 * by its name or by the trade register's class for the sale of motor vehicles; a shop, a bus company, a driving school
 * and a financier with a car in the name stay what they are.
 */
import { describe, expect, it } from "vitest";
import { createContext, netSpend } from "../src/analysis/context.ts";
import { getCategory, isKnownCategory } from "../src/categories.ts";
import { categorize, compileRules } from "../src/categorize.ts";
import { categoryForIndustry, matchCompany, type RegistryCompany } from "../src/industry.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, CategoryRule, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const rules = compileRules([]);

/** The category of an invoice paid to `payee`, as the bank writes it: the name in capitals, the payee's account, a reference. */
const paid = (payee: string, amountCents: number, description: string | null = "LASKU 1234") =>
  categorize({ merchant: normalizeMerchant(payee.toUpperCase(), null), counterparty: payee.toUpperCase(), description, mcc: null, amountCents, counterpartyIban: "FI4950009420028731", reference: "12344" }, rules).category;

const row = (payee: string, amountCents: number, over: Partial<Transaction> = {}): Transaction =>
  tx({ accountId: "chk", bookingDate: "2026-06-18", amountCents, merchant: normalizeMerchant(payee.toUpperCase(), null), counterparty: payee.toUpperCase(), counterpartyIban: "FI4950009420028731", reference: "12344", description: "LASKU 1234", ...over });

/** The rows as the server stores them after a reprocess. */
function enriched(rows: readonly Transaction[], userRules: readonly CategoryRule[] = [], industries: ReadonlyMap<string, string> = new Map()): Transaction[] {
  const changed = new Map(enrichTransactions(rows, [checking], userRules, industries).map((t) => [t.id, t]));
  return rows.map((t) => changed.get(t.id) ?? t);
}

describe("the category", () => {
  it("is an expense of Liikkuminen that a user can pick", () => {
    expect(isKnownCategory("vehicle_purchase")).toBe(true);
    expect(getCategory("vehicle_purchase")).toMatchObject({ label: "Auton osto", kind: "expense", group: "Liikkuminen" });
  });
});

describe("a payment to a car dealer", () => {
  it.each(["Autoliike Esimerkki Oy", "Esimerkki Bilar Ab", "Esimerkin Auto Oy", "K-Auto Esimerkki Oy", "Esimerkkiauto Oy", "Bil Esimerkki Ab", "Esimerkki Motors Oy", "Esimerkki Cars Oy", "Vaihtoautotalo Esimerkki", "Kamux Oy"])(
    "%s: 18 900 € is the car, 240 € is its upkeep",
    (dealer) => {
      expect(paid(dealer, -1_890_000)).toBe("vehicle_purchase");
      expect(paid(dealer, -24_000)).toBe("car");
    },
  );

  it("is the car from 1 500 € on, and upkeep one cent under it", () => {
    expect(paid("Autoliike Esimerkki Oy", -150_000)).toBe("vehicle_purchase");
    expect(paid("Autoliike Esimerkki Oy", -149_999)).toBe("car");
  });

  it("is named with AUTO as a word of its own or as the ending of the name, and a word ending in it before another name is none", () => {
    for (const dealer of ["Esimerkin Auto", "Auto Esimerkki Oy", "Esimerkkiauto", "Esimerkkiauto Oy", "Esimerkki-Auto Oy", "Esimerkkiauto Oy Kotka"]) expect(paid(dealer, -1_890_000), dealer).toBe("vehicle_purchase");
    // a van that sells fish from its side is named so; and a word that only holds AUTO is no word of the trade
    for (const other of ["Esimerkkiauto Meikäläinen", "Kala-auto Meikäläinen", "Esimerkkiautot Oy"]) {
      expect(paid(other, -1_890_000), other).toBe("other");
      expect(paid(other, -1_400), other).toBe("other");
    }
  });

  it("is told by the payee's name, not by a word of the message", () => {
    expect(paid("Esimerkki Oy", -1_890_000, "AUTOKAUPPA XYZ-123")).toBe("other");
    expect(paid("Autoliike Esimerkki Oy", -1_890_000, null)).toBe("vehicle_purchase");
  });

  it("keeps a person with a dealer's family name a person, and the company a dealer", () => {
    expect(paid("Laakkonen Oy", -1_890_000)).toBe("vehicle_purchase");
    expect(categorize({ merchant: "MATTI LAAKKONEN", counterparty: "MATTI LAAKKONEN", description: "SIIRTO", mcc: null, amountCents: -1_890_000 }, rules).category).toBe("other");
    // a dealer without a company form in its name is still no person
    expect(categorize({ merchant: "ESIMERKIN AUTO", counterparty: "ESIMERKIN AUTO", description: "SIIRTO", mcc: null, amountCents: -1_890_000, counterpartyIban: "FI4950009420028731" }, rules).category).toBe("vehicle_purchase");
  });
});

describe("a name that only looks like a dealer's or a shop's", () => {
  it("a dealer whose name holds a shop's word is a dealer, not a food shop", () => {
    for (const dealer of ["Auto Market Esimerkki Oy", "Auto Sale Esimerkki Oy", "Auto-Herkku Oy", "K-Auto Esimerkki Oy"]) {
      expect(paid(dealer, -1_890_000), dealer).toBe("vehicle_purchase");
      expect(paid(dealer, -24_000), dealer).toBe("car");
    }
  });

  it("a food shop whose name holds a dealer's word stays a food shop", () => {
    for (const shop of ["Lähikauppa Esimerkin Auto", "K-Market Autokeskus", "Market Esimerkki Bil", "Herkku Motors"]) {
      expect(paid(shop, -1_890_000), shop).toBe("groceries");
      expect(paid(shop, -2_400), shop).toBe("groceries");
    }
  });

  it("a bus company, a taxi, a driving school and a shop on wheels are no dealers at any sum", () => {
    expect(paid("Koiviston Auto Oy", -200_000)).toBe("transport");
    expect(paid("Esimerkin Taksi ja Tilausauto", -200_000)).toBe("transport");
    expect(paid("Esimerkin Linja-auto Oy", -200_000)).not.toBe("vehicle_purchase");
    expect(paid("Autokoulu Esimerkin Auto", -200_000)).toBe("education");
    for (const other of ["Kauppa-auto Esimerkki", "Suomen Jäätelöauto Oy", "Esimerkin Auto ry", "Autovuokraamo Esimerkin Auto Oy"]) {
      expect(paid(other, -200_000), other).toBe("other");
      expect(paid(other, -2_400), other).toBe("other");
    }
  });

  it("a garage, a tyre shop and a parts shop of the trade are upkeep at any sum", () => {
    for (const garage of ["Esimerkin Auto ja Huolto Oy", "Auto ja Rengas Esimerkki Oy", "Esimerkin Auto-osat Oy", "Auto-Korjaamo Esimerkki"]) {
      expect(paid(garage, -200_000), garage).toBe("car");
      expect(paid(garage, -24_000), garage).toBe("car");
    }
  });

  it("a finance company's instalment and a lease are no purchase", () => {
    expect(paid("Esimerkkirahoitus Oy", -200_000, "AUTOLAINA LYHENNYS")).toBe("loans");
    expect(paid("Esimerkki Autorahoitus Oy", -200_000, "OSAMAKSUERA")).toBe("loans");
    expect(paid("Esimerkin Auto Finance Oy", -200_000, "ERA 12/48")).not.toBe("vehicle_purchase");
    expect(paid("Esimerkki Autoleasing Oy", -200_000, "LEASINGVUOKRA")).not.toBe("vehicle_purchase");
  });
});

describe("the trade register's class for the sale of motor vehicles", () => {
  it("is the dealer's class in both code sets, and the garage's class is not", () => {
    expect(categoryForIndustry("45112", "TOL2008")).toBe("vehicle_purchase");
    expect(categoryForIndustry("45190", "TOL2008")).toBe("vehicle_purchase");
    expect(categoryForIndustry("47810", "TOL2025")).toBe("vehicle_purchase");
    expect(categoryForIndustry("46710", "TOL2025")).toBe("vehicle_purchase");
    // repair, parts and motorcycles stay the car's upkeep; the old code set's 46.71 is the wholesale of fuels
    expect(categoryForIndustry("45201", "TOL2008")).toBe("car");
    expect(categoryForIndustry("45320", "TOL2008")).toBe("car");
    expect(categoryForIndustry("47820", "TOL2025")).toBe("car");
    expect(categoryForIndustry("95310", "TOL2025")).toBe("car");
    expect(categoryForIndustry("46710", "TOL2008")).toBeNull();
    expect(categoryForIndustry("47810", "TOL2008")).toBe("groceries");
  });

  it("alone is enough: a payee whose name says nothing is a dealer by its class, and the sum tells the car from its upkeep", () => {
    const industries = new Map([["Esimerkki", categoryForIndustry("45112", "TOL2008")!]]);
    const rows = [row("Esimerkki Oy", -1_890_000), row("Esimerkki Oy", -24_000, { bookingDate: "2026-07-02" }), row("Esimerkki Oy", -150_000, { bookingDate: "2026-08-02" })];
    expect(enriched(rows).map((t) => t.category)).toEqual(["other", "other", "other"]);
    expect(enriched(rows, [], industries).map((t) => [t.category, t.categorySource])).toEqual([
      ["vehicle_purchase", "industry"],
      ["car", "industry"],
      ["vehicle_purchase", "industry"],
    ]);
  });

  it("does not make two companies of one name ambiguous when one sells cars and the other repairs them", () => {
    const company = (businessId: string, name: string, code: string): RegistryCompany => ({ businessId, names: [name], industry: { code, codeSet: "TOL2008", label: null } });
    expect(matchCompany("Esimerkki", [company("1", "Esimerkki Oy", "45112")])).toMatchObject({ status: "found", category: "vehicle_purchase" });
    // the garage is picked, so the rows stay the car's upkeep
    expect(matchCompany("Esimerkki", [company("1", "Esimerkki Oy", "45112"), company("2", "Esimerkki Oy", "45201")])).toMatchObject({ status: "found", businessId: "2", category: "car" });
    expect(matchCompany("Esimerkki", [company("1", "Esimerkki Oy", "45112"), company("2", "Esimerkki Oy", "47110")]).status).toBe("ambiguous");
  });
});

describe("the rows of one dealer", () => {
  it("are decided each by its own sum, though the names and the texts are the same", () => {
    const rows = [row("Autoliike Esimerkki Oy", -1_890_000), row("Autoliike Esimerkki Oy", -24_000, { bookingDate: "2026-07-02" }), row("Autoliike Esimerkki Oy", -149_999, { bookingDate: "2026-08-02" })];
    expect(enriched(rows).map((t) => [t.category, t.categorySource])).toEqual([
      ["vehicle_purchase", "rule"],
      ["car", "rule"],
      ["car", "rule"],
    ]);
  });

  it("a row the user put in Auton osto is one whatever its sum, and so is every row of a payee the user's rule names", () => {
    const picked = row("Esimerkki Oy", -30_000, { category: "vehicle_purchase", categorySource: "user" });
    const kept = row("Autoliike Esimerkki Oy", -1_890_000, { category: "home", categorySource: "user", bookingDate: "2026-07-02" });
    expect(enriched([picked, kept]).map((t) => [t.category, t.categorySource])).toEqual([
      ["vehicle_purchase", "user"],
      ["home", "user"],
    ]);
    const rule: CategoryRule = { id: 1, pattern: "Matti Meikäläinen", field: "merchant_exact", category: "vehicle_purchase", priority: 1 };
    const fromPerson = tx({ accountId: "chk", bookingDate: "2026-06-18", amountCents: -40_000, merchant: "Matti Meikäläinen", counterparty: "MATTI MEIKALAINEN", description: "KÄSIRAHA" });
    expect(enriched([fromPerson], [rule])[0]).toMatchObject({ category: "vehicle_purchase", categorySource: "rule" });
  });
});

describe("money in from a dealer", () => {
  const context = (rows: readonly Transaction[]) => createContext(enriched(rows), [checking], "2026-10-11");

  it("follows the same sum, and a deposit paid back takes the purchase down", () => {
    const rows = [row("Autoliike Esimerkki Oy", -1_890_000), row("Autoliike Esimerkki Oy", 200_000, { bookingDate: "2026-07-02" }), row("Autoliike Esimerkki Oy", 5_000, { bookingDate: "2026-07-03" })];
    const ctx = context(rows);
    expect(ctx.txs.map((t) => t.category)).toEqual(["vehicle_purchase", "vehicle_purchase", "vehicle_purchase"]);
    // 18 900 € paid, 2 050 € back: the car cost 16 850 € and nothing of it is income
    expect(netSpend(ctx.txs[0]!)).toBe(1_685_000);
    expect(ctx.txs.reduce((sum, t) => sum + t.flows.income, 0)).toBe(0);
  });

  it("is income when the dealer was paid nothing: a car sold to it lowers no spending", () => {
    const ctx = context([row("Autoliike Esimerkki Oy", 800_000), row("Autoliike Esimerkki Oy", -24_000, { bookingDate: "2026-09-02" })]);
    expect(ctx.txs.map((t) => [t.category, t.flows.income, netSpend(t)])).toEqual([
      ["vehicle_purchase", 800_000, 0],
      ["car", 0, 24_000],
    ]);
  });
});
