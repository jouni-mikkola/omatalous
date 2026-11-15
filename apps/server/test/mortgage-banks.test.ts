import { describe, expect, it } from "vitest";
import { BANKS } from "../src/connectors/enable-banking/banks.ts";
import { fold } from "../../../packages/core/src/merchant.ts";
import { isMortgageBankText } from "../../../packages/core/src/wording.ts";

// The bank dialect lists the banks that lend mortgages by name (MORTGAGE_BANK_WORDS in wordlists.json), and the registry
// lists the banks the app can connect. Nothing joined them: this holds each registry bank to a decision.
const LENDS_MORTGAGES = ["nordea-fi", "op-fi", "danske-fi", "s-pankki-fi", "saastopankki-fi", "omasp-fi", "pop-fi", "aktia-fi", "alandsbanken-fi"];
const DOES_NOT = ["bank-norwegian-fi", "resurs-fi", "morrow-fi", "eurocard-fi", "finnair-plus-fi", "sas-eurobonus-fi", "holvi-fi", "revolut-fi"];

describe("banks that lend mortgages, against the registry of connectable banks", () => {
  it("each bank of the registry is either a mortgage lender or not, so a new bank asks for a decision here", () => {
    expect([...LENDS_MORTGAGES, ...DOES_NOT].sort()).toEqual(BANKS.map((b) => b.id).sort());
  });

  it("the name of a mortgage lender, as a payment text spells it, is a mortgage bank", () => {
    for (const id of LENDS_MORTGAGES) {
      const bank = BANKS.find((b) => b.id === id)!;
      expect(isMortgageBankText(fold(bank.name)), bank.name).toBe(true);
    }
  });

  it("the name of a card issuer, a payment institution or a co-branded card is not", () => {
    for (const id of DOES_NOT) {
      const bank = BANKS.find((b) => b.id === id)!;
      expect(isMortgageBankText(fold(bank.name)), bank.name).toBe(false);
    }
  });

  it("Nordea's finance company lends for cars and cards, so its names are not a mortgage bank, and a word of another name is not either", () => {
    expect(isMortgageBankText("NORDEA RAHOITUS SUOMI OY")).toBe(false);
    expect(isMortgageBankText("NORDEA FINANCE FINLAND")).toBe(false);
    expect(isMortgageBankText("NORDEA PANKKI SUOMI OYJ")).toBe(true);
    expect(isMortgageBankText("HELSINGIN OSUUSPANKKI")).toBe(true);
    expect(isMortgageBankText("OPTIKKO OY")).toBe(false);
  });
});
