import { describe, expect, it } from "vitest";
import { isMobilePay } from "../src/industry.ts";
import { fold } from "../src/merchant.ts";
import { companyForms, type FormUse, hasPayeeForm, isCardIssuerText, isLenderName, isLoanText } from "../src/wording.ts";

const forms = (use: FormUse) => [...companyForms(use)].sort();
const words = (list: string) => list.split(" ").sort();
const hasForm = (name: string) => hasPayeeForm(fold(name));

describe("shared wording", () => {
  // These were hand-written lists. Each use is pinned to the list it had, so keeping them in one file changed
  // nothing; a change to a list shows up here and has to be a decision. The third list, the forms that made a
  // MobilePay payee a company, went when the category rules took the register's shape of a name (isPersonShaped).
  it("company forms: each use keeps its own list", () => {
    expect(forms("strip")).toEqual(words("OY OYJ AB ABP KY AY RY RF TMI OSK KOY AS LTD SR AOY"));
    expect(forms("payee")).toEqual(words("OY OYJ AB ABP KY AY RY TMI OSK KOY LTD LIMITED INC GMBH LLC PLC BV"));
  });

  it("a payee is a business by a company form at either end, but not by SA, SE or AS", () => {
    expect(hasForm("Tikkurilan Tiikerit ry")).toBe(true);
    expect(hasForm("Oy Kahvila Ilo Ab")).toBe(true);
    expect(hasForm("Maria SA")).toBe(false);
    expect(hasForm("Anna Se")).toBe(false);
  });

  it("a character nobody sees splits no word into a company form", () => {
    // a soft hyphen from a copied page, a zero-width space, a direction mark, a combining accent
    for (const name of ["MEIKÄLÄINEN HEN\u00ADRY", "MATTI LER\u200BOY", "KY\u200DLLIKKI MEIKÄLÄINEN", "MATTI SAA\u200EB", "ABE\u0301L MEIKÄLÄINEN"]) expect(hasForm(name), JSON.stringify(name)).toBe(false);
    for (const name of ["ESIMERKKI\u200B OY", "\uFEFFOY ESIMERKKI", "ESIMERKKI O\u00ADY"]) expect(hasForm(name), JSON.stringify(name)).toBe(true);
  });

  it("an issuer that also lends stands in each list it belongs to", () => {
    for (const read of [isCardIssuerText, isLenderName]) expect(read("RESURS BANK AB")).toBe(true);
    expect(isLenderName("BANK NORWEGIAN")).toBe(false);
    // a contract is a loan's only at an issuer, where this is asked; the category rules do not read the word
    for (const text of ["OSAMAKSU 3/12", "LAINAN LYHENNYS", "RAHOITUSSOPIMUS 123", "SOPIMUS 123", "KULUTUSLUOTTO"]) expect(isLoanText(text), text).toBe(true);
    expect(isLoanText("LASKU 09/2026")).toBe(false);
  });

  it("MobilePay wording marks a payment", () => {
    expect(isMobilePay({ counterparty: "Matti Meikäläinen", description: "MobilePay" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "PIVO-maksu" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "Siirto henkilölle" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "Siirto henkilöltä" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "PIVOT" })).toBe(false);
  });
});
