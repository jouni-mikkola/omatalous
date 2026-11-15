/** The Swedish words of Danske's and other Swedish-speaking banks' rows, read without a merchant code or a bank code. */
import { describe, expect, it } from "vitest";
import { categorize, compileRules } from "../src/categorize.ts";
import { fold } from "../src/merchant.ts";
import { isBusinessPaymentText, isPaymentMethodName } from "../src/wording.ts";

const rules = compileRules([]);
const category = (merchant: string, description: string, amountCents: number) =>
  categorize({ merchant, counterparty: null, description, mcc: null, amountCents }, rules).category;

describe("Swedish bank words", () => {
  it.each([
    ["Nova Software Oy", "LÖN", 389_000],
    ["Nova Software Oy", "LÖN 10/2026", 389_000],
  ])("%s %s is salary", (merchant, description, cents) => {
    expect(category(merchant, description, cents)).toBe("salary");
  });

  it.each([
    // LON stands for London on a card row, and a refund comes in
    ["Esimerkki Taxi", "ESIMERKKI TAXI LON", 1200],
    ["Lönnrotinkatu Oy", "LÖNNROTINKATU 5", 1200],
    ["Nova Software Oy", "LÖNEBYRÅN", 1200],
  ])("%s %s is no salary", (merchant, description, cents) => {
    expect(category(merchant, description, cents)).not.toBe("salary");
  });

  it("pay going out is no salary", () => {
    expect(category("Nova Software Oy", "LÖN", -389_000)).not.toBe("salary");
  });

  it.each([
    ["Danske Bank Oyj", "AVGIFT KONTO"],
    ["Danske Bank Oyj", "KONTOAVGIFT"],
    ["Danske Bank Oyj", "KORTAVGIFT"],
  ])("%s %s is a bank fee", (merchant, description) => {
    expect(category(merchant, description, -490)).toBe("fees");
  });

  it("a club's membership fee is no bank fee", () => {
    expect(category("Esimerkki Idrottsförening", "MEDLEMSAVGIFT", -3000)).not.toBe("fees");
  });

  it("KORTKÖP is a card purchase, a business's row", () => {
    expect(isBusinessPaymentText(fold("KORTKÖP ESIMERKKI OY"))).toBe(true);
    expect(isBusinessPaymentText(fold("KORTKOPIA ESIMERKKI"))).toBe(false);
  });

  it("ÖVERFÖRING and KORTKÖP name a way to pay, nobody's name", () => {
    expect(isPaymentMethodName(fold("ÖVERFÖRING"))).toBe(true);
    expect(isPaymentMethodName(fold("KORTKÖP"))).toBe(true);
    expect(isPaymentMethodName(fold("ÖVERFÖRINGSBYRÅN"))).toBe(false);
  });
});
