import { describe, expect, it } from "vitest";
import { hasCompanyForm, isMobilePay } from "../src/industry.ts";
import { companyForms, type FormUse } from "../src/wording.ts";

const forms = (use: FormUse) => [...companyForms(use)].sort();
const words = (list: string) => list.split(" ").sort();

describe("shared wording", () => {
  // These were three hand-written lists. Each use is pinned to the list it had, so keeping them in one file changed
  // nothing; a change to a list shows up here and has to be a decision.
  it("company forms: each use keeps its own list", () => {
    expect(forms("strip")).toEqual(words("OY OYJ AB ABP KY AY RY RF TMI OSK KOY AS LTD SR AOY"));
    expect(forms("payee")).toEqual(words("OY OYJ AB ABP KY AY RY TMI OSK KOY LTD LIMITED INC GMBH LLC PLC BV ASA"));
    expect(forms("person")).toEqual(words("OY OYJ AB KY AY RY TMI LTD LIMITED INC GMBH AS SA OU PLC LLC BV NV SE ASA KOY SR OSK"));
  });

  it("a payee is a business by a company form at either end, but not by SA, SE or AS", () => {
    expect(hasCompanyForm("Tikkurilan Tiikerit ry")).toBe(true);
    expect(hasCompanyForm("Oy Kahvila Ilo Ab")).toBe(true);
    expect(hasCompanyForm("Maria SA")).toBe(false);
    expect(hasCompanyForm("Anna Se")).toBe(false);
  });

  it("MobilePay wording marks a payment", () => {
    expect(isMobilePay({ counterparty: "Matti Meikäläinen", description: "MobilePay" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "PIVO-maksu" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "Siirto henkilölle" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "Siirto henkilöltä" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "PIVOT" })).toBe(false);
  });
});
