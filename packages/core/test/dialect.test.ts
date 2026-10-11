import { describe, expect, it } from "vitest";
import { categorize, compileRules } from "../src/categorize.ts";
import { billKind } from "../src/optimise/areas/electricity.ts";

const rules = compileRules([]);
const categoryOf = (counterparty: string, amountCents: number) => categorize({ merchant: counterparty, counterparty, description: null, mcc: null, amountCents }, rules).category;
const kindOf = (merchant: string) => billKind({ merchant, counterparty: merchant, description: null, category: "utilities" }, new Map());

// ADR 0008: where two lists of the same names disagreed, both readers now take the union
describe("bank dialect: one list per kind of payee", () => {
  it("names only the Optimoi area knew are electricity bills to the rules too", () => {
    for (const name of ["LUMME", "NORDIC GREEN", "JARVI-SUOMEN ENERGIA"]) expect(categoryOf(name, -4500), name).toBe("utilities");
  });

  it("names only the rules knew are electricity sellers to the area too, a network company stays one", () => {
    for (const name of ["LOISTE", "HERRFORS", "LUMME", "NORDIC GREEN", "FORTUM"]) expect(kindOf(name), name).toBe("seller");
    for (const name of ["LOISTE SAHKOVERKKO", "JARVI-SUOMEN ENERGIA", "CARUNA"]) expect(kindOf(name), name).toBe("network");
  });

  it("every earnings pension company of the income view is a benefit payer to the rules", () => {
    for (const name of ["PENSIONSSKYDDSCENTRALEN", "ELO KESKINAINEN", "ILMARINEN", "VARMA"]) expect(categoryOf(name, 150000), name).toBe("benefits");
  });

  it("a day care word inside a longer word is kids to the rules, as it was to the area", () => {
    expect(categoryOf("KIELIPAIVAKOTI", -30000)).toBe("kids");
  });
});
