import { describe, expect, it } from "vitest";
import { categorize, compileRules } from "../src/categorize.ts";
import { billKind } from "../src/optimise/areas/electricity.ts";
import { isCardIssuerText, isNordeaAccount, isSavingsAccountText } from "../src/wording.ts";

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

describe("bank dialect: whose account, whose card", () => {
  it("an IBAN says whether the account is Nordea's, whatever the connection is called", () => {
    expect(isNordeaAccount({ iban: "FI21 1234 5600 0007 85" })).toBe(true);
    expect(isNordeaAccount({ iban: "FI4250001510000023" })).toBe(false);
    expect(isNordeaAccount({ iban: "FI4250001510000023", bank: "Nordea" })).toBe(false);
  });

  it("a card account has no IBAN: the connection's bank decides, and without a connection it is Nordea's as before", () => {
    expect(isNordeaAccount({ iban: null, bank: "Nordea" })).toBe(true);
    expect(isNordeaAccount({ iban: null, bank: "nordea bank abp" })).toBe(true);
    for (const bank of ["Bank Norwegian", "OP", "Komplett", "Resurs", "S-Pankki", "Nordeax"]) expect(isNordeaAccount({ iban: null, bank }), bank).toBe(false);
    expect(isNordeaAccount({ iban: null })).toBe(true);
    expect(isNordeaAccount({ iban: null, bank: null })).toBe(true);
  });

  it("the card issuers whose bills are told from loans by their amounts", () => {
    for (const name of ["BANK NORWEGIAN", "KOMPLETT BANK", "MORROW BANK ASA", "RESURS BANK AB", "NORDEA RAHOITUS SUOMI OY", "SEB KORT BANK AB"]) expect(isCardIssuerText(name), name).toBe(true);
    for (const name of ["NORWEGIAN AIR SHUTTLE", "KOMPLETT.FI", "MORROW", "MORROW COFFEE OY", "SEB KORTTI", "RESURSSI OY", "SANTANDER"]) expect(isCardIssuerText(name), name).toBe(false);
    // Resurs is an issuer only by its whole name: a staffing company with the word in its name pays wages
    for (const name of ["RESURS BEMANNING AB", "HR RESURS AB", "RESURS"]) expect(isCardIssuerText(name), name).toBe(false);
  });

  it("a savings account or a deposit in a text, which at a card issuer that is a bank is no card bill", () => {
    for (const text of ["MORROW BANK ASA | SAASTOTILI", "SAASTOTILILLE 4417", "SAASTOON", "TALLETUS", "MAARAAIKAISTALLETUS", "SAVINGS ACCOUNT"]) expect(isSavingsAccountText(text), text).toBe(true);
    for (const text of ["MORROW BANK ASA | LASKU 09/2026", "SAASTOPANKKI", "LAINAN LYHENNYS", ""]) expect(isSavingsAccountText(text), text).toBe(false);
  });
});
